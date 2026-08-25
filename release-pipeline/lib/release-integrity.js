'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const MANIFEST_FILE = 'release-integrity-manifest.json';
const MANIFEST_SCHEMA_VERSION = 1;

function createIntegrityManifest(tree, audit, context) {
    const files = collectCriticalFiles(tree, audit);
    const bundles = (audit.bundles || []).map((bundle) => ({
        bundle: bundle.bundle,
        index: bundle.index,
        config: bundle.config,
        bundleVersion: bundle.expectedVersion,
        indexSha256: sha256(tree.get(bundle.index)),
        configSha256: sha256(tree.get(bundle.config)),
    }));
    const releaseId = calculateReleaseId({
        schemaVersion: MANIFEST_SCHEMA_VERSION,
        platform: context.platform,
        outputName: context.outputName,
        files,
        bundles,
    });
    const previous = readPreviousManifest(tree);
    const generatedAt = previous && previous.releaseId === releaseId && previous.generatedAt
        ? previous.generatedAt
        : new Date().toISOString();

    return {
        schemaVersion: MANIFEST_SCHEMA_VERSION,
        releaseId,
        generatedAt,
        creatorVersion: readCreatorVersion(context.projectRoot),
        releasePipelineVersion: readPipelineVersion(context.packageRoot),
        platform: context.platform,
        outputName: context.outputName,
        versionAnchor: context.buildFingerprint ? {
            fingerprint: context.buildFingerprint.fingerprint,
            path: context.buildFingerprint.rootIndex,
        } : null,
        entry: collectEntryFiles(tree),
        bundles,
        files,
        importNativeSummary: collectImportNativeSummary(tree, audit),
        zipSha256: previous && previous.releaseId === releaseId ? previous.zipSha256 || '' : '',
        fingerprintAudit: {
            passed: audit.passed === true,
            managedFiles: audit.managedFiles || 0,
            missingReferences: (audit.missingReferences || []).length,
            staleReferences: (audit.staleReferences || []).length,
            bundleCount: bundles.length,
        },
    };
}

function collectCriticalFiles(tree, audit) {
    const critical = new Set();
    tree.forEach((buffer, relative) => {
        if (isCriticalPath(relative)) critical.add(relative);
    });
    (audit.references || []).forEach((reference) => {
        if (reference.target && /^(?:cocos-js\/|assets\/.*\/(?:import|native)\/)/i.test(reference.target)) {
            critical.add(reference.target);
        }
    });
    (audit.bundles || []).forEach((bundle) => {
        critical.add(bundle.index);
        critical.add(bundle.config);
    });
    return Array.from(critical)
        .filter((relative) => tree.has(relative))
        .sort()
        .map((relative) => ({
            path: relative,
            bytes: tree.get(relative).length,
            sha256: sha256(tree.get(relative)),
        }));
}

function collectEntryFiles(tree) {
    const findOne = (pattern) => Array.from(tree.keys()).filter((relative) => pattern.test(relative)).sort()[0] || '';
    return {
        html: tree.has('index.html') ? 'index.html' : '',
        rootIndex: findOne(/^index(?:\.[a-f0-9]+)?\.js$/i),
        application: findOne(/^application(?:\.[a-f0-9]+)?\.js$/i),
        importMap: findOne(/^src\/import-map(?:\.[a-f0-9]+)?\.json$/i),
        settings: findOne(/^src\/settings(?:\.[a-f0-9]+)?\.json$/i),
        worker: findOne(/^firebase-messaging-sw(?:\.[a-f0-9]+)?\.js$/i),
    };
}

function collectImportNativeSummary(tree, audit) {
    const referenced = new Set();
    (audit.references || []).forEach((reference) => {
        if (reference.target && /^(?:cocos-js\/|assets\/.*\/(?:import|native)\/)/i.test(reference.target)) {
            referenced.add(reference.target);
        }
    });
    const paths = Array.from(referenced).sort();
    const missing = paths.filter((relative) => !tree.has(relative));
    return {
        referenced: paths.length,
        present: paths.length - missing.length,
        missing,
        paths,
    };
}

function isCriticalPath(relative) {
    return relative === 'index.html'
        || /^index(?:\.[a-f0-9]+)?\.js$/i.test(relative)
        || /^application(?:\.[a-f0-9]+)?\.js$/i.test(relative)
        || /^firebase-messaging-sw(?:\.[a-f0-9]+)?\.js$/i.test(relative)
        || /^src\/(?:import-map|settings)(?:\.[a-f0-9]+)?\.json$/i.test(relative)
        || /^src\/[^/]+\.(?:js|json|css)$/i.test(relative)
        || /^assets\/[^/]+\/(?:index|config)(?:\.[a-f0-9]+)?\.(?:js|json)$/i.test(relative);
}

function readPreviousManifest(tree) {
    if (!tree.has(MANIFEST_FILE)) return null;
    try {
        return JSON.parse(tree.get(MANIFEST_FILE).toString('utf8'));
    } catch (error) {
        return null;
    }
}

function readCreatorVersion(projectRoot) {
    try {
        const packageJson = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'));
        return packageJson.creator && packageJson.creator.version || packageJson.version || '';
    } catch (error) {
        return '';
    }
}

function readPipelineVersion(packageRoot) {
    try {
        const packageJson = JSON.parse(fs.readFileSync(path.join(packageRoot, 'package.json'), 'utf8'));
        return packageJson.version || '';
    } catch (error) {
        return '';
    }
}

function sha256(value) {
    const buffer = Buffer.isBuffer(value) ? value : Buffer.from(String(value), 'utf8');
    return crypto.createHash('sha256').update(buffer).digest('hex');
}

function calculateReleaseId(manifestLike) {
    return sha256(stableStringify({
        schemaVersion: manifestLike.schemaVersion,
        platform: manifestLike.platform,
        outputName: manifestLike.outputName,
        files: manifestLike.files || [],
        bundles: manifestLike.bundles || [],
    })).slice(0, 32);
}

function stableStringify(value) {
    if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
    if (value && typeof value === 'object') {
        return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
    }
    return JSON.stringify(value);
}

function canonicalZipPayloadSha256(zip) {
    const entries = zip.getEntries()
        .filter((entry) => !entry.isDirectory && path.posix.basename(entry.entryName.replace(/\\/g, '/')) !== MANIFEST_FILE)
        .map((entry) => ({
            name: entry.entryName.replace(/\\/g, '/'),
            data: entry.getData(),
        }))
        .sort((left, right) => left.name.localeCompare(right.name));
    const hash = crypto.createHash('sha256');
    entries.forEach((entry) => {
        hash.update(`${entry.name}\0${entry.data.length}\0`, 'utf8');
        hash.update(entry.data);
    });
    return hash.digest('hex');
}

module.exports = {
    MANIFEST_FILE,
    MANIFEST_SCHEMA_VERSION,
    canonicalZipPayloadSha256,
    calculateReleaseId,
    createIntegrityManifest,
    sha256,
    stableStringify,
};
