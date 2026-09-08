'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { resolveProjectRoot } = require('../shared/project-runtime');

const PACKAGE_NAME = 'build-asset-resolver';
const UUID_PATTERN = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const META_SKIP_DIRECTORIES = new Set(['.git', 'build', 'library', 'local', 'node_modules', 'temp']);
const BUILD_RESULT_LIMIT = 100;
let lastResult = null;

function getProjectRoot() {
    return resolveProjectRoot();
}

function log(message) {
    console.log(`[BuildAssetResolver] ${message}`);
}

function normalizePath(filePath) {
    return path.relative(getProjectRoot(), filePath).replace(/\\/g, '/');
}

function extractUuid(input) {
    const match = String(input || '').match(UUID_PATTERN);
    return match ? match[0].toLowerCase() : '';
}

function scanMetaByUuid(assetsRoot, uuid) {
    const matches = [];
    const pending = [assetsRoot];

    while (pending.length) {
        const directory = pending.pop();
        let entries;
        try {
            entries = fs.readdirSync(directory, { withFileTypes: true });
        } catch (error) {
            continue;
        }

        for (const entry of entries) {
            const fullPath = path.join(directory, entry.name);
            if (entry.isDirectory()) {
                if (!META_SKIP_DIRECTORIES.has(entry.name)) pending.push(fullPath);
                continue;
            }
            if (!entry.isFile() || !entry.name.endsWith('.meta')) continue;

            try {
                const meta = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
                if (meta.uuid === uuid) matches.push(fullPath);
            } catch (error) {
                // Ignore malformed metadata and keep searching.
            }
        }
    }

    return matches;
}

function findGitHistoryByUuid(projectRoot, uuid) {
    let changedPaths;
    try {
        changedPaths = execFileSync(
            'git',
            ['log', '--all', '--format=', '--name-only', '-S', uuid, '--', 'assets'],
            { cwd: projectRoot, encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] },
        );
    } catch (error) {
        return [];
    }

    const metaPaths = [...new Set(changedPaths.split(/\r?\n/)
        .map(filePath => filePath.trim())
        .filter(filePath => filePath.endsWith('.meta')))];
    const matches = [];

    for (const metaPath of metaPaths) {
        let commits;
        try {
            commits = execFileSync(
                'git',
                ['log', '--all', '--format=%H', '--', metaPath],
                { cwd: projectRoot, encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] },
            ).split(/\r?\n/).filter(Boolean);
        } catch (error) {
            continue;
        }

        for (const commit of commits.slice(0, 20)) {
            try {
                const rawMeta = execFileSync(
                    'git',
                    ['show', `${commit}:${metaPath}`],
                    { cwd: projectRoot, encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] },
                );
                if (JSON.parse(rawMeta).uuid !== uuid) continue;

                const assetPath = metaPath.slice(0, -'.meta'.length);
                matches.push({
                    uuid,
                    url: `db://assets/${assetPath.replace(/^assets\//, '')}`,
                    assetPath: assetPath.replace(/\\/g, '/'),
                    metaPath: metaPath.replace(/\\/g, '/'),
                    exists: false,
                    historical: true,
                    commit,
                });
                break;
            } catch (error) {
                // The path may not exist in this commit. Continue its history.
            }
        }
    }

    return matches;
}

function findBuildFiles(buildRoot, uuid, matches = []) {
    if (!fs.existsSync(buildRoot) || matches.length >= BUILD_RESULT_LIMIT) return matches;

    let entries;
    try {
        entries = fs.readdirSync(buildRoot, { withFileTypes: true });
    } catch (error) {
        return matches;
    }

    for (const entry of entries) {
        if (matches.length >= BUILD_RESULT_LIMIT) break;
        const fullPath = path.join(buildRoot, entry.name);
        if (entry.isDirectory()) {
            findBuildFiles(fullPath, uuid, matches);
        } else if (entry.isFile() && entry.name.toLowerCase().includes(uuid)) {
            matches.push(fullPath);
        }
    }

    return matches;
}

async function querySourceUrl(uuid) {
    if (!global.Editor || !Editor.Message) return '';
    try {
        const url = await Editor.Message.request('asset-db', 'query-url', uuid);
        return typeof url === 'string' ? url : '';
    } catch (error) {
        return '';
    }
}

function dbUrlToPaths(projectRoot, dbUrl) {
    if (!dbUrl || !dbUrl.startsWith('db://assets/')) return null;
    const relativeAssetPath = dbUrl.replace(/^db:\/\/assets\//, 'assets/');
    const assetPath = path.join(projectRoot, relativeAssetPath.replace(/\//g, path.sep));
    return {
        assetPath,
        metaPath: `${assetPath}.meta`,
    };
}

function createFailure(input, message) {
    return {
        ok: false,
        input: String(input || ''),
        uuid: extractUuid(input),
        message,
        sourceAssets: [],
        buildFiles: [],
        generatedAt: new Date().toISOString(),
    };
}

function emitResult(result) {
    lastResult = result;
    if (global.Editor && Editor.Message) {
        Editor.Message.send(PACKAGE_NAME, 'result-updated', result);
    }
}

async function resolveBuildAsset(input) {
    const uuid = extractUuid(input);
    if (!uuid) return createFailure(input, 'No Cocos UUID found. Paste a build file path, file name, or UUID.');

    const projectRoot = getProjectRoot();
    const sourceUrl = await querySourceUrl(uuid);
    const sourceAssets = [];
    const sourcePaths = dbUrlToPaths(projectRoot, sourceUrl);

    if (sourcePaths) {
        sourceAssets.push({
            uuid,
            url: sourceUrl,
            assetPath: normalizePath(sourcePaths.assetPath),
            metaPath: normalizePath(sourcePaths.metaPath),
            exists: fs.existsSync(sourcePaths.assetPath),
        });
    } else {
        for (const metaPath of scanMetaByUuid(path.join(projectRoot, 'assets'), uuid)) {
            const assetPath = metaPath.slice(0, -'.meta'.length);
            sourceAssets.push({
                uuid,
                url: `db://assets/${normalizePath(assetPath).replace(/^assets\//, '')}`,
                assetPath: normalizePath(assetPath),
                metaPath: normalizePath(metaPath),
                exists: fs.existsSync(assetPath),
            });
        }
        if (sourceAssets.length === 0) {
            sourceAssets.push(...findGitHistoryByUuid(projectRoot, uuid));
        }
    }

    const explicitPath = path.isAbsolute(String(input || ''))
        ? String(input)
        : path.resolve(projectRoot, String(input || ''));
    const buildFiles = fs.existsSync(explicitPath) && fs.statSync(explicitPath).isFile()
        ? [explicitPath]
        : findBuildFiles(path.join(projectRoot, 'build'), uuid);

    return {
        ok: sourceAssets.length > 0,
        input: String(input || ''),
        uuid,
        message: sourceAssets.length > 0
            ? (sourceAssets.some(asset => asset.historical)
                ? 'Current source asset is missing. The path below was found in Git history.'
                : '')
            : 'No current source asset was found. The build may be stale, or the source asset may have been deleted.',
        sourceAssets,
        buildFiles: buildFiles.map(normalizePath),
        generatedAt: new Date().toISOString(),
    };
}

exports.load = function load() {
    log('loaded');
};

exports.unload = function unload() {
    log('unloaded');
};

exports.methods = {
    async openPanel() {
        await Editor.Panel.open(PACKAGE_NAME);
    },

    async resolveBuildAsset(input) {
        const result = await resolveBuildAsset(input);
        emitResult(result);
        return result;
    },

    async openSourceAsset(uuid) {
        if (!uuid || !global.Editor || !Editor.Message) return false;
        try {
            await Editor.Message.request('asset-db', 'open-asset', uuid);
            return true;
        } catch (error) {
            console.warn(`[BuildAssetResolver] open source asset failed: ${error && (error.stack || error.message) || error}`);
            return false;
        }
    },

    getLastResult() {
        return lastResult;
    },

    async openHelp() {
        await Editor.Panel.open(`${PACKAGE_NAME}.help`);
    },
};
