'use strict';

const fs = require('fs');
const path = require('path');

const RELEASE_FILES = [
    'release-descriptor.json',
    'release-report.json',
    'project.json',
];
const LEGACY_MANIFESTS = new Set(['project.manifest', 'version.manifest']);

function resolveProjectPath(projectRoot, value) {
    const text = String(value || '').replace(/\\/g, '/');
    return text.startsWith('project://')
        ? path.resolve(projectRoot, text.slice('project://'.length))
        : path.resolve(value || projectRoot);
}

function listReleases(projectRoot, config) {
    const output = [];
    for (const [environment, environmentConfig] of Object.entries(config.environments || {})) {
        const outputRoot = resolveProjectPath(projectRoot, environmentConfig.outputRoot);
        if (!fs.existsSync(outputRoot)) continue;
        for (const entry of fs.readdirSync(outputRoot, { withFileTypes: true })) {
            if (!entry.isDirectory()) continue;
            const releaseDir = path.join(outputRoot, entry.name, 'releases');
            const descriptorPath = path.join(releaseDir, 'release-descriptor.json');
            if (!fs.existsSync(descriptorPath)) continue;
            try {
                const descriptor = readJson(descriptorPath);
                output.push(createReleaseSummary(environment, entry.name, releaseDir, descriptor, descriptorPath));
            } catch (error) {
                output.push({ environment, releaseId: entry.name, releaseDir, error: String(error), bundles: [], time: 0 });
            }
        }

        // 兼容查看改造前的历史制品；新构建只写入 <releaseId>/releases。
        const oldReleaseRoot = path.join(outputRoot, 'releases');
        if (!fs.existsSync(oldReleaseRoot)) continue;
        for (const entry of fs.readdirSync(oldReleaseRoot, { withFileTypes: true })) {
            if (!entry.isDirectory()) continue;
            const releaseDir = path.join(oldReleaseRoot, entry.name);
            const descriptorPath = path.join(releaseDir, 'release-descriptor.json');
            if (!fs.existsSync(descriptorPath)) continue;
            try {
                const descriptor = readJson(descriptorPath);
                output.push(createReleaseSummary(environment, entry.name, releaseDir, descriptor, descriptorPath));
            } catch (error) {
                output.push({ environment, releaseId: entry.name, releaseDir, error: String(error), bundles: [], time: 0 });
            }
        }
    }
    return output.sort((left, right) => right.time - left.time);
}

function createReleaseSummary(environment, fallbackReleaseId, releaseDir, descriptor, descriptorPath) {
    return {
        environment,
        releaseId: descriptor.releaseId || fallbackReleaseId,
        releaseSequence: descriptor.releaseSequence || 0,
        releaseDir,
        signed: !!(descriptor.integrity && descriptor.integrity.signature),
        contentHash: descriptor.contentHash || '',
        bundles: [],
        time: fs.statSync(descriptorPath).mtimeMs,
    };
}

function loadReleaseFile(releaseDir, relativePath) {
    if (!RELEASE_FILES.includes(relativePath)) throw new Error(`Unsupported release file: ${relativePath}`);
    const root = path.resolve(releaseDir);
    const target = path.resolve(root, relativePath);
    const relative = path.relative(root, target);
    if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Release file escapes release root');
    if (!fs.existsSync(target)) throw new Error(`Release file not found: ${target}`);
    const value = readJson(target);
    return {
        releaseDir: root,
        relativePath,
        value,
        text: `${JSON.stringify(value, null, 2)}\n`,
    };
}

function legacyManifestPath(projectRoot, name) {
    if (!LEGACY_MANIFESTS.has(name)) throw new Error(`Unsupported legacy manifest: ${name}`);
    return path.join(projectRoot, 'assets', 'resources', 'hot_update', name);
}

function loadLegacyManifest(projectRoot, name) {
    const file = legacyManifestPath(projectRoot, name);
    if (!fs.existsSync(file)) throw new Error(`Legacy manifest not found: ${file}`);
    const value = readJson(file);
    return {
        name,
        file,
        value,
        summary: summarizeLegacyManifest(name, value),
        text: `${JSON.stringify(value, null, 2)}\n`,
    };
}

function saveLegacyManifest(projectRoot, name, text) {
    const file = legacyManifestPath(projectRoot, name);
    const value = JSON.parse(String(text || '').replace(/^\uFEFF/, ''));
    validateLegacyManifest(name, value);
    const backupRoot = path.join(projectRoot, '.dev', 'hot-update-plugin-backups');
    fs.mkdirSync(backupRoot, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backup = path.join(backupRoot, `${name}.${stamp}.json`);
    if (fs.existsSync(file)) fs.copyFileSync(file, backup);
    fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
    return { ...loadLegacyManifest(projectRoot, name), backup };
}

function validateLegacyManifest(name, value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${name} must be a JSON object`);
    for (const key of ['packageUrl', 'remoteManifestUrl', 'remoteVersionUrl', 'version']) {
        if (!String(value[key] || '').trim()) throw new Error(`${name} is missing ${key}`);
    }
    if (name === 'project.manifest') {
        if (!value.assets || typeof value.assets !== 'object' || Array.isArray(value.assets)) {
            throw new Error('project.manifest assets must be a JSON object');
        }
        if (!Array.isArray(value.searchPaths)) {
            throw new Error('project.manifest searchPaths must be a JSON array');
        }
    }
}

function summarizeLegacyManifest(name, value) {
    const summary = {
        version: String(value.version || ''),
        packageUrl: String(value.packageUrl || ''),
        remoteManifestUrl: String(value.remoteManifestUrl || ''),
        remoteVersionUrl: String(value.remoteVersionUrl || ''),
    };
    if (name === 'project.manifest') {
        summary.assetCount = Object.keys(value.assets || {}).length;
        summary.searchPathCount = Array.isArray(value.searchPaths) ? value.searchPaths.length : 0;
    }
    return summary;
}

function readJson(file) {
    return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
}

module.exports = {
    LEGACY_MANIFESTS,
    RELEASE_FILES,
    listReleases,
    loadLegacyManifest,
    loadReleaseFile,
    saveLegacyManifest,
    summarizeLegacyManifest,
};
