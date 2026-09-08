'use strict';

const fs = require('fs');
const path = require('path');
const {
    cleanPrefabRedundancy,
    collectAssetInfo,
    findReferences,
    pathToDbUrl,
} = require('./lib/reference-finder');
const { resolveProjectRoot } = require('../shared/project-runtime');

const PACKAGE_NAME = 'asset-reference-finder';
const TEXT_SELECT_ASSET = '\u8bf7\u5148\u5728\u8d44\u6e90\u7ba1\u7406\u5668\u4e2d\u9009\u4e2d\u4e00\u4e2a assets \u4e0b\u7684\u8d44\u6e90\u3002';
const TEXT_READ_META_FAILED = '\u8bfb\u53d6\u8d44\u6e90 meta \u5931\u8d25\u3002';
const TEXT_CLEAN_SELECT_PREFAB = '\u8bf7\u5148\u9009\u4e2d\u9700\u8981\u6e05\u7406\u7684 prefab \u8d44\u6e90\u3002';
let lastResult = null;

function getProjectRoot() {
    return resolveProjectRoot();
}

function log(message) {
    console.log(`[AssetRef] ${message}`);
}

function warn(message) {
    console.warn(`[AssetRef] ${message}`);
}

function makeEmptyResult(message) {
    return {
        ok: false,
        message,
        asset: null,
        count: 0,
        stringCount: 0,
        references: [],
        stringReferences: [],
        scanned: 0,
        generatedAt: new Date().toISOString(),
    };
}

function emitResult(result) {
    lastResult = result;
    if (global.Editor && Editor.Message) {
        Editor.Message.send(PACKAGE_NAME, 'result-updated', result);
    }
}

async function refreshAssetDb(url) {
    if (!global.Editor || !Editor.Message || !url) {
        return;
    }

    try {
        await Editor.Message.request('asset-db', 'refresh-asset', url);
    } catch (error) {
        try {
            await Editor.Message.request('asset-db', 'refresh');
        } catch (refreshError) {
            warn(`Asset DB refresh failed: ${refreshError && (refreshError.stack || refreshError.message) || refreshError}`);
        }
    }
}

async function openResultPanel() {
    if (global.Editor && Editor.Panel) {
        await Editor.Panel.open(PACKAGE_NAME);
    }
}

function normalizeSelectionItem(item) {
    if (!item) {
        return '';
    }
    if (typeof item === 'string') {
        return item;
    }
    return item.uuid || item.url || item.path || item.value || '';
}

async function queryAssetInfoBySelection(selection) {
    if (!selection || !global.Editor || !Editor.Message) {
        return null;
    }

    try {
        return await Editor.Message.request('asset-db', 'query-asset-info', selection);
    } catch (error) {
        return null;
    }
}

async function queryUrlByUuid(uuid) {
    if (!uuid || !global.Editor || !Editor.Message) {
        return '';
    }

    try {
        return await Editor.Message.request('asset-db', 'query-url', uuid);
    } catch (error) {
        return '';
    }
}

async function getSelectedAssetCandidates() {
    if (!global.Editor || !Editor.Selection) {
        return [];
    }

    const selectors = [
        () => Editor.Selection.curSelection && Editor.Selection.curSelection('asset'),
        () => Editor.Selection.curSelection && Editor.Selection.curSelection('assets'),
        () => Editor.Selection.getSelected && Editor.Selection.getSelected('asset'),
        () => Editor.Selection.getSelected && Editor.Selection.getSelected('assets'),
    ];

    for (const select of selectors) {
        try {
            const value = select();
            if (Array.isArray(value) && value.length) {
                return value.map(normalizeSelectionItem).filter(Boolean);
            }
            const normalized = normalizeSelectionItem(value);
            if (normalized) {
                return [normalized];
            }
        } catch (error) {
            // Try the next known selection shape.
        }
    }

    return [];
}

function findMetaByUuid(projectRoot, selectedUuid) {
    if (!selectedUuid) {
        return null;
    }

    const wantedRootUuid = selectedUuid.split('@')[0];
    const stack = [path.join(projectRoot, 'assets')];
    while (stack.length) {
        const dir = stack.pop();
        let entries = [];
        try {
            entries = fs.readdirSync(dir, { withFileTypes: true });
        } catch (error) {
            continue;
        }

        for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                stack.push(fullPath);
                continue;
            }
            if (!entry.isFile() || !entry.name.endsWith('.meta')) {
                continue;
            }

            try {
                const meta = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
                if (meta.uuid === wantedRootUuid) {
                    return fullPath;
                }
                const subMetas = meta.subMetas || {};
                for (const key of Object.keys(subMetas)) {
                    if (subMetas[key] && subMetas[key].uuid === selectedUuid) {
                        return fullPath;
                    }
                }
            } catch (error) {
                // Ignore malformed metadata and keep scanning.
            }
        }
    }

    return null;
}

async function resolveSelectedAsset(projectRoot) {
    const selections = await getSelectedAssetCandidates();
    if (!selections.length) {
        return null;
    }

    for (const selection of selections) {
        const assetInfo = await queryAssetInfoBySelection(selection);
        const uuid = (assetInfo && (assetInfo.uuid || assetInfo.importerUuid)) || (selection.startsWith('db://') ? '' : selection);
        const url = (assetInfo && assetInfo.url) || (selection.startsWith('db://') ? selection : await queryUrlByUuid(selection));
        const metaPathFromUrl = url && url.startsWith('db://assets')
            ? path.join(projectRoot, url.replace(/^db:\/\/assets\/?/, 'assets/')) + '.meta'
            : '';
        const metaPath = metaPathFromUrl && fs.existsSync(metaPathFromUrl)
            ? metaPathFromUrl
            : findMetaByUuid(projectRoot, uuid || selection);

        if (metaPath && fs.existsSync(metaPath)) {
            return {
                selection,
                uuid: uuid || selection,
                url: url || pathToDbUrl(projectRoot, metaPath.replace(/\.meta$/, '')),
                metaPath,
            };
        }
    }

    return { selection: selections[0] };
}

exports.load = function load() {
    log('loaded. Select an asset in Assets panel and press F6.');
};

exports.unload = function unload() {
    log('unloaded');
};

exports.methods = {
    async findSelectedReferences() {
        const projectRoot = getProjectRoot();
        const selected = await resolveSelectedAsset(projectRoot);

        if (!selected || !selected.metaPath) {
            const result = makeEmptyResult(TEXT_SELECT_ASSET);
            emitResult(result);
            await openResultPanel();
            warn('No asset selected, or the selected item is not an asset under db://assets.');
            return result;
        }

        const assetInfo = collectAssetInfo(projectRoot, selected.metaPath, selected.uuid);
        if (!assetInfo) {
            const result = makeEmptyResult(TEXT_READ_META_FAILED);
            emitResult(result);
            await openResultPanel();
            warn(`Unable to read asset metadata: ${selected.metaPath}`);
            return result;
        }

        const result = findReferences(projectRoot, assetInfo);
        result.ok = true;
        emitResult(result);
        await openResultPanel();

        if (result.count || result.stringCount) {
            log(`${assetInfo.dbUrl}: ${result.count} reference file(s), ${result.stringCount} string match file(s).`);
        } else {
            log(`${assetInfo.dbUrl}: no references.`);
        }

        return result;
    },

    async cleanSelectedPrefabRedundancy() {
        const projectRoot = getProjectRoot();
        const selected = await resolveSelectedAsset(projectRoot);

        if (!selected || !selected.metaPath) {
            return {
                ok: false,
                message: TEXT_CLEAN_SELECT_PREFAB,
            };
        }

        const assetInfo = collectAssetInfo(projectRoot, selected.metaPath, selected.uuid);
        if (!assetInfo || path.extname(assetInfo.assetPath).toLowerCase() !== '.prefab') {
            return {
                ok: false,
                message: TEXT_CLEAN_SELECT_PREFAB,
            };
        }

        const cleanResult = cleanPrefabRedundancy(projectRoot, assetInfo.assetPath);
        if (!cleanResult.ok) {
            return cleanResult;
        }

        await refreshAssetDb(assetInfo.dbUrl);

        const result = findReferences(projectRoot, assetInfo);
        result.ok = true;
        result.cleanResult = cleanResult;
        emitResult(result);

        log(`${assetInfo.dbUrl}: cleaned ${cleanResult.removedObjectCount} serialized object(s), backup: ${cleanResult.backupPath}`);
        return cleanResult;
    },

    getLastResult() {
        return lastResult;
    },

    async openHelp() {
        await Editor.Panel.open(`${PACKAGE_NAME}.help`);
    },
};
