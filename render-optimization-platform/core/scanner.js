'use strict';

const fs = require('fs');
const path = require('path');
const { applyDependencies, buildAssetIndex } = require('./asset-index');
const {
    IMAGE_EXTENSIONS,
    PLUGIN_VERSION,
    REPORT_SCHEMA_VERSION,
    RENDERER_KINDS,
    STRUCTURED_EXTENSIONS,
} = require('./constants');
const {
    assertNotCancelled,
    hashFile,
    readJson,
    walkFiles,
    yieldToEventLoop,
} = require('./file-system');
const { runRules } = require('./rules');
const { analyzeSerializedAsset } = require('./serialized-analyzer');

const LIMITATIONS = [
    '静态扫描不能得到实际 DrawCall、FPS、CPU Render、GPU 时间、GC 和 Buffer 上传字节数。',
    '动态创建、动态加载、运行时显隐、动态图集和 MaterialInstance 会改变真实渲染顺序。',
    '静态批次数据基于序列化 Node DFS，仅用于定位候选，不能替代设备运行时采样。',
    'resources、Bundle 和字符串路径加载可能不出现在 UUID 依赖图中，未引用资源不能自动删除。',
    'Auto Atlas 源面积不等于构建后的图集利用率，最终尺寸以构建产物为准。',
    'Creator 3.8.6 的 Batcher2D、RenderData 和 MeshBuffer 属于私有或已弃用接口，升级引擎必须复核。',
];

async function readCreatorVersion(projectRoot) {
    try {
        const pkg = await readJson(path.join(projectRoot, 'package.json'));
        return (pkg.creator && pkg.creator.version) || pkg.version || 'unknown';
    } catch (error) {
        return 'unknown';
    }
}

function publicAssetRecord(record) {
    return {
        uuid: record.uuid,
        subUuids: record.subUuids,
        dbUrl: record.dbUrl,
        relativePath: record.relativePath,
        extension: record.extension,
        importer: record.importer,
        byteSize: record.byteSize,
        texture: record.texture,
        dependencies: record.dependencies,
        referencedBy: record.referencedBy,
        parseStatus: record.parseStatus,
        parseError: record.parseError,
        dynamicLoadRisk: record.dynamicLoadRisk,
        atlasPath: record.atlasPath,
    };
}

function countComponents(renderDocuments) {
    const counts = {};
    for (const document of renderDocuments) {
        for (const [kind, count] of Object.entries(document.componentCounts)) {
            counts[kind] = (counts[kind] || 0) + count;
        }
    }
    return counts;
}

function countBy(items, selectKey) {
    const result = {};
    for (const item of items) {
        const key = selectKey(item);
        result[key] = (result[key] || 0) + 1;
    }
    return result;
}

function buildSummary(scan, findings) {
    const componentCounts = countComponents(scan.renderDocuments);
    const textures = scan.assetIndex.records.filter(record => record.texture);
    return {
        assetCount: scan.assetIndex.records.length,
        sceneCount: scan.renderDocuments.filter(document => document.kind === 'scene').length,
        prefabCount: scan.renderDocuments.filter(document => document.kind === 'prefab').length,
        textureCount: textures.length,
        materialCount: scan.materials.length,
        atlasCount: scan.assetIndex.records.filter(record => record.extension === '.pac').length,
        scriptCount: scan.assetIndex.records.filter(record => record.extension === '.ts' || record.extension === '.js').length,
        nodeCount: scan.renderDocuments.reduce((sum, document) => sum + document.nodeCount, 0),
        rendererCount: Object.entries(componentCounts).reduce((sum, [kind, count]) => sum + (RENDERER_KINDS.has(kind) ? count : 0), 0),
        componentCounts,
        findingCount: findings.length,
        findingsBySeverity: countBy(findings, finding => finding.severity),
        findingsByCategory: countBy(findings, finding => finding.category),
    };
}

function buildMetrics(scan) {
    const textures = scan.assetIndex.records.filter(record => record.texture);
    const breakTotals = scan.renderDocuments.reduce((result, document) => {
        const current = document.estimatedBreaks;
        result.rendererCount += current.rendererCount;
        result.estimatedBatches += current.estimatedBatches;
        result.textureSwitches += current.textureSwitches;
        result.materialSwitches += current.materialSwitches;
        result.blendSwitches += current.blendSwitches;
        result.maskBarriers += current.maskBarriers;
        return result;
    }, { rendererCount: 0, estimatedBatches: 0, textureSwitches: 0, materialSwitches: 0, blendSwitches: 0, maskBarriers: 0 });

    return {
        textureSourceBytes: textures.reduce((sum, record) => sum + record.byteSize, 0),
        textureRgbaMemoryUpperBound: textures.reduce((sum, record) => sum + record.texture.rgbaMemoryBytes, 0),
        exactDuplicateTextureGroups: [...scan.textureHashes.values()].filter(records => records.length > 1).length,
        equivalentMaterialGroups: [...scan.materialGroups.values()].filter(materials => materials.length > 1).length,
        staticRenderEstimate: breakTotals,
        runtime: {
            available: false,
            drawCalls: null,
            fps: null,
            cpuRenderMs: null,
            renderDataAllocations: null,
            vertexUploadBytes: null,
            indexUploadBytes: null,
        },
    };
}

async function scanProject(projectRoot, options = {}) {
    const root = path.resolve(projectRoot);
    const assetsRoot = path.join(root, 'assets');
    if (!fs.existsSync(assetsRoot)) throw new Error(`Cocos assets directory not found: ${assetsRoot}`);
    const signal = options.signal || { cancelled: false };
    const onProgress = options.onProgress || (() => {});
    const startedAt = Date.now();

    onProgress({ phase: 'discover', current: 0, total: 0, message: 'Discovering assets' });
    const files = await walkFiles(assetsRoot, { signal, onProgress });
    assertNotCancelled(signal);

    onProgress({ phase: 'index', current: 0, total: files.length, message: 'Indexing metadata' });
    const assetIndex = await buildAssetIndex(root, files, { signal, onProgress });
    const structuredRecords = assetIndex.records.filter(record => STRUCTURED_EXTENSIONS.has(record.extension));
    const dependencyEntries = [];
    const renderDocuments = [];
    const materials = [];
    const parseErrors = [];

    for (let index = 0; index < structuredRecords.length; index++) {
        assertNotCancelled(signal);
        const record = structuredRecords[index];
        const result = await analyzeSerializedAsset(record);
        dependencyEntries.push({ relativePath: result.relativePath, dependencies: result.dependencies });
        if (result.renderDocument) renderDocuments.push(result.renderDocument);
        if (result.material) materials.push(result.material);
        if (result.parseError) parseErrors.push(result.parseError);
        if ((index + 1) % 20 === 0 || index + 1 === structuredRecords.length) {
            onProgress({ phase: 'analyze', current: index + 1, total: structuredRecords.length, message: 'Analyzing serialized assets' });
            await yieldToEventLoop();
        }
    }

    applyDependencies(assetIndex, dependencyEntries);
    const textureRecords = assetIndex.records.filter(record => record.texture && IMAGE_EXTENSIONS.has(record.extension));
    const textureHashes = new Map();
    for (let index = 0; index < textureRecords.length; index++) {
        assertNotCancelled(signal);
        const record = textureRecords[index];
        try {
            const hash = await hashFile(record.absolutePath);
            if (!textureHashes.has(hash)) textureHashes.set(hash, []);
            textureHashes.get(hash).push(record);
        } catch (error) {
            parseErrors.push({ path: record.relativePath, kind: 'hash', message: error.message });
        }
        if ((index + 1) % 40 === 0 || index + 1 === textureRecords.length) {
            onProgress({ phase: 'hash', current: index + 1, total: textureRecords.length, message: 'Hashing textures' });
            await yieldToEventLoop();
        }
    }

    const materialGroups = new Map();
    for (const material of materials) {
        if (!materialGroups.has(material.fingerprint)) materialGroups.set(material.fingerprint, []);
        materialGroups.get(material.fingerprint).push(material);
    }

    const scan = { assetIndex, renderDocuments, materials, materialGroups, textureHashes, parseErrors };
    onProgress({ phase: 'rules', current: 0, total: 0, message: 'Evaluating optimization rules' });
    const findings = runRules(scan);
    const generatedAt = new Date().toISOString();
    const summary = buildSummary(scan, findings);
    const metrics = buildMetrics(scan);

    const report = {
        schemaVersion: REPORT_SCHEMA_VERSION,
        pluginVersion: PLUGIN_VERSION,
        creatorVersion: await readCreatorVersion(root),
        project: { name: path.basename(root), path: root },
        generatedAt,
        durationMs: Date.now() - startedAt,
        cancelled: false,
        partial: assetIndex.parseErrors.length > 0 || parseErrors.length > 0,
        coverage: {
            discoveredFiles: files.length,
            indexedAssets: assetIndex.records.length,
            metadataFiles: files.filter(file => file.extension === '.meta').length,
            structuredAssets: structuredRecords.length,
            analyzedRenderDocuments: renderDocuments.length,
            parseErrors: assetIndex.parseErrors.length + parseErrors.length,
        },
        summary,
        metrics,
        findings,
        assets: assetIndex.records.map(publicAssetRecord),
        renderDocuments,
        materials,
        dependencyGraph: assetIndex.records
            .filter(record => record.dependencies.length || record.referencedBy.length)
            .map(record => ({ uuid: record.uuid, path: record.relativePath, dependencies: record.dependencies, referencedBy: record.referencedBy })),
        limitations: LIMITATIONS,
    };
    onProgress({ phase: 'complete', current: 1, total: 1, message: 'Scan complete' });
    return report;
}

module.exports = {
    LIMITATIONS,
    buildMetrics,
    buildSummary,
    scanProject,
};
