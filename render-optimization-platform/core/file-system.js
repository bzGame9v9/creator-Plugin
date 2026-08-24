'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function normalizeSlashes(value) {
    return String(value || '').replace(/\\/g, '/');
}

function relativePath(projectRoot, absolutePath) {
    return normalizeSlashes(path.relative(projectRoot, absolutePath));
}

function toDbUrl(relativeAssetPath) {
    const normalized = normalizeSlashes(relativeAssetPath);
    return normalized.startsWith('assets/') ? `db://${normalized}` : '';
}

function assertNotCancelled(signal) {
    if (signal && signal.cancelled) {
        const error = new Error('Scan cancelled');
        error.code = 'SCAN_CANCELLED';
        throw error;
    }
}

function yieldToEventLoop() {
    return new Promise(resolve => setImmediate(resolve));
}

async function walkFiles(rootPath, options = {}) {
    const signal = options.signal;
    const onProgress = options.onProgress || (() => {});
    const files = [];
    const pending = [rootPath];
    let visited = 0;

    while (pending.length) {
        assertNotCancelled(signal);
        const directory = pending.pop();
        let entries;
        try {
            entries = await fs.promises.readdir(directory, { withFileTypes: true });
        } catch (error) {
            files.push({ absolutePath: directory, error: error.message, isReadError: true });
            continue;
        }

        entries.sort((left, right) => left.name.localeCompare(right.name));
        for (const entry of entries) {
            const absolutePath = path.join(directory, entry.name);
            if (entry.isDirectory()) {
                pending.push(absolutePath);
            } else if (entry.isFile()) {
                let stat = null;
                try {
                    stat = await fs.promises.stat(absolutePath);
                } catch (error) {
                    files.push({ absolutePath, error: error.message, isReadError: true });
                    continue;
                }
                files.push({
                    absolutePath,
                    byteSize: stat.size,
                    extension: path.extname(entry.name).toLowerCase(),
                });
            }
            visited++;
            if (visited % 250 === 0) {
                onProgress({ phase: 'discover', current: visited, total: 0, message: 'Discovering assets' });
                await yieldToEventLoop();
                assertNotCancelled(signal);
            }
        }
    }

    return files;
}

async function readJson(absolutePath) {
    const source = await fs.promises.readFile(absolutePath, 'utf8');
    return JSON.parse(source.replace(/^\uFEFF/, ''));
}

async function hashFile(absolutePath) {
    return new Promise((resolve, reject) => {
        const hash = crypto.createHash('sha256');
        const input = fs.createReadStream(absolutePath);
        input.on('error', reject);
        input.on('data', chunk => hash.update(chunk));
        input.on('end', () => resolve(hash.digest('hex')));
    });
}

async function ensureDirectory(directory) {
    await fs.promises.mkdir(directory, { recursive: true });
}

module.exports = {
    assertNotCancelled,
    ensureDirectory,
    hashFile,
    normalizeSlashes,
    readJson,
    relativePath,
    toDbUrl,
    walkFiles,
    yieldToEventLoop,
};
