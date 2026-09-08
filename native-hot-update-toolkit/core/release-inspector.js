'use strict';

const fs = require('fs');
const path = require('path');

const RELEASE_FILES = ['version.manifest', 'backend-config.json'];
const LEGACY_MANIFESTS = new Set();

function resolveProjectPath(projectRoot, value) {
    const text = String(value || '').replace(/\\/g, '/');
    return text.startsWith('project://')
        ? path.resolve(projectRoot, text.slice('project://'.length))
        : path.resolve(value || projectRoot);
}

function listReleases(projectRoot, config) {
    const output = [];
    const archiveRoot = resolveProjectPath(projectRoot, config.pipeline && config.pipeline.archiveRoot);
    for (const [environment, environmentConfig] of Object.entries(config.environments || {})) {
        const hotfixRoot = path.join(archiveRoot, 'hotfix', environment);
        if (!fs.existsSync(hotfixRoot)) continue;
        for (const entry of fs.readdirSync(hotfixRoot, { withFileTypes: true })) {
            if (!entry.isFile() || !/^.+_\d+\.manifest$/.test(entry.name)) continue;
            const releaseFile = path.join(hotfixRoot, entry.name);
            try {
                const manifest = readJson(releaseFile);
                const releaseId = path.basename(entry.name, '.manifest');
                output.push({
                    environment,
                    releaseId,
                    releaseSequence: Number(manifest.version) || 0,
                    releaseDir: hotfixRoot,
                    archiveRoot,
                    backendFile: path.join(archiveRoot, 'backend-config', environment, `${releaseId}.json`),
                    releaseFile,
                    bundles: { ...(manifest.bundle || {}) },
                    time: fs.statSync(releaseFile).mtimeMs,
                });
            } catch (error) {
                output.push({ environment, releaseId: entry.name, releaseDir: hotfixRoot, archiveRoot, releaseFile, error: String(error), bundles: {}, time: 0 });
            }
        }
    }
    return output.sort((left, right) => right.time - left.time);
}

function listReleaseFiles(release) {
    if (!release) return RELEASE_FILES;
    return [
        ...RELEASE_FILES,
        ...Object.keys(release.bundles || {}).sort().flatMap(bundle => [
            `${bundle}/project.manifest`,
            `${bundle}/descriptor.json`,
        ]),
    ];
}

function loadReleaseFile(release, relativePath) {
    if (!release || !release.releaseFile) throw new Error('Release selection is required');
    const supported = listReleaseFiles(release);
    if (!supported.includes(relativePath)) throw new Error(`Unsupported release file: ${relativePath}`);
    let target;
    if (relativePath === 'version.manifest') {
        target = release.releaseFile;
    } else if (relativePath === 'backend-config.json') {
        target = release.backendFile;
    } else {
        const match = relativePath.match(/^([^/]+)\/(project\.manifest|descriptor\.json)$/);
        const bundle = match && match[1];
        const fileName = match && match[2];
        const hash = bundle && release.bundles[bundle];
        if (!hash) throw new Error(`Bundle is not declared by version manifest: ${bundle || ''}`);
        target = path.join(release.releaseDir, bundle, hash, fileName);
    }
    const root = path.resolve(relativePath === 'backend-config.json' ? release.archiveRoot : release.releaseDir);
    const absolute = path.resolve(target);
    const relative = path.relative(root, absolute);
    if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Release file escapes output root');
    if (!fs.existsSync(absolute)) throw new Error(`Release file not found: ${absolute}`);
    const value = readJson(absolute);
    return {
        releaseDir: root,
        relativePath,
        file: absolute,
        value,
        text: `${JSON.stringify(value, null, 2)}\n`,
    };
}

function readJson(file) {
    return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
}

module.exports = {
    LEGACY_MANIFESTS,
    RELEASE_FILES,
    listReleases,
    listReleaseFiles,
    loadReleaseFile,
};
