'use strict';

const fs = require('fs');
const path = require('path');

const SEARCH_EXTENSIONS = new Set([
    '.prefab',
    '.scene',
    '.fire',
    '.anim',
    '.mtl',
    '.effect',
    '.labelatlas',
    '.pac',
    '.pmtl',
    '.json',
    '.jsx',
    '.plist',
    '.ts',
    '.tsx',
    '.js',
]);

const SERIALIZED_NODE_EXTENSIONS = new Set([
    '.prefab',
    '.scene',
    '.fire',
]);

const HIDE_IN_HIERARCHY_FLAG = 1 << 9;

const SKIP_NAMES = new Set([
    'node_modules',
    'library',
    'temp',
    'build',
    '.git',
]);

const SKIP_FILES = new Set([
    'project.manifest',
    'version.manifest',
]);

const PREFAB_EXTENSION = '.prefab';

function normalizePath(value) {
    return value.replace(/\\/g, '/');
}

function pathToDbUrl(projectRoot, fsPath) {
    const relative = normalizePath(path.relative(projectRoot, fsPath));
    if (!relative.startsWith('assets/')) {
        return normalizePath(fsPath);
    }
    return `db://${relative}`;
}

function readJson(filePath) {
    try {
        return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (error) {
        return null;
    }
}

function getAssetPathFromMetaPath(metaPath) {
    return metaPath.endsWith('.meta') ? metaPath.slice(0, -5) : metaPath;
}

function addSearchTerm(terms, seen, term, label) {
    if (!term || typeof term !== 'string') {
        return;
    }

    const normalized = normalizePath(term).replace(/^\/+/, '');
    if (!normalized || seen.has(normalized)) {
        return;
    }

    seen.add(normalized);
    terms.push({ term: normalized, label });
}

function collectSearchTerms(projectRoot, assetPath, dbUrl) {
    const terms = [];
    const seen = new Set();
    const relativePath = normalizePath(path.relative(projectRoot, assetPath));
    const assetsRelativePath = relativePath.replace(/^assets\//, '');
    const parsed = path.parse(assetsRelativePath);
    const withoutExt = normalizePath(path.join(parsed.dir, parsed.name));
    const resourcesPrefix = 'resources/';

    addSearchTerm(terms, seen, dbUrl, 'db url');
    addSearchTerm(terms, seen, relativePath, 'project path');
    addSearchTerm(terms, seen, assetsRelativePath, 'asset path');
    addSearchTerm(terms, seen, withoutExt, 'asset path without extension');
    if (withoutExt.startsWith(resourcesPrefix)) {
        addSearchTerm(terms, seen, withoutExt.slice(resourcesPrefix.length), 'resources path without extension');
    }

    return terms;
}

function addUuid(uuids, labels, uuid, label) {
    if (!uuid || typeof uuid !== 'string') {
        return;
    }
    uuids.add(uuid);
    if (!labels[uuid]) {
        labels[uuid] = new Set();
    }
    labels[uuid].add(label);
}

function collectSubMetas(subMetas, uuids, labels) {
    if (!subMetas || typeof subMetas !== 'object') {
        return;
    }

    for (const key of Object.keys(subMetas)) {
        const subMeta = subMetas[key];
        if (!subMeta || typeof subMeta !== 'object') {
            continue;
        }
        const label = subMeta.name || subMeta.importer || key;
        addUuid(uuids, labels, subMeta.uuid, label);
        collectSubMetas(subMeta.subMetas, uuids, labels);
    }
}

function collectAssetInfo(projectRoot, metaPath, selectedUuid) {
    const meta = readJson(metaPath);
    if (!meta) {
        return null;
    }

    const assetPath = getAssetPathFromMetaPath(metaPath);
    const dbUrl = pathToDbUrl(projectRoot, assetPath);
    const uuids = new Set();
    const labels = {};

    addUuid(uuids, labels, meta.uuid, 'asset');
    collectSubMetas(meta.subMetas, uuids, labels);

    if (selectedUuid) {
        addUuid(uuids, labels, selectedUuid, selectedUuid.includes('@') ? 'selected sub asset' : 'selected asset');
    }

    const uuidLabels = {};
    for (const uuid of uuids) {
        uuidLabels[uuid] = Array.from(labels[uuid] || []).sort();
    }

    return {
        name: path.basename(assetPath),
        assetPath,
        metaPath,
        dbUrl,
        extension: path.extname(assetPath).toLowerCase(),
        meta,
        uuids: Array.from(uuids).sort(),
        uuidLabels,
        searchTerms: collectSearchTerms(projectRoot, assetPath, dbUrl),
    };
}

function shouldSkipDir(dirName) {
    return SKIP_NAMES.has(dirName);
}

function shouldSearchFile(filePath) {
    const baseName = path.basename(filePath);
    if (baseName.endsWith('.meta') || SKIP_FILES.has(baseName)) {
        return false;
    }
    return SEARCH_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

function walkFiles(root, onFile) {
    const stack = [root];
    while (stack.length) {
        const dir = stack.pop();
        let entries = [];
        try {
            entries = fs.readdirSync(dir, { withFileTypes: true });
        } catch (error) {
            continue;
        }

        entries.sort((a, b) => a.name.localeCompare(b.name));
        for (let index = entries.length - 1; index >= 0; index -= 1) {
            const entry = entries[index];
            const fullPath = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                if (!shouldSkipDir(entry.name)) {
                    stack.push(fullPath);
                }
                continue;
            }
            if (entry.isFile()) {
                onFile(fullPath);
            }
        }
    }
}

function findMatchesInText(text, assetInfo) {
    const matched = [];
    for (const uuid of assetInfo.uuids) {
        if (text.includes(uuid)) {
            matched.push({
                uuid,
                labels: assetInfo.uuidLabels[uuid] || [],
            });
        }
    }
    return matched;
}

function findStringMatchesInText(text, assetInfo) {
    const matched = [];
    for (const item of assetInfo.searchTerms || []) {
        if (text.includes(item.term)) {
            matched.push(item);
        }
    }
    return matched;
}

function getSerializedId(value) {
    if (!value || typeof value !== 'object' || !Number.isInteger(value.__id__)) {
        return null;
    }
    return value.__id__;
}

function isSerializedNode(value) {
    return value && typeof value === 'object' && value.__type__ === 'cc.Node';
}

function getSerializedNodeName(node, nodeId) {
    if (!node || typeof node !== 'object') {
        return `node ${nodeId}`;
    }
    return node._name || node.name || `node ${nodeId}`;
}

function shouldShowSerializedNode(node) {
    if (!isSerializedNode(node)) {
        return false;
    }

    if ((node._objFlags || 0) & HIDE_IN_HIERARCHY_FLAG) {
        return false;
    }

    return node._name !== 'should_hide_in_hierarchy';
}

function buildSerializedNodePath(objects, nodeId, options) {
    const opts = options || {};
    const names = [];
    const visited = new Set();
    let currentId = nodeId;

    while (Number.isInteger(currentId) && objects[currentId] && !visited.has(currentId)) {
        visited.add(currentId);
        const node = objects[currentId];
        if (shouldShowSerializedNode(node)) {
            const name = getSerializedNodeName(node, currentId);
            names.push(opts.includeIds ? `${name}#${currentId}` : name);
        }
        currentId = getSerializedId(node._parent);
    }

    return names.reverse().join('/');
}

function getDisplayNodePath(objects, nodeId, reachable) {
    return buildSerializedNodePath(objects, nodeId, { includeIds: reachable === false });
}

function getOwningNodeId(object, index) {
    if (isSerializedNode(object)) {
        return index;
    }

    const directNodeId = getSerializedId(object && object.node);
    if (directNodeId !== null) {
        return directNodeId;
    }

    return getSerializedId(object && object._node);
}

function collectReachableSerializedIds(objects) {
    const reachable = new Set();
    const rootIds = [];

    if (objects[0] && objects[0].__type__ === 'cc.Prefab') {
        const prefabRootId = getSerializedId(objects[0].data);
        if (prefabRootId !== null) {
            rootIds.push(prefabRootId);
        }
    } else {
        objects.forEach((object, index) => {
            if (object && (object.__type__ === 'cc.Scene' || isSerializedNode(object)) && getSerializedId(object._parent) === null) {
                rootIds.push(index);
            }
        });
    }

    const stack = rootIds.slice();
    while (stack.length) {
        const currentId = stack.pop();
        if (!Number.isInteger(currentId) || reachable.has(currentId) || !objects[currentId]) {
            continue;
        }

        reachable.add(currentId);
        const object = objects[currentId];
        const childIds = [
            ...(object._children || []),
            ...(object._components || []),
            object._prefab,
            object.__prefab,
        ];

        for (const item of childIds) {
            const id = getSerializedId(item);
            if (id !== null) {
                stack.push(id);
            }
        }
    }

    return reachable;
}

function collectAllSerializedReferenceIds(value, ids) {
    if (!value || typeof value !== 'object') {
        return;
    }

    const id = getSerializedId(value);
    if (id !== null) {
        ids.add(id);
    }

    for (const child of Object.values(value)) {
        collectAllSerializedReferenceIds(child, ids);
    }
}

function collectGraphReachableIds(objects, startIds) {
    const reachable = new Set();
    const stack = startIds.slice();

    while (stack.length) {
        const currentId = stack.pop();
        if (!Number.isInteger(currentId) || currentId < 0 || currentId >= objects.length || reachable.has(currentId) || !objects[currentId]) {
            continue;
        }

        reachable.add(currentId);
        const ids = new Set();
        collectAllSerializedReferenceIds(objects[currentId], ids);
        for (const id of ids) {
            stack.push(id);
        }
    }

    return reachable;
}

function cloneJson(value) {
    return JSON.parse(JSON.stringify(value));
}

function remapSerializedIds(value, idMap) {
    if (!value || typeof value !== 'object') {
        return;
    }

    const id = getSerializedId(value);
    if (id !== null && idMap.has(id)) {
        value.__id__ = idMap.get(id);
    }

    for (const child of Object.values(value)) {
        remapSerializedIds(child, idMap);
    }
}

function getPrefabMainRootId(objects) {
    return objects[0] && objects[0].__type__ === 'cc.Prefab'
        ? getSerializedId(objects[0].data)
        : null;
}

function getMainRootPrefabInfoId(objects) {
    const mainRootId = getPrefabMainRootId(objects);
    return mainRootId !== null ? getSerializedId(objects[mainRootId] && objects[mainRootId]._prefab) : null;
}

function getStructuralSubtreeIds(objects, rootId) {
    const ids = new Set();
    const stack = [rootId];

    while (stack.length) {
        const id = stack.pop();
        if (!Number.isInteger(id) || ids.has(id) || !objects[id]) {
            continue;
        }

        ids.add(id);
        const object = objects[id];
        for (const item of [
            ...(object._children || []),
            ...(object._components || []),
            object._prefab,
            object.__prefab,
        ]) {
            const nextId = getSerializedId(item);
            if (nextId !== null) {
                stack.push(nextId);
            }
        }
    }

    return ids;
}

function getObjectTextSize(objects, ids) {
    let size = 0;
    for (const id of ids) {
        if (objects[id]) {
            size += JSON.stringify(objects[id]).length;
        }
    }
    return size;
}

function getPrefabUuidFromMeta(assetPath) {
    const meta = readJson(`${assetPath}.meta`);
    return meta && meta.uuid ? meta.uuid : '';
}

function getTargetLocalId(objects, targetOverride) {
    return getTargetInfoSummary(objects, targetOverride).targetLocalId;
}

function collectStaleMainRootTargetOverrides(objects) {
    const prefabInfoId = getMainRootPrefabInfoId(objects);
    const prefabInfo = prefabInfoId !== null ? objects[prefabInfoId] : null;
    if (!prefabInfo || !Array.isArray(prefabInfo.targetOverrides)) {
        return [];
    }

    const hierarchyReachableIds = collectReachableSerializedIds(objects);
    const stale = [];

    for (const item of prefabInfo.targetOverrides) {
        const overrideId = getSerializedId(item);
        const targetOverride = overrideId !== null ? objects[overrideId] : null;
        if (!targetOverride || targetOverride.__type__ !== 'cc.TargetOverrideInfo') {
            continue;
        }

        const targetId = getSerializedId(targetOverride.target);
        if (targetId === null || hierarchyReachableIds.has(targetId)) {
            continue;
        }

        stale.push({
            objectId: overrideId,
            propertyPath: getPropertyPath(targetOverride.propertyPath),
            targetId,
            targetPath: getDisplayNodePath(objects, targetId, false),
            targetInfoId: getSerializedId(targetOverride.targetInfo),
            targetLocalId: getTargetLocalId(objects, targetOverride),
        });
    }

    return stale;
}

function collectHiddenSelfPrefabRoots(objects, selfUuid) {
    const mainRootId = getPrefabMainRootId(objects);
    if (!selfUuid || mainRootId === null) {
        return [];
    }

    const byRootId = new Map();
    objects.forEach((object, index) => {
        if (!object || object.__type__ !== 'cc.PrefabInfo' || !object.asset || object.asset.__uuid__ !== selfUuid) {
            return;
        }

        const rootId = getSerializedId(object.root);
        if (rootId === null || rootId === mainRootId) {
            return;
        }

        if (!byRootId.has(rootId)) {
            const subtreeIds = getStructuralSubtreeIds(objects, rootId);
            byRootId.set(rootId, {
                rootId,
                path: getDisplayNodePath(objects, rootId, false),
                prefabInfoCount: 0,
                objectCount: subtreeIds.size,
                approxBytes: getObjectTextSize(objects, subtreeIds),
            });
        }
        byRootId.get(rootId).prefabInfoCount += 1;
    });

    return Array.from(byRootId.values()).sort((a, b) => b.objectCount - a.objectCount);
}

function removeTargetOverridesById(objects, overrideIds) {
    const ids = new Set(overrideIds);
    for (const object of objects) {
        if (!object || !Array.isArray(object.targetOverrides)) {
            continue;
        }

        object.targetOverrides = object.targetOverrides.filter((item) => !ids.has(getSerializedId(item)));
        if (!object.targetOverrides.length) {
            object.targetOverrides = null;
        }
    }
}

function compactSerializedObjects(objects, keepIds) {
    const idMap = new Map();
    const compacted = [];

    for (let index = 0; index < objects.length; index += 1) {
        if (!keepIds.has(index)) {
            continue;
        }
        idMap.set(index, compacted.length);
        compacted.push(objects[index]);
    }

    for (const object of compacted) {
        remapSerializedIds(object, idMap);
    }

    return compacted;
}

function buildPrefabCleanupPlan(assetPath) {
    if (path.extname(assetPath).toLowerCase() !== PREFAB_EXTENSION) {
        return null;
    }

    const objects = readJson(assetPath);
    if (!Array.isArray(objects) || !objects[0] || objects[0].__type__ !== 'cc.Prefab') {
        return null;
    }

    const selfUuid = getPrefabUuidFromMeta(assetPath);
    const staleOverrides = collectStaleMainRootTargetOverrides(objects);
    const hiddenSelfRoots = collectHiddenSelfPrefabRoots(objects, selfUuid);
    const workingObjects = cloneJson(objects);
    removeTargetOverridesById(workingObjects, staleOverrides.map((item) => item.objectId));
    const reachableAfterCleanup = collectGraphReachableIds(workingObjects, [0]);
    const removedObjectCount = workingObjects.length - reachableAfterCleanup.size;

    return {
        canClean: staleOverrides.length > 0 && removedObjectCount > 0,
        objectCount: objects.length,
        reachableAfterCleanupCount: reachableAfterCleanup.size,
        removedObjectCount,
        staleOverrides,
        hiddenSelfRoots,
    };
}

function makeBackupPath(projectRoot, assetPath) {
    const relative = normalizePath(path.relative(projectRoot, assetPath)).replace(/[/:*?"<>|]/g, '_');
    const timestamp = new Date().toISOString().replace(/[-:T.Z]/g, '').slice(0, 14);
    return path.join(projectRoot, 'temp', 'asset-reference-finder-backups', `${relative}.${timestamp}.bak`);
}

function cleanPrefabRedundancy(projectRoot, assetPath) {
    const beforeText = fs.readFileSync(assetPath, 'utf8');
    const objects = JSON.parse(beforeText);
    const plan = buildPrefabCleanupPlan(assetPath);
    if (!plan || !plan.canClean) {
        return {
            ok: false,
            message: '\u6ca1\u6709\u53d1\u73b0\u53ef\u81ea\u52a8\u6e05\u7406\u7684\u9690\u85cf\u5197\u4f59\u3002',
            plan,
        };
    }

    const workingObjects = cloneJson(objects);
    removeTargetOverridesById(workingObjects, plan.staleOverrides.map((item) => item.objectId));
    const keepIds = collectGraphReachableIds(workingObjects, [0]);
    const compacted = compactSerializedObjects(workingObjects, keepIds);
    const afterText = `${JSON.stringify(compacted, null, 2)}\n`;
    const backupPath = makeBackupPath(projectRoot, assetPath);

    fs.mkdirSync(path.dirname(backupPath), { recursive: true });
    fs.writeFileSync(backupPath, beforeText, 'utf8');
    fs.writeFileSync(assetPath, afterText, 'utf8');

    return {
        ok: true,
        backupPath: normalizePath(backupPath),
        removedObjectCount: objects.length - compacted.length,
        removedOverrideCount: plan.staleOverrides.length,
        beforeBytes: Buffer.byteLength(beforeText),
        afterBytes: Buffer.byteLength(afterText),
        plan,
    };
}

function findObjectUuidMatches(objectText, assetInfo) {
    const matched = [];
    for (const uuid of assetInfo.uuids) {
        if (objectText.includes(uuid)) {
            matched.push({
                uuid,
                labels: assetInfo.uuidLabels[uuid] || [],
            });
        }
    }
    return matched;
}

function findSerializedIds(value, predicate, pathParts, hits) {
    if (!value || typeof value !== 'object') {
        return hits;
    }

    if (typeof value.__uuid__ === 'string' && predicate(value.__uuid__)) {
        hits.push({
            path: pathParts.join('.'),
            uuid: value.__uuid__,
            expectedType: value.__expectedType__ || '',
        });
    }

    const id = getSerializedId(value);
    if (id !== null) {
        hits.push({
            path: pathParts.join('.'),
            id,
        });
    }

    for (const [key, child] of Object.entries(value)) {
        findSerializedIds(child, predicate, pathParts.concat(key), hits);
    }

    return hits;
}

function getPropertyPath(value) {
    if (!Array.isArray(value)) {
        return '';
    }
    return value.filter((item) => typeof item === 'string' || typeof item === 'number').join('.');
}

function getTargetInfoSummary(objects, object) {
    const targetInfoId = getSerializedId(object && object.targetInfo);
    const targetInfo = targetInfoId !== null ? objects[targetInfoId] : null;
    const localIds = targetInfo && Array.isArray(targetInfo.localID)
        ? targetInfo.localID.filter((item) => typeof item === 'string' || typeof item === 'number').map(String)
        : [];

    return {
        targetInfoId,
        targetLocalId: localIds.join(', '),
    };
}

function findTargetOverrideOwner(objects, overrideId, reachableIds) {
    for (let index = 0; index < objects.length; index += 1) {
        const object = objects[index];
        if (!object || object.__type__ !== 'cc.PrefabInfo' || !Array.isArray(object.targetOverrides)) {
            continue;
        }

        const hasOverride = object.targetOverrides.some((item) => getSerializedId(item) === overrideId);
        if (!hasOverride) {
            continue;
        }

        const ownerRootId = getSerializedId(object.root);
        return {
            ownerPrefabInfoId: index,
            ownerRootId,
            ownerRootPath: ownerRootId !== null ? getDisplayNodePath(objects, ownerRootId, reachableIds.has(ownerRootId)) : '',
            ownerReachable: ownerRootId !== null ? reachableIds.has(ownerRootId) : reachableIds.has(index),
        };
    }

    return {
        ownerPrefabInfoId: null,
        ownerRootId: null,
        ownerRootPath: '',
        ownerReachable: null,
    };
}

function getComponentType(object) {
    if (!object || !object.__type__) {
        return '';
    }
    return object.__type__;
}

function describeUuidHit(object, hit) {
    if (object && object.__type__ === 'cc.PrefabInfo' && hit.path === 'asset') {
        return 'prefab asset';
    }
    if (hit.expectedType) {
        return hit.expectedType.replace(/^cc\./, '');
    }
    return hit.path || 'uuid';
}

function findSerializedAssetLinks(objects, assetInfo, reachableIds) {
    const uuidSet = new Set(assetInfo.uuids || []);
    const links = [];

    objects.forEach((object, index) => {
        if (!object || typeof object !== 'object') {
            return;
        }

        const uuidHits = findSerializedIds(object, (uuid) => uuidSet.has(uuid), [], [])
            .filter((hit) => hit.uuid);
        if (!uuidHits.length) {
            return;
        }

        const nodeId = getOwningNodeId(object, index);
        const reachable = nodeId !== null
            ? reachableIds.has(nodeId) && reachableIds.has(index)
            : reachableIds.has(index);
        const nodePath = nodeId !== null ? getDisplayNodePath(objects, nodeId, reachable) : '';
        const targetRootId = object.__type__ === 'cc.PrefabInfo' ? getSerializedId(object.root) : null;
        const targetRootPath = targetRootId !== null ? getDisplayNodePath(objects, targetRootId, reachableIds.has(targetRootId)) : '';

        for (const hit of uuidHits) {
            links.push({
                objectId: index,
                objectType: getComponentType(object),
                nodeId,
                nodePath,
                targetRootId,
                targetRootPath,
                reachable,
                fieldPath: hit.path,
                kind: describeUuidHit(object, hit),
                uuid: hit.uuid,
            });
        }
    });

    return links;
}

function collectLinkHolders(objects, links, reachableIds) {
    const targetRootIds = new Set();
    const prefabInfoIds = new Set();
    for (const link of links) {
        if (link.targetRootId !== null) {
            targetRootIds.add(link.targetRootId);
        }
        if (link.kind === 'prefab asset') {
            prefabInfoIds.add(link.objectId);
        }
    }

    if (!targetRootIds.size && !prefabInfoIds.size) {
        return [];
    }

    const prefabOwnerNodeIds = collectPrefabOwnerNodes(objects, prefabInfoIds);
    const targetNodeIds = collectSerializedNodeDescendants(objects, new Set([
        ...targetRootIds,
        ...prefabOwnerNodeIds,
        ...collectAncestorNodeIds(objects, prefabOwnerNodeIds),
    ]));
    const holders = [];
    objects.forEach((object, index) => {
        if (!object || typeof object !== 'object') {
            return;
        }

        const hits = findSerializedIds(object, () => false, [], [])
            .filter((hit) => hit.id !== undefined && (targetNodeIds.has(hit.id) || prefabInfoIds.has(hit.id)));
        if (!hits.length) {
            return;
        }

        const nodeId = getOwningNodeId(object, index);
        const reachable = nodeId !== null
            ? reachableIds.has(nodeId) && reachableIds.has(index)
            : reachableIds.has(index);
        const nodePath = nodeId !== null ? getDisplayNodePath(objects, nodeId, reachable) : '';

        for (const hit of hits) {
            const relationKind = getHolderRelationKind(object, hit.path);
            if (!relationKind) {
                continue;
            }

            const targetIsPrefabInfo = prefabInfoIds.has(hit.id);
            const propertyPath = object.__type__ === 'cc.TargetOverrideInfo'
                ? getPropertyPath(object.propertyPath)
                : hit.path;
            const targetInfo = object.__type__ === 'cc.TargetOverrideInfo'
                ? getTargetInfoSummary(objects, object)
                : { targetInfoId: null, targetLocalId: '' };
            const overrideOwner = object.__type__ === 'cc.TargetOverrideInfo'
                ? findTargetOverrideOwner(objects, index, reachableIds)
                : {
                    ownerPrefabInfoId: null,
                    ownerRootId: null,
                    ownerRootPath: '',
                    ownerReachable: null,
                };
            holders.push({
                objectId: index,
                objectType: getComponentType(object),
                nodeId,
                nodePath,
                reachable,
                targetReachable: reachableIds.has(hit.id),
                fieldPath: hit.path,
                propertyPath,
                kind: relationKind,
                targetNodeId: hit.id,
                targetPath: targetIsPrefabInfo ? nodePath : getDisplayNodePath(objects, hit.id, reachableIds.has(hit.id)),
                targetInfoId: targetInfo.targetInfoId,
                targetLocalId: targetInfo.targetLocalId,
                ownerPrefabInfoId: overrideOwner.ownerPrefabInfoId,
                ownerRootId: overrideOwner.ownerRootId,
                ownerRootPath: overrideOwner.ownerRootPath,
                ownerReachable: overrideOwner.ownerReachable,
            });
        }
    });

    return holders;
}

function collectPrefabOwnerNodes(objects, prefabInfoIds) {
    const ownerIds = new Set();
    if (!prefabInfoIds.size) {
        return ownerIds;
    }

    objects.forEach((object, index) => {
        if (!isSerializedNode(object)) {
            return;
        }

        const prefabId = getSerializedId(object._prefab);
        const internalPrefabId = getSerializedId(object.__prefab);
        if (prefabInfoIds.has(prefabId) || prefabInfoIds.has(internalPrefabId)) {
            ownerIds.add(index);
        }
    });

    return ownerIds;
}

function collectAncestorNodeIds(objects, nodeIds) {
    const ancestorIds = new Set();

    for (const nodeId of nodeIds) {
        let currentId = nodeId;
        const visited = new Set();
        while (Number.isInteger(currentId) && objects[currentId] && !visited.has(currentId)) {
            visited.add(currentId);
            if (isSerializedNode(objects[currentId])) {
                ancestorIds.add(currentId);
            }
            currentId = getSerializedId(objects[currentId]._parent);
        }
    }

    return ancestorIds;
}

function collectSerializedNodeDescendants(objects, rootIds) {
    const ids = new Set();
    const stack = Array.from(rootIds);

    while (stack.length) {
        const id = stack.pop();
        if (!Number.isInteger(id) || ids.has(id) || !objects[id]) {
            continue;
        }

        ids.add(id);
        const object = objects[id];
        for (const child of object._children || []) {
            const childId = getSerializedId(child);
            if (childId !== null) {
                stack.push(childId);
            }
        }
    }

    return ids;
}

function isEngineComponentType(type) {
    return !type || type.startsWith('cc.') || type.startsWith('sp.') || type.includes('Prefab');
}

function getHolderRelationKind(object, fieldPath) {
    if (!object || !fieldPath) {
        return '';
    }

    if (fieldPath === 'node' || fieldPath === '_node') {
        return '';
    }

    if (isSerializedNode(object) && (fieldPath === '_prefab' || fieldPath === '__prefab')) {
        return 'prefab owner';
    }

    if (object.__type__ === 'cc.TargetOverrideInfo' && fieldPath === 'target') {
        return 'target override';
    }

    if (object.__type__ === 'cc.PrefabInstance' && fieldPath === 'prefabRootNode') {
        return 'prefab instance root';
    }

    if (!isEngineComponentType(object.__type__) && !fieldPath.includes('.') && !fieldPath.startsWith('_')) {
        return 'script field';
    }

    return '';
}

function uniqueBy(items, getKey) {
    const seen = new Set();
    const output = [];
    for (const item of items) {
        const key = getKey(item);
        if (seen.has(key)) {
            continue;
        }
        seen.add(key);
        output.push(item);
    }
    return output;
}

function summarizeAssetLinks(links) {
    const prefabLinks = links.filter((item) => item.kind === 'prefab asset' && item.targetRootId !== null);
    const otherLinks = links.filter((item) => !(item.kind === 'prefab asset' && item.targetRootId !== null));
    const grouped = new Map();

    for (const link of prefabLinks) {
        const key = [
            link.targetRootId,
            link.targetRootPath,
            link.reachable,
            link.fieldPath,
            link.uuid,
        ].join('|');
        if (!grouped.has(key)) {
            grouped.set(key, {
                ...link,
                count: 0,
            });
        }
        grouped.get(key).count += 1;
    }

    return Array.from(grouped.values()).concat(otherLinks);
}

function findSerializedAssetRelations(text, filePath, assetInfo) {
    if (!SERIALIZED_NODE_EXTENSIONS.has(path.extname(filePath).toLowerCase())) {
        return [];
    }

    let objects = null;
    try {
        objects = JSON.parse(text);
    } catch (error) {
        return [];
    }

    if (!Array.isArray(objects)) {
        return [];
    }

    const reachableIds = collectReachableSerializedIds(objects);
    const links = summarizeAssetLinks(findSerializedAssetLinks(objects, assetInfo, reachableIds));
    const holders = collectLinkHolders(objects, links, reachableIds);

    return uniqueBy(links.concat(holders), (item) => [
        item.objectId,
        item.objectType,
        item.nodePath,
        item.targetRootPath,
        item.targetPath,
        item.propertyPath,
        item.fieldPath,
        item.targetInfoId,
        item.targetLocalId,
        item.ownerPrefabInfoId,
        item.ownerRootPath,
        item.reachable,
        item.targetReachable,
        item.ownerReachable,
    ].join('|')).sort((a, b) => {
        const left = `${a.reachable && a.targetReachable !== false && a.ownerReachable !== false ? '0' : '1'}:${a.ownerRootPath || ''}:${a.nodePath || a.targetPath || a.targetRootPath || ''}:${a.propertyPath || a.fieldPath || ''}:${a.targetLocalId || ''}`;
        const right = `${b.reachable && b.targetReachable !== false && b.ownerReachable !== false ? '0' : '1'}:${b.ownerRootPath || ''}:${b.nodePath || b.targetPath || b.targetRootPath || ''}:${b.propertyPath || b.fieldPath || ''}:${b.targetLocalId || ''}`;
        return left.localeCompare(right);
    });
}

function findSerializedNodeReferences(text, filePath, assetInfo) {
    if (!SERIALIZED_NODE_EXTENSIONS.has(path.extname(filePath).toLowerCase())) {
        return [];
    }

    let objects = null;
    try {
        objects = JSON.parse(text);
    } catch (error) {
        return [];
    }

    if (!Array.isArray(objects)) {
        return [];
    }

    const byNode = new Map();
    const reachableIds = collectReachableSerializedIds(objects);

    objects.forEach((object, index) => {
        if (!object || typeof object !== 'object') {
            return;
        }

        let objectText = '';
        try {
            objectText = JSON.stringify(object);
        } catch (error) {
            return;
        }

        const matches = findObjectUuidMatches(objectText, assetInfo);
        if (!matches.length) {
            return;
        }

        const nodeId = getOwningNodeId(object, index);
        if (nodeId === null || !objects[nodeId]) {
            return;
        }

        const reachable = reachableIds.has(nodeId) && reachableIds.has(index);
        const nodePath = getDisplayNodePath(objects, nodeId, reachable);
        if (!nodePath) {
            return;
        }

        if (!byNode.has(nodePath)) {
            byNode.set(nodePath, {
                path: nodePath,
                nodeId,
                active: objects[nodeId] && objects[nodeId]._active !== false,
                reachable,
                componentTypes: new Set(),
                matches: new Map(),
            });
        }

        const entry = byNode.get(nodePath);
        entry.reachable = entry.reachable || reachable;
        if (object.__type__) {
            entry.componentTypes.add(object.__type__);
        }
        for (const match of matches) {
            entry.matches.set(match.uuid, match);
        }
    });

    return Array.from(byNode.values())
        .map((entry) => ({
            path: entry.path,
            nodeId: entry.nodeId,
            active: entry.active,
            reachable: entry.reachable,
            componentTypes: Array.from(entry.componentTypes).sort(),
            matches: Array.from(entry.matches.values()).sort((a, b) => a.uuid.localeCompare(b.uuid)),
        }))
        .sort((a, b) => a.path.localeCompare(b.path));
}

function findReferences(projectRoot, assetInfo, options) {
    const opts = options || {};
    const roots = opts.roots || [path.join(projectRoot, 'assets')];
    const targetAssetPath = path.resolve(assetInfo.assetPath);
    const targetMetaPath = path.resolve(assetInfo.metaPath);
    const references = [];
    const stringReferences = [];
    let scanned = 0;

    for (const root of roots) {
        if (!fs.existsSync(root)) {
            continue;
        }

        walkFiles(root, (filePath) => {
            const resolved = path.resolve(filePath);
            const selectedIsSerializedAsset = SERIALIZED_NODE_EXTENSIONS.has(assetInfo.extension);
            const isSelectedAssetFile = resolved === targetAssetPath;
            if ((isSelectedAssetFile && !selectedIsSerializedAsset) || resolved === targetMetaPath || !shouldSearchFile(filePath)) {
                return;
            }

            let text = '';
            try {
                text = fs.readFileSync(filePath, 'utf8');
            } catch (error) {
                return;
            }

            scanned += 1;
            const matches = findMatchesInText(text, assetInfo);
            const stringMatches = findStringMatchesInText(text, assetInfo);
            const primaryPath = normalizePath(path.relative(projectRoot, filePath));

            if (matches.length) {
                references.push({
                    path: primaryPath,
                    dbUrl: pathToDbUrl(projectRoot, filePath),
                    matches,
                    nodeReferences: findSerializedNodeReferences(text, filePath, assetInfo),
                    assetRelations: findSerializedAssetRelations(text, filePath, assetInfo),
                });
            }

            if (stringMatches.length && !matches.length) {
                stringReferences.push({
                    path: primaryPath,
                    dbUrl: pathToDbUrl(projectRoot, filePath),
                    matches: stringMatches,
                });
            }
        });
    }

    references.sort((a, b) => a.path.localeCompare(b.path));
    stringReferences.sort((a, b) => a.path.localeCompare(b.path));

    const result = {
        asset: {
            name: assetInfo.name,
            path: normalizePath(path.relative(projectRoot, assetInfo.assetPath)),
            dbUrl: assetInfo.dbUrl,
            uuids: assetInfo.uuids,
            uuidLabels: assetInfo.uuidLabels,
            searchTerms: assetInfo.searchTerms || [],
        },
        scanned,
        count: references.length,
        stringCount: stringReferences.length,
        references,
        stringReferences,
        generatedAt: new Date().toISOString(),
    };

    result.cleanupPlan = buildPrefabCleanupPlan(assetInfo.assetPath);
    return result;
}

function buildTree(paths) {
    const root = { children: new Map(), file: null };
    for (const filePath of paths) {
        const parts = normalizePath(filePath).split('/').filter(Boolean);
        let node = root;
        for (const part of parts) {
            if (!node.children.has(part)) {
                node.children.set(part, { children: new Map(), file: null });
            }
            node = node.children.get(part);
        }
        node.file = filePath;
    }
    return root;
}

function renderTree(node, prefix, lines) {
    const entries = Array.from(node.children.entries()).sort((a, b) => a[0].localeCompare(b[0]));
    entries.forEach(([name, child], index) => {
        const isLast = index === entries.length - 1;
        const connector = isLast ? '\u2514\u2500 ' : '\u251c\u2500 ';
        lines.push(`${prefix}${connector}${name}`);
        renderTree(child, `${prefix}${isLast ? '   ' : '\u2502  '}`, lines);
    });
}

function formatUuidLines(result) {
    return result.asset.uuids.map((uuid) => {
        const labels = result.asset.uuidLabels[uuid] || [];
        return `  - ${uuid}${labels.length ? ` (${labels.join(', ')})` : ''}`;
    });
}

function formatReferenceReport(result) {
    const lines = [];
    lines.push('[AssetRef] Reference report');
    lines.push(`[AssetRef] Asset: ${result.asset.dbUrl}`);
    lines.push('[AssetRef] UUIDs:');
    lines.push(...formatUuidLines(result).map((line) => `[AssetRef] ${line}`));
    lines.push(`[AssetRef] Scanned files: ${result.scanned}`);
    lines.push(`[AssetRef] References: ${result.count}`);
    lines.push(`[AssetRef] Possible string references: ${result.stringCount || 0}`);

    if (!result.references.length && !(result.stringReferences && result.stringReferences.length)) {
        lines.push('[AssetRef] No references found in source assets or code strings.');
        return lines.join('\n');
    }

    if (result.references.length) {
        lines.push('[AssetRef] Files:');
        const tree = buildTree(result.references.map((item) => item.path));
        const treeLines = [];
        renderTree(tree, '', treeLines);
        lines.push(...treeLines.map((line) => `[AssetRef] ${line}`));

        lines.push('[AssetRef] Details:');
        for (const reference of result.references) {
            const matchSummary = reference.matches
                .map((match) => `${match.uuid}${match.labels.length ? ` (${match.labels.join(', ')})` : ''}`)
                .join(', ');
            lines.push(`[AssetRef] - ${reference.path}: ${matchSummary}`);
        }
    }

    if (result.stringReferences && result.stringReferences.length) {
        lines.push('[AssetRef] Possible string reference files:');
        const stringTree = buildTree(result.stringReferences.map((item) => item.path));
        const stringTreeLines = [];
        renderTree(stringTree, '', stringTreeLines);
        lines.push(...stringTreeLines.map((line) => `[AssetRef] ${line}`));

        lines.push('[AssetRef] Possible string reference details:');
        for (const reference of result.stringReferences) {
            const matchSummary = reference.matches
                .map((match) => `${match.term} (${match.label})`)
                .join(', ');
            lines.push(`[AssetRef] - ${reference.path}: ${matchSummary}`);
        }
    }

    return lines.join('\n');
}

module.exports = {
    collectAssetInfo,
    cleanPrefabRedundancy,
    findReferences,
    formatReferenceReport,
    pathToDbUrl,
};
