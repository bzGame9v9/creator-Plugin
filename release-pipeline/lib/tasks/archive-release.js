'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const { resolveProjectPath, toPosixPath } = require('../context');
const { createDisplayVersion, formatArchiveTimestamp } = require('../release-identity');

const ARCHIVE_MANIFEST_FILE = 'release-archive.json';

async function run(context) {
    const config = context.config.archive || {};
    if (config.enabled === false) {
        return { skipped: true, reason: 'disabled' };
    }

    const zipTask = findSuccessfulZipTask(context);
    if (!zipTask) {
        throw new Error('archiveRelease requires a successful zipBuild in the same pipeline run');
    }
    if (!context.fingerprintAudit || context.fingerprintAudit.passed !== true || !context.buildFingerprint) {
        throw new Error('archiveRelease requires a successful fingerprintBuild audit in the same pipeline run');
    }

    const displayVersion = createDisplayVersion(context.appVersion, context.buildFingerprint.fingerprint);
    const archiveRoot = resolveProjectPath(context.projectRoot, config.root || 'project://build/releases');
    assertArchiveRootOutsideBuild(context.buildRoot, archiveRoot);
    const versionRoot = path.join(archiveRoot, context.environment, displayVersion);

    if (context.dryRun) {
        return {
            skipped: true,
            reason: 'dry-run',
            archiveRoot,
            versionRoot,
            environment: context.environment,
            appVersion: context.appVersion,
            fingerprint: context.buildFingerprint.fingerprint,
            displayVersion,
        };
    }

    const sourceZip = path.resolve(zipTask.result.output);
    if (!fs.existsSync(sourceZip) || !fs.statSync(sourceZip).isFile()) {
        throw new Error(`archiveRelease source ZIP not found: ${sourceZip}`);
    }
    if (!zipTask.result.zipSha256) {
        throw new Error('archiveRelease requires the verified ZIP payload SHA256 from zipBuild');
    }

    const archivedAt = new Date();
    const runDirectory = reserveArchiveDirectory(versionRoot, formatArchiveTimestamp(archivedAt));
    const archiveZip = path.join(runDirectory, path.basename(sourceZip));

    try {
        const copy = await copyFileAndVerify(sourceZip, archiveZip);
        const manifest = {
            schemaVersion: 1,
            archivedAt: archivedAt.toISOString(),
            timezone: 'Asia/Shanghai',
            environment: context.environment,
            appVersion: context.appVersion,
            fingerprint: context.buildFingerprint.fingerprint,
            displayVersion,
            rootIndex: context.buildFingerprint.rootIndex,
            platform: context.platform,
            outputName: context.outputName,
            releaseId: context.integrityManifest && context.integrityManifest.releaseId || '',
            sourceZip: relativeProjectPath(context.projectRoot, sourceZip),
            archiveZip: path.basename(archiveZip),
            bytes: copy.bytes,
            fileSha256: copy.sha256,
            zipPayloadSha256: zipTask.result.zipSha256,
        };
        const manifestPath = path.join(runDirectory, ARCHIVE_MANIFEST_FILE);
        writeJsonAtomically(manifestPath, manifest);

        return {
            archiveRoot,
            versionRoot,
            runDirectory,
            output: archiveZip,
            manifest: manifestPath,
            environment: context.environment,
            appVersion: context.appVersion,
            fingerprint: context.buildFingerprint.fingerprint,
            displayVersion,
            bytes: copy.bytes,
            fileSha256: copy.sha256,
            zipPayloadSha256: zipTask.result.zipSha256,
        };
    } catch (error) {
        removeReservedDirectory(versionRoot, runDirectory);
        throw new Error(`Cannot archive release ZIP: ${error.message}`);
    }
}

function findSuccessfulZipTask(context) {
    return [...(context.report.tasks || [])].reverse().find((task) => {
        return task.name === 'zipBuild'
            && task.status === 'success'
            && task.result
            && !task.result.skipped
            && task.result.output;
    });
}

function assertArchiveRootOutsideBuild(buildRoot, archiveRoot) {
    const relative = path.relative(path.resolve(buildRoot), path.resolve(archiveRoot));
    if (!relative || (!relative.startsWith('..') && !path.isAbsolute(relative))) {
        throw new Error(`Archive root must be outside build output: ${archiveRoot}`);
    }
}

function reserveArchiveDirectory(versionRoot, timestamp) {
    fs.mkdirSync(versionRoot, { recursive: true });
    for (let index = 0; index < 1000; index += 1) {
        const suffix = index === 0 ? '' : `-${String(index).padStart(2, '0')}`;
        const candidate = path.join(versionRoot, `${timestamp}${suffix}`);
        try {
            fs.mkdirSync(candidate);
            return candidate;
        } catch (error) {
            if (error && error.code === 'EEXIST') continue;
            throw error;
        }
    }
    throw new Error(`Cannot reserve a unique archive directory under ${versionRoot}`);
}

async function copyFileAndVerify(source, destination) {
    const temporary = `${destination}.release-pipeline-${process.pid}-${Date.now()}.tmp`;
    try {
        fs.copyFileSync(source, temporary, fs.constants.COPYFILE_EXCL);
        const [sourceHash, copiedHash] = await Promise.all([hashFile(source), hashFile(temporary)]);
        const sourceBytes = fs.statSync(source).size;
        const copiedBytes = fs.statSync(temporary).size;
        if (sourceHash !== copiedHash || sourceBytes !== copiedBytes) {
            throw new Error(`archive copy verification failed: bytes ${sourceBytes}/${copiedBytes}, SHA256 ${sourceHash}/${copiedHash}`);
        }
        fs.renameSync(temporary, destination);
        return { bytes: copiedBytes, sha256: copiedHash };
    } catch (error) {
        if (fs.existsSync(temporary)) fs.rmSync(temporary, { force: true });
        throw error;
    }
}

function hashFile(filePath) {
    return new Promise((resolve, reject) => {
        const hash = crypto.createHash('sha256');
        const stream = fs.createReadStream(filePath);
        stream.on('error', reject);
        stream.on('data', (chunk) => hash.update(chunk));
        stream.on('end', () => resolve(hash.digest('hex')));
    });
}

function writeJsonAtomically(filePath, value) {
    const temporary = `${filePath}.release-pipeline-${process.pid}-${Date.now()}.tmp`;
    try {
        fs.writeFileSync(temporary, JSON.stringify(value, null, 2), 'utf8');
        fs.renameSync(temporary, filePath);
    } catch (error) {
        if (fs.existsSync(temporary)) fs.rmSync(temporary, { force: true });
        throw error;
    }
}

function removeReservedDirectory(versionRoot, runDirectory) {
    const relative = path.relative(path.resolve(versionRoot), path.resolve(runDirectory));
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return;
    fs.rmSync(runDirectory, { recursive: true, force: true });
}

function relativeProjectPath(projectRoot, filePath) {
    return toPosixPath(path.relative(projectRoot, filePath));
}

module.exports = {
    ARCHIVE_MANIFEST_FILE,
    copyFileAndVerify,
    reserveArchiveDirectory,
    run,
};
