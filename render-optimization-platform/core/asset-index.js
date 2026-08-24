'use strict';

const path = require('path');
const {
    assertNotCancelled,
    normalizeSlashes,
    readJson,
    relativePath,
    toDbUrl,
    yieldToEventLoop,
} = require('./file-system');
const { IMAGE_EXTENSIONS } = require('./constants');

function findSubMeta(meta, importer) {
    const subMetas = meta && meta.subMetas ? Object.values(meta.subMetas) : [];
    return subMetas.find(item => item && item.importer === importer) || null;
}

function makeTextureInfo(meta) {
    const spriteFrameMeta = findSubMeta(meta, 'sprite-frame');
    const textureMeta = findSubMeta(meta, 'texture');
    const spriteData = spriteFrameMeta && spriteFrameMeta.userData ? spriteFrameMeta.userData : {};
    const textureData = textureMeta && textureMeta.userData ? textureMeta.userData : {};
    const width = Number(spriteData.rawWidth || spriteData.width || 0);
    const height = Number(spriteData.rawHeight || spriteData.height || 0);

    return {
        width,
        height,
        area: width * height,
        rgbaMemoryBytes: width * height * 4,
        packable: spriteData.packable !== false,
        atlasUuid: spriteData.atlasUuid || '',
        hasAlpha: Boolean(meta.userData && meta.userData.hasAlpha),
        minfilter: textureData.minfilter || '',
        magfilter: textureData.magfilter || '',
        mipfilter: textureData.mipfilter || 'none',
        wrapModeS: textureData.wrapModeS || '',
        wrapModeT: textureData.wrapModeT || '',
        spriteFrameUuid: spriteFrameMeta ? spriteFrameMeta.uuid : '',
        textureUuid: textureMeta ? textureMeta.uuid : '',
    };
}

function makeRecord(projectRoot, file) {
    const relative = relativePath(projectRoot, file.absolutePath);
    return {
        uuid: '',
        subUuids: [],
        dbUrl: toDbUrl(relative),
        relativePath: relative,
        absolutePath: file.absolutePath,
        extension: file.extension,
        importer: '',
        byteSize: file.byteSize || 0,
        texture: null,
        dependencies: [],
        referencedBy: [],
        parseStatus: file.isReadError ? 'read-error' : 'ok',
        parseError: file.error || '',
        dynamicLoadRisk: relative.includes('/resources/') || relative.startsWith('assets/resources/'),
        atlasPath: '',
    };
}

function findAtlasPath(relativeAssetPath, atlasDirectories) {
    let directory = normalizeSlashes(path.posix.dirname(relativeAssetPath));
    while (directory && directory !== '.' && directory.startsWith('assets')) {
        if (atlasDirectories.has(directory)) return atlasDirectories.get(directory);
        const parent = path.posix.dirname(directory);
        if (parent === directory) break;
        directory = parent;
    }
    return '';
}

async function buildAssetIndex(projectRoot, files, options = {}) {
    const signal = options.signal;
    const onProgress = options.onProgress || (() => {});
    const records = [];
    const byPath = new Map();
    const byUuid = new Map();
    const parseErrors = [];

    for (const file of files) {
        if (file.isReadError || file.extension === '.meta') continue;
        const record = makeRecord(projectRoot, file);
        records.push(record);
        byPath.set(record.relativePath, record);
    }

    const metaFiles = files.filter(file => file.extension === '.meta');
    for (let index = 0; index < metaFiles.length; index++) {
        assertNotCancelled(signal);
        const file = metaFiles[index];
        const relativeMetaPath = relativePath(projectRoot, file.absolutePath);
        const assetRelativePath = relativeMetaPath.slice(0, -'.meta'.length);
        let meta;
        try {
            meta = await readJson(file.absolutePath);
        } catch (error) {
            parseErrors.push({ path: relativeMetaPath, kind: 'meta', message: error.message });
            const record = byPath.get(assetRelativePath);
            if (record) {
                record.parseStatus = 'partial';
                record.parseError = error.message;
            }
            continue;
        }

        const record = byPath.get(assetRelativePath);
        if (!record) continue;
        record.uuid = meta.uuid || '';
        record.importer = meta.importer || '';
        record.metaVersion = meta.ver || '';
        record.subUuids = Object.values(meta.subMetas || {}).map(item => item && item.uuid).filter(Boolean);
        if (record.uuid) byUuid.set(record.uuid, record);
        for (const subUuid of record.subUuids) byUuid.set(subUuid, record);

        if (record.importer === 'image' || IMAGE_EXTENSIONS.has(record.extension)) {
            record.texture = makeTextureInfo(meta);
        }

        if ((index + 1) % 200 === 0) {
            onProgress({ phase: 'index', current: index + 1, total: metaFiles.length, message: 'Indexing metadata' });
            await yieldToEventLoop();
        }
    }

    const atlasDirectories = new Map();
    for (const record of records) {
        if (record.extension === '.pac') {
            atlasDirectories.set(normalizeSlashes(path.posix.dirname(record.relativePath)), record.relativePath);
        }
    }
    for (const record of records) {
        if (record.texture) record.atlasPath = findAtlasPath(record.relativePath, atlasDirectories);
    }

    return {
        records,
        byPath,
        byUuid,
        parseErrors,
        atlasDirectories,
    };
}

function applyDependencies(assetIndex, dependencyEntries) {
    const reverse = new Map();
    for (const entry of dependencyEntries) {
        const source = assetIndex.byPath.get(entry.relativePath);
        if (!source) continue;
        source.dependencies = [...new Set(entry.dependencies)].sort();
        for (const uuid of source.dependencies) {
            if (!reverse.has(uuid)) reverse.set(uuid, new Set());
            reverse.get(uuid).add(source.uuid || source.relativePath);
        }
    }

    for (const record of assetIndex.records) {
        const references = new Set();
        const keys = [record.uuid, ...record.subUuids].filter(Boolean);
        for (const key of keys) {
            const sources = reverse.get(key);
            if (sources) for (const source of sources) references.add(source);
        }
        record.referencedBy = [...references].sort();
    }
}

module.exports = {
    applyDependencies,
    buildAssetIndex,
    makeTextureInfo,
};
