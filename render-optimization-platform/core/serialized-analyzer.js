'use strict';

const crypto = require('crypto');
const { COMPONENT_KINDS, RENDERER_KINDS } = require('./constants');
const { readJson } = require('./file-system');

const MATERIAL_IGNORED_KEYS = new Set(['_name', '_objFlags', '__editorExtras__', '_native', '_id']);

function getRefId(value) {
    return value && Number.isInteger(value.__id__) ? value.__id__ : null;
}

function getUuid(value) {
    return value && typeof value.__uuid__ === 'string' ? value.__uuid__ : '';
}

function collectUuidDependencies(value, result = new Set(), seen = new Set()) {
    if (!value || typeof value !== 'object' || seen.has(value)) return result;
    seen.add(value);
    if (typeof value.__uuid__ === 'string') result.add(value.__uuid__);
    if (Array.isArray(value)) {
        for (const item of value) collectUuidDependencies(item, result, seen);
    } else {
        for (const key of Object.keys(value)) collectUuidDependencies(value[key], result, seen);
    }
    return result;
}

function stableNormalize(value) {
    if (Array.isArray(value)) return value.map(stableNormalize);
    if (!value || typeof value !== 'object') return value;
    const normalized = {};
    for (const key of Object.keys(value).sort()) {
        if (MATERIAL_IGNORED_KEYS.has(key)) continue;
        normalized[key] = stableNormalize(value[key]);
    }
    return normalized;
}

function materialFingerprint(material) {
    const source = JSON.stringify(stableNormalize(material));
    return crypto.createHash('sha256').update(source).digest('hex');
}

function componentTextureKey(kind, component, componentIndex) {
    if (kind === 'sprite' || kind === 'mask') return getUuid(component._spriteFrame) || `${kind}:none`;
    if (kind === 'label' || kind === 'richText') {
        return getUuid(component._font) || `font:${component._fontFamily || 'system'}:${component._cacheMode || 0}`;
    }
    if (kind === 'spine') return getUuid(component._skeletonData) || 'spine:none';
    if (kind === 'dragonBones') return getUuid(component._dragonAsset) || getUuid(component._dragonAtlasAsset) || 'dragon-bones:none';
    if (kind === 'particle2D') return getUuid(component._file) || getUuid(component._spriteFrame) || 'particle:none';
    return `${kind}:${componentIndex}`;
}

function componentMaterialKey(component) {
    const customMaterial = getUuid(component._customMaterial);
    if (customMaterial) return customMaterial;
    if (Array.isArray(component._materials)) {
        const first = component._materials.map(getUuid).find(Boolean);
        if (first) return first;
    }
    return 'builtin-default';
}

function createNodeModel(objects) {
    const nodes = new Map();
    for (let index = 0; index < objects.length; index++) {
        const value = objects[index];
        if (!value || (value.__type__ !== 'cc.Node' && value.__type__ !== 'cc.Scene')) continue;
        nodes.set(index, {
            index,
            name: value._name || (value.__type__ === 'cc.Scene' ? 'Scene' : `Node-${index}`),
            type: value.__type__,
            active: value._active !== false,
            parentId: getRefId(value._parent),
            childIds: Array.isArray(value._children) ? value._children.map(getRefId).filter(id => id !== null) : [],
            componentIds: Array.isArray(value._components) ? value._components.map(getRefId).filter(id => id !== null) : [],
        });
    }
    return nodes;
}

function createNodePathResolver(nodes) {
    const cache = new Map();
    function resolve(nodeId, stack = new Set()) {
        if (nodeId === null || !nodes.has(nodeId)) return '(unresolved-node)';
        if (cache.has(nodeId)) return cache.get(nodeId);
        if (stack.has(nodeId)) return `(cyclic-node-${nodeId})`;
        stack.add(nodeId);
        const node = nodes.get(nodeId);
        const parentPath = node.parentId !== null && nodes.has(node.parentId) ? resolve(node.parentId, stack) : '';
        const result = parentPath ? `${parentPath}/${node.name}` : node.name;
        cache.set(nodeId, result);
        stack.delete(nodeId);
        return result;
    }
    return resolve;
}

function findRootNodeIds(objects, nodes) {
    const roots = [];
    const first = objects[0] || {};
    const declaredRoot = getRefId(first.scene) !== null ? getRefId(first.scene) : getRefId(first.data);
    if (declaredRoot !== null && nodes.has(declaredRoot)) roots.push(declaredRoot);
    for (const node of nodes.values()) {
        if (node.parentId === null && !roots.includes(node.index)) roots.push(node.index);
    }
    return roots;
}

function estimateBatchBreaks(renderOrder) {
    const activeRenderers = renderOrder.filter(item => item.active && RENDERER_KINDS.has(item.kind));
    const result = {
        rendererCount: activeRenderers.length,
        textureSwitches: 0,
        materialSwitches: 0,
        blendSwitches: 0,
        maskBarriers: 0,
        estimatedBatches: activeRenderers.length ? 1 : 0,
        estimatedMergeRate: activeRenderers.length > 1 ? 1 : 0,
    };
    let previous = null;
    for (const current of activeRenderers) {
        let breaksBatch = false;
        if (current.kind === 'mask') {
            result.maskBarriers++;
            breaksBatch = true;
        }
        if (previous) {
            if (current.textureKey !== previous.textureKey) {
                result.textureSwitches++;
                breaksBatch = true;
            }
            if (current.materialKey !== previous.materialKey) {
                result.materialSwitches++;
                breaksBatch = true;
            }
            if (current.blendKey !== previous.blendKey) {
                result.blendSwitches++;
                breaksBatch = true;
            }
        }
        if (breaksBatch && previous) result.estimatedBatches++;
        previous = current;
    }
    if (activeRenderers.length > 1) {
        result.estimatedMergeRate = Math.max(0, 1 - ((result.estimatedBatches - 1) / (activeRenderers.length - 1)));
    }
    return result;
}

function buildRenderTree(renderOrder) {
    const textureGroups = new Map();
    for (const renderer of renderOrder.filter(item => RENDERER_KINDS.has(item.kind))) {
        if (!textureGroups.has(renderer.textureKey)) textureGroups.set(renderer.textureKey, new Map());
        const materials = textureGroups.get(renderer.textureKey);
        if (!materials.has(renderer.materialKey)) materials.set(renderer.materialKey, new Map());
        const blends = materials.get(renderer.materialKey);
        if (!blends.has(renderer.blendKey)) blends.set(renderer.blendKey, []);
        blends.get(renderer.blendKey).push({
            nodePath: renderer.nodePath,
            kind: renderer.kind,
            active: renderer.active,
        });
    }

    return [...textureGroups.entries()].map(([textureKey, materials]) => ({
        textureKey,
        materials: [...materials.entries()].map(([materialKey, blends]) => ({
            materialKey,
            blends: [...blends.entries()].map(([blendKey, renderers]) => ({ blendKey, renderers })),
        })),
    }));
}

function analyzeRenderDocument(objects, record) {
    const nodes = createNodeModel(objects);
    const resolveNodePath = createNodePathResolver(nodes);
    const components = [];
    const componentByIndex = new Map();
    const counts = {};

    for (let index = 0; index < objects.length; index++) {
        const component = objects[index];
        const kind = component && COMPONENT_KINDS[component.__type__];
        if (!kind) continue;
        const nodeId = getRefId(component.node) !== null ? getRefId(component.node) : getRefId(component._node);
        const node = nodeId !== null ? nodes.get(nodeId) : null;
        const descriptor = {
            componentIndex: index,
            type: component.__type__,
            kind,
            nodeId,
            nodePath: resolveNodePath(nodeId),
            active: Boolean(node && node.active && component._enabled !== false),
            textureKey: componentTextureKey(kind, component, index),
            materialKey: componentMaterialKey(component),
            blendKey: `${component._srcBlendFactor ?? 'default'}:${component._dstBlendFactor ?? 'default'}`,
            cacheMode: kind === 'label' || kind === 'richText' ? Number(component._cacheMode || 0) : null,
            textLength: kind === 'label' || kind === 'richText' ? String(component._string || '').length : null,
        };
        components.push(descriptor);
        componentByIndex.set(index, descriptor);
        counts[kind] = (counts[kind] || 0) + 1;
    }

    const maskNodeIds = new Set(components.filter(item => item.kind === 'mask' && item.nodeId !== null).map(item => item.nodeId));
    const nestedMasks = [];
    for (const maskNodeId of maskNodeIds) {
        let parentId = nodes.get(maskNodeId) ? nodes.get(maskNodeId).parentId : null;
        while (parentId !== null && nodes.has(parentId)) {
            if (maskNodeIds.has(parentId)) {
                nestedMasks.push({ nodePath: resolveNodePath(maskNodeId), ancestorPath: resolveNodePath(parentId) });
                break;
            }
            parentId = nodes.get(parentId).parentId;
        }
    }

    const renderOrder = [];
    const visited = new Set();
    let maxDepth = 0;
    function visit(nodeId, parentActive, depth) {
        if (!nodes.has(nodeId) || visited.has(nodeId)) return;
        visited.add(nodeId);
        maxDepth = Math.max(maxDepth, depth);
        const node = nodes.get(nodeId);
        const active = parentActive && node.active;
        for (const componentId of node.componentIds) {
            const descriptor = componentByIndex.get(componentId);
            if (descriptor) renderOrder.push({ ...descriptor, active: active && descriptor.active });
        }
        for (const childId of node.childIds) visit(childId, active, depth + 1);
    }
    for (const rootId of findRootNodeIds(objects, nodes)) visit(rootId, true, 0);
    for (const nodeId of nodes.keys()) visit(nodeId, true, 0);

    return {
        assetUuid: record.uuid,
        path: record.relativePath,
        dbUrl: record.dbUrl,
        kind: record.extension === '.scene' ? 'scene' : 'prefab',
        nodeCount: nodes.size,
        maxDepth,
        componentCounts: counts,
        components,
        nestedMasks,
        renderOrder,
        renderTree: buildRenderTree(renderOrder),
        estimatedBreaks: estimateBatchBreaks(renderOrder),
    };
}

async function analyzeSerializedAsset(record) {
    let value;
    try {
        value = await readJson(record.absolutePath);
    } catch (error) {
        return {
            relativePath: record.relativePath,
            dependencies: [],
            parseError: { path: record.relativePath, kind: 'asset', message: error.message },
            renderDocument: null,
            material: null,
        };
    }

    const dependencies = [...collectUuidDependencies(value)].sort();
    let renderDocument = null;
    let material = null;
    if (Array.isArray(value) && (record.extension === '.scene' || record.extension === '.prefab')) {
        renderDocument = analyzeRenderDocument(value, record);
    } else {
        const candidate = Array.isArray(value) ? value.find(item => item && item.__type__ === 'cc.Material') : value;
        if (candidate && candidate.__type__ === 'cc.Material') {
            material = {
                uuid: record.uuid,
                path: record.relativePath,
                dbUrl: record.dbUrl,
                effectUuid: getUuid(candidate._effectAsset),
                technique: Number(candidate._techIdx || 0),
                fingerprint: materialFingerprint(candidate),
            };
        }
    }

    return {
        relativePath: record.relativePath,
        dependencies,
        parseError: null,
        renderDocument,
        material,
    };
}

module.exports = {
    analyzeRenderDocument,
    analyzeSerializedAsset,
    collectUuidDependencies,
    estimateBatchBreaks,
    materialFingerprint,
    stableNormalize,
};
