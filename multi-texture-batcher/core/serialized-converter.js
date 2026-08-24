'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const LAST_CONVERSION_FILE = path.join('local', 'multi-texture-batcher', 'last-conversion.json');
const ASSET_EXTENSIONS = new Set(['.scene', '.prefab']);
const RESTORE_TYPE_MAP = Object.freeze({
    'MultiTextureBatcher.MultiSprite': 'cc.Sprite',
    'MultiTextureBatcher.MultiLabel': 'cc.Label',
});

function assertInsideProject(projectRoot, target) {
    const root = path.resolve(projectRoot);
    const resolved = path.resolve(target);
    const relative = path.relative(root, resolved);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
        throw new Error(`Target is outside the project: ${target}`);
    }
}

async function listRenderAssets(directory) {
    const files = [];
    const entries = await fs.promises.readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
        if (entry.name.startsWith('.')) continue;
        const absolute = path.join(directory, entry.name);
        if (entry.isDirectory()) {
            files.push(...await listRenderAssets(absolute));
        } else if (entry.isFile() && ASSET_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
            files.push(absolute);
        }
    }
    return files;
}

function resolveSelectedAssets(projectRoot, assetPaths) {
    if (!Array.isArray(assetPaths)) return null;
    const uniquePaths = new Set();
    const files = [];
    for (const assetPath of assetPaths) {
        if (typeof assetPath !== 'string' || !assetPath.trim()) {
            throw new Error('Asset path must be a non-empty string.');
        }
        const normalized = assetPath.trim().replace(/\\/g, '/').replace(/^\.\//, '');
        if (!normalized.startsWith('assets/')) {
            throw new Error(`Asset must be inside the assets directory: ${assetPath}`);
        }
        if (!ASSET_EXTENSIONS.has(path.extname(normalized).toLowerCase())) {
            throw new Error(`Only Scene and Prefab assets can be converted: ${assetPath}`);
        }
        const absolute = path.resolve(projectRoot, normalized);
        assertInsideProject(projectRoot, absolute);
        const relative = path.relative(projectRoot, absolute).replace(/\\/g, '/');
        if (!relative.startsWith('assets/')) {
            throw new Error(`Asset must be inside the assets directory: ${assetPath}`);
        }
        if (uniquePaths.has(relative)) continue;
        uniquePaths.add(relative);
        files.push(absolute);
    }
    return files;
}

function parseDocument(source, filePath) {
    try {
        return JSON.parse(String(source).replace(/^\uFEFF/, ''));
    } catch (error) {
        throw new Error(`Cannot parse ${filePath}: ${error.message}`);
    }
}

function skipReason(component) {
    if (component.__type__ === 'cc.Sprite') {
        if (component._customMaterial) return 'custom-material';
        if (component._useGrayscale) return 'grayscale';
        const spriteType = Number(component._type || 0);
        if (spriteType !== 0 && spriteType !== 1) return 'unsupported-sprite-type';
    }
    if (component.__type__ === 'cc.Label' && component._customMaterial) return 'custom-material';
    return '';
}

function analyzeDocument(document) {
    if (!Array.isArray(document)) throw new Error('Serialized Cocos asset must be a JSON array.');
    const result = {
        sprites: 0,
        labels: 0,
        convertedSprites: 0,
        convertedLabels: 0,
        candidates: [],
        skipped: {},
    };
    for (let index = 0; index < document.length; index += 1) {
        const component = document[index];
        if (!component || typeof component !== 'object') continue;
        if (component.__type__ === 'MultiTextureBatcher.MultiSprite') result.convertedSprites += 1;
        if (component.__type__ === 'MultiTextureBatcher.MultiLabel') result.convertedLabels += 1;
        if (component.__type__ !== 'cc.Sprite' && component.__type__ !== 'cc.Label') continue;
        if (component.__type__ === 'cc.Sprite') result.sprites += 1;
        if (component.__type__ === 'cc.Label') result.labels += 1;
        const reason = skipReason(component);
        if (reason) {
            result.skipped[reason] = (result.skipped[reason] || 0) + 1;
            continue;
        }
        result.candidates.push({ index, sourceType: component.__type__ });
    }
    return result;
}

function mergeCounts(target, analysis) {
    target.sprites += analysis.sprites;
    target.labels += analysis.labels;
    target.convertedSprites += analysis.convertedSprites;
    target.convertedLabels += analysis.convertedLabels;
    target.candidates += analysis.candidates.length;
    for (const reason of Object.keys(analysis.skipped)) {
        target.skipped[reason] = (target.skipped[reason] || 0) + analysis.skipped[reason];
    }
}

async function scanProject(projectRoot, options = {}) {
    const assetsRoot = path.resolve(projectRoot, 'assets');
    assertInsideProject(projectRoot, assetsRoot);
    const selectedFiles = resolveSelectedAssets(projectRoot, options.assetPaths);
    const files = selectedFiles === null ? await listRenderAssets(assetsRoot) : selectedFiles;
    const summary = {
        files: files.length,
        candidateFiles: 0,
        sprites: 0,
        labels: 0,
        convertedSprites: 0,
        convertedLabels: 0,
        candidates: 0,
        parseErrors: 0,
        skipped: {},
    };
    const assets = [];
    const errors = [];
    for (const filePath of files) {
        try {
            const source = await fs.promises.readFile(filePath, 'utf8');
            const analysis = analyzeDocument(parseDocument(source, filePath));
            mergeCounts(summary, analysis);
            if (analysis.candidates.length > 0) {
                summary.candidateFiles += 1;
                assets.push({
                    path: path.relative(projectRoot, filePath).replace(/\\/g, '/'),
                    candidates: analysis.candidates.length,
                    sprites: analysis.candidates.filter(item => item.sourceType === 'cc.Sprite').length,
                    labels: analysis.candidates.filter(item => item.sourceType === 'cc.Label').length,
                });
            }
        } catch (error) {
            summary.parseErrors += 1;
            if (errors.length < 50) errors.push({
                path: path.relative(projectRoot, filePath).replace(/\\/g, '/'),
                error: error.message,
            });
        }
    }
    const maxAssets = Number.isFinite(options.maxAssets) ? Math.max(0, options.maxAssets) : 500;
    return { summary, assets: assets.slice(0, maxAssets), errors };
}

async function atomicWrite(filePath, content) {
    const temporary = `${filePath}.multi-texture-batcher-${process.pid}.tmp`;
    await fs.promises.writeFile(temporary, content, 'utf8');
    await fs.promises.rename(temporary, filePath);
}

async function writeJson(filePath, value) {
    await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
    await atomicWrite(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function contentHash(content) {
    return crypto.createHash('sha256').update(content).digest('hex');
}

async function convertProject(projectRoot, options = {}) {
    void projectRoot;
    void options;
    throw new Error('0.3.0 起不再修改 Scene/Prefab 的 __type__；安装运行时后会自动对标准 Sprite/Label 实例做可逆升级。');
}

async function getConversionState(projectRoot) {
    const filePath = path.resolve(projectRoot, LAST_CONVERSION_FILE);
    assertInsideProject(projectRoot, filePath);
    try {
        const manifest = JSON.parse(await fs.promises.readFile(filePath, 'utf8'));
        return { restorable: Array.isArray(manifest.files) && manifest.files.length > 0, manifest };
    } catch (error) {
        if (error.code === 'ENOENT') return { restorable: false, manifest: null };
        throw error;
    }
}

async function restoreLastConversion(projectRoot) {
    const state = await getConversionState(projectRoot);
    if (!state.restorable) return { changed: false, restoredFiles: 0 };
    let restoredFiles = 0;
    const conflicts = [];
    const remainingFiles = [];
    for (const item of state.manifest.files) {
        const target = path.resolve(projectRoot, item.path);
        const backup = path.resolve(state.manifest.backupDirectory, item.path);
        assertInsideProject(projectRoot, target);
        assertInsideProject(projectRoot, backup);
        const current = await fs.promises.readFile(target);
        if (item.convertedHash && contentHash(current) !== item.convertedHash) {
            conflicts.push(item.path);
            remainingFiles.push(item);
            continue;
        }
        await fs.promises.copyFile(backup, target);
        restoredFiles += 1;
    }
    const lastConversionPath = path.resolve(projectRoot, LAST_CONVERSION_FILE);
    if (remainingFiles.length > 0) {
        await writeJson(lastConversionPath, { ...state.manifest, files: remainingFiles });
    } else {
        await fs.promises.rm(lastConversionPath, { force: true });
    }
    return { changed: restoredFiles > 0, restoredFiles, conflicts, manifest: state.manifest };
}

function restoreDocument(document) {
    let restored = 0;
    for (const component of document) {
        if (!component || !RESTORE_TYPE_MAP[component.__type__]) continue;
        component.__type__ = RESTORE_TYPE_MAP[component.__type__];
        restored += 1;
    }
    return restored;
}

module.exports = {
    analyzeDocument,
    convertProject,
    getConversionState,
    parseDocument,
    restoreDocument,
    restoreLastConversion,
    scanProject,
};
