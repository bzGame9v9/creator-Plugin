'use strict';

const fs = require('fs');
const path = require('path');

const RUNTIME_DB_URL = 'db://assets/resources/__multi_texture_batcher__';
const RUNTIME_RELATIVE_PATH = path.join('assets', 'resources', '__multi_texture_batcher__');
const TEMPLATE_DIRECTORY = path.join(__dirname, '..', 'runtime-template');

const TEMPLATE_FILES = [
    'multi-texture-batch.effect',
    'multi-texture-batch.effect.meta',
    'multi-texture-batcher.js',
    'multi-texture-batcher.js.meta',
];

const DIRECTORY_META = `${JSON.stringify({
    ver: '1.2.0',
    importer: 'directory',
    imported: true,
    uuid: '78e913df-a1ef-45c4-91f8-3ece8c75241b',
    files: [],
    subMetas: {},
    userData: {},
}, null, 2)}\n`;

function runtimeDirectory(projectRoot) {
    return path.resolve(projectRoot, RUNTIME_RELATIVE_PATH);
}

function assertInsideProject(projectRoot, target) {
    const root = path.resolve(projectRoot);
    const relative = path.relative(root, path.resolve(target));
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
        throw new Error(`Runtime target is outside the project: ${target}`);
    }
}

async function writeIfChanged(source, target) {
    const next = await fs.promises.readFile(source);
    try {
        const current = await fs.promises.readFile(target);
        if (current.equals(next)) return false;
    } catch (error) {
        if (error.code !== 'ENOENT') throw error;
    }
    await fs.promises.writeFile(target, next);
    return true;
}

async function writeTextIfChanged(target, content) {
    try {
        if (await fs.promises.readFile(target, 'utf8') === content) return false;
    } catch (error) {
        if (error.code !== 'ENOENT') throw error;
    }
    await fs.promises.writeFile(target, content, 'utf8');
    return true;
}

async function installRuntime(projectRoot) {
    const targetDirectory = runtimeDirectory(projectRoot);
    const targetMeta = `${targetDirectory}.meta`;
    assertInsideProject(projectRoot, targetDirectory);
    assertInsideProject(projectRoot, targetMeta);
    await fs.promises.mkdir(targetDirectory, { recursive: true });

    const changedFiles = [];
    for (const fileName of TEMPLATE_FILES) {
        const changed = await writeIfChanged(
            path.join(TEMPLATE_DIRECTORY, fileName),
            path.join(targetDirectory, fileName),
        );
        if (changed) changedFiles.push(fileName);
    }
    if (await writeTextIfChanged(targetMeta, DIRECTORY_META)) changedFiles.push(`${path.basename(targetDirectory)}.meta`);

    return {
        installed: true,
        changed: changedFiles.length > 0,
        changedFiles,
        directory: targetDirectory,
        dbUrl: RUNTIME_DB_URL,
    };
}

async function removeRuntime(projectRoot) {
    const targetDirectory = runtimeDirectory(projectRoot);
    const targetMeta = `${targetDirectory}.meta`;
    assertInsideProject(projectRoot, targetDirectory);
    assertInsideProject(projectRoot, targetMeta);
    const existed = fs.existsSync(targetDirectory) || fs.existsSync(targetMeta);
    await fs.promises.rm(targetDirectory, { recursive: true, force: true });
    await fs.promises.rm(targetMeta, { force: true });
    return { installed: false, changed: existed, directory: targetDirectory, dbUrl: RUNTIME_DB_URL };
}

function getRuntimeStatus(projectRoot) {
    const directory = runtimeDirectory(projectRoot);
    const missingFiles = TEMPLATE_FILES.filter(fileName => !fs.existsSync(path.join(directory, fileName)));
    return {
        installed: fs.existsSync(directory) && missingFiles.length === 0,
        directory,
        dbUrl: RUNTIME_DB_URL,
        missingFiles,
    };
}

module.exports = {
    RUNTIME_DB_URL,
    TEMPLATE_FILES,
    getRuntimeStatus,
    installRuntime,
    removeRuntime,
    runtimeDirectory,
};
