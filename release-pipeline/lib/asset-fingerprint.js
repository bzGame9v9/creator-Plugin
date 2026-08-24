'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { resolveProjectPath, relativePosix } = require('./context');
const { MANIFEST_FILE, createIntegrityManifest } = require('./release-integrity');

const TEXT_EXTENSIONS = new Set(['.css', '.ejs', '.html', '.js', '.json', '.mjs', '.txt', '.xml', '.webmanifest']);
const HASHED_NAME_PATTERN = /^(.*)\.([a-f0-9]{5,32})(\.[^.]+)$/i;
const HASHED_NAME_LENGTH = 5;
const MAX_ROUNDS = 12;
const BUNDLE_HASH_CONTRACT = 'gala-cocos-bundle-v1';

async function run(context) {
    const config = context.config.fingerprint || {};
    if (config.enabled === false) {
        return { skipped: true };
    }
    if (!fs.existsSync(context.buildRoot)) {
        throw new Error(`Build root not found: ${context.buildRoot}`);
    }

    const algorithm = config.algorithm || 'md5';
    const hashLength = Number(config.length || HASHED_NAME_LENGTH);
    if (!Number.isInteger(hashLength) || hashLength < 4 || hashLength > 32) {
        throw new Error(`Invalid fingerprint length: ${config.length}`);
    }

    const tree = readTree(context);
    const initialTree = cloneTree(tree);
    const obfuscationResult = findTaskResult(context, 'obfuscateJs');
    const selected = new Set((obfuscationResult && obfuscationResult.processed || [])
        .concat(obfuscationResult && obfuscationResult.skipped || [])
        .map((entry) => entry.file)
        .filter(Boolean));
    const managed = discoverManagedFiles(tree, selected, config);
    const renameHistory = [];
    const bundleHistory = [];
    const bundlePairs = new Map();
    const changedFiles = new Set();
    let completed = false;
    let rounds = 0;

    for (let round = 0; round < MAX_ROUNDS; round += 1) {
        rounds = round + 1;
        let changed = false;
        bundlePairs.clear();
        const bundleUpdate = updateCocosBundleVersions(tree, managed, bundlePairs, algorithm, hashLength);
        if (bundleUpdate.changed) {
            changed = true;
            changedFiles.add(bundleUpdate.settingsFile);
        }
        bundleUpdate.history.forEach((entry) => bundleHistory.push(entry));

        const renameMap = calculateRenameMap(tree, managed, selected, bundlePairs, algorithm, hashLength);
        if (renameMap.size) {
            applyVirtualRenames(tree, renameMap, renameHistory);
            remapSet(managed, renameMap);
            remapSet(selected, renameMap);
            changed = true;
        }

        const referenceMap = flattenRenameHistory(renameHistory);
        const rewriteResult = rewriteReferences(tree, referenceMap);
        rewriteResult.changed.forEach((relative) => {
            changedFiles.add(relative);
            if (isHashNamed(relative) && isGeneralFingerprintCandidate(relative)) {
                managed.add(relative);
            }
            changed = true;
        });

        if (!changed) {
            completed = true;
            break;
        }
    }

    if (!completed) {
        throw new Error([
            `Fingerprint propagation did not converge after ${MAX_ROUNDS} rounds.`,
            `renames=${renameHistory.length}`,
            `changedFiles=${changedFiles.size}`,
        ].join(' '));
    }

    const audit = auditTree(tree, managed, renameHistory, bundlePairs, algorithm, hashLength, rounds);
    if (audit.errors.length) {
        throw new Error(`Release asset audit failed:\n- ${audit.errors.join('\n- ')}`);
    }

    const integrityManifest = createIntegrityManifest(tree, audit, context);
    tree.set(MANIFEST_FILE, Buffer.from(JSON.stringify(integrityManifest, null, 2), 'utf8'));

    const committed = !context.dryRun && commitTree(context.buildRoot, initialTree, tree);
    context.fingerprintAudit = audit;
    context.integrityManifest = integrityManifest;

    return {
        algorithm,
        hashLength,
        rounds,
        committed,
        managedFiles: Array.from(managed).sort(),
        renamed: renameHistory,
        bundleVersions: bundleHistory,
        changedFiles: Array.from(changedFiles).sort(),
        audit,
        integrityManifest,
    };
}

function readTree(context) {
    const tree = new Map();
    walkFiles(context.buildRoot, (absolute, relative) => {
        if (isPipelineArtifact(relative)) {
            return;
        }
        const pending = context.pendingFileContents && context.pendingFileContents.get(relative);
        tree.set(relative, pending ? Buffer.from(pending) : fs.readFileSync(absolute));
    });
    return tree;
}

function cloneTree(tree) {
    const clone = new Map();
    tree.forEach((buffer, relative) => clone.set(relative, Buffer.from(buffer)));
    return clone;
}

function discoverManagedFiles(tree, selected, config) {
    const managed = new Set(selected);
    const configuredInclude = Array.isArray(config.include) ? config.include : [];
    const configuredExclude = Array.isArray(config.exclude) ? config.exclude : [];

    tree.forEach((buffer, relative) => {
        if (isPipelineArtifact(relative) || matchesAny(relative, configuredExclude)) {
            return;
        }
        if (matchesAny(relative, configuredInclude)) {
            managed.add(relative);
        }
        if (isHashNamed(relative) && isGeneralFingerprintCandidate(relative)) {
            managed.add(relative);
        }
    });

    return managed;
}

function updateCocosBundleVersions(tree, managed, bundlePairs, algorithm, hashLength) {
    const history = [];
    let changed = false;
    const bundlesToUpdate = new Map();

    const entriesByBundle = groupBundleEntries(discoverCocosBundleEntries(tree));
    entriesByBundle.forEach((entries, bundleName) => {
        if (entries.length !== 1) {
            throw new Error(`Cocos bundle index must have exactly one file: ${bundleName} has ${entries.length}`);
        }
        const relative = entries[0];
        const match = /^assets\/([^/]+)\/index(?:\.[a-f0-9]+)?\.js$/i.exec(relative);
        if (!match || !tree.has(relative)) {
            return;
        }
        const configFiles = findBundleConfigs(tree, bundleName);
        if (configFiles.length !== 1) {
            throw new Error(`Cocos bundle config must have exactly one file: ${bundleName} has ${configFiles.length}`);
        }
        const configRelative = configFiles[0];
        const version = bundleContentHash(tree.get(relative), tree.get(configRelative), algorithm, hashLength);
        bundlesToUpdate.set(bundleName, { index: relative, config: configRelative, version });
        managed.add(relative);
        managed.add(configRelative);
    });

    if (!bundlesToUpdate.size) {
        return { changed, settingsFile: '', history };
    }

    const settingsFile = findSettingsFile(tree);
    if (!settingsFile) {
        throw new Error('Cocos bundle versions changed but src/settings*.json was not found');
    }
    let settings;
    try {
        settings = JSON.parse(tree.get(settingsFile).toString('utf8'));
    } catch (error) {
        throw new Error(`Cannot parse ${settingsFile}: ${error.message}`);
    }
    if (!settings.assets || typeof settings.assets !== 'object') {
        throw new Error(`${settingsFile} has no assets configuration for Cocos bundle versions`);
    }
    if (!settings.assets.bundleVers || typeof settings.assets.bundleVers !== 'object') {
        settings.assets.bundleVers = {};
    }

    bundlesToUpdate.forEach((bundle, bundleName) => {
        const before = settings.assets.bundleVers[bundleName];
        if (before !== bundle.version) {
            settings.assets.bundleVers[bundleName] = bundle.version;
            history.push({ bundle: bundleName, before: before || '', after: bundle.version });
            changed = true;
        }
        bundlePairs.set(bundle.index, bundle);
        bundlePairs.set(bundle.config, bundle);
    });

    if (changed) {
        tree.set(settingsFile, Buffer.from(JSON.stringify(settings), 'utf8'));
        managed.add(settingsFile);
    }
    return { changed, settingsFile, history };
}

function calculateRenameMap(tree, managed, selected, bundlePairs, algorithm, hashLength) {
    const renameMap = new Map();
    const targets = new Map();

    managed.forEach((relative) => {
        const buffer = tree.get(relative);
        if (!buffer || !isFingerprintCandidate(relative, selected)) {
            return;
        }

        let desired;
        const bundle = bundlePairs.get(relative);
        if (bundle) {
            desired = replaceHashSegment(relative, bundle.version, hashLength);
        } else {
            desired = replaceHashSegment(relative, contentHash(buffer, algorithm, hashLength), hashLength);
        }
        if (desired === relative) {
            return;
        }
        const existing = targets.get(desired);
        if (existing && existing !== relative) {
            throw new Error(`Fingerprint rename collision: ${existing} and ${relative} -> ${desired}`);
        }
        targets.set(desired, relative);
        renameMap.set(relative, desired);
    });

    renameMap.forEach((desired, relative) => {
        if (tree.has(desired) && !renameMap.has(desired)) {
            throw new Error(`Fingerprint target already exists and is not being moved: ${desired}`);
        }
    });
    return renameMap;
}

function applyVirtualRenames(tree, renameMap, history) {
    const moved = [];
    renameMap.forEach((desired, relative) => {
        moved.push({ relative, desired, buffer: tree.get(relative) });
    });
    moved.forEach((entry) => tree.delete(entry.relative));
    moved.forEach((entry) => {
        tree.set(entry.desired, entry.buffer);
        history.push({ from: entry.relative, to: entry.desired });
    });
}

function rewriteReferences(tree, renameMap) {
    const changed = [];
    if (!renameMap.size) {
        return { changed };
    }

    tree.forEach((buffer, relative) => {
        if (relative === MANIFEST_FILE || !isTextFile(relative)) {
            return;
        }
        const source = buffer.toString('utf8');
        let output;
        if (path.posix.extname(relative).toLowerCase() === '.json') {
            output = rewriteJson(source, relative, renameMap);
        } else {
            output = replaceTextReferences(source, relative, renameMap);
        }
        if (output !== source) {
            tree.set(relative, Buffer.from(output, 'utf8'));
            changed.push(relative);
        }
    });
    return { changed };
}

function rewriteJson(source, relative, renameMap) {
    let value;
    try {
        value = JSON.parse(source);
    } catch (error) {
        throw new Error(`Cannot parse JSON while rewriting ${relative}: ${error.message}`);
    }
    let changed = false;
    const rewrite = (item) => {
        if (typeof item === 'string') {
            const output = replaceTextReferences(item, relative, renameMap);
            if (output !== item) changed = true;
            return output;
        }
        if (Array.isArray(item)) return item.map(rewrite);
        if (item && typeof item === 'object') {
            Object.keys(item).forEach((key) => {
                const nextKey = rewrite(key);
                const nextValue = rewrite(item[key]);
                if (nextKey !== key) {
                    delete item[key];
                    item[nextKey] = nextValue;
                } else {
                    item[key] = nextValue;
                }
            });
        }
        return item;
    };
    const next = rewrite(value);
    return changed ? JSON.stringify(next) : source;
}

function replaceTextReferences(source, relative, renameMap) {
    let output = source;
    const replacements = [];
    renameMap.forEach((to, from) => {
        createReferenceVariants(relative, from, to).forEach((pair) => replacements.push(pair));
    });
    replacements.sort((left, right) => right.from.length - left.from.length);
    replacements.forEach((pair) => {
        if (pair.from) output = output.split(pair.from).join(pair.to);
    });
    return output;
}

function createReferenceVariants(sourceRelative, fromRelative, toRelative) {
    const sourceDir = path.posix.dirname(sourceRelative);
    const fromDir = path.posix.dirname(fromRelative);
    const relativeFromSource = path.posix.relative(sourceDir === '.' ? '' : sourceDir, fromRelative) || path.posix.basename(fromRelative);
    const relativeToSource = path.posix.relative(sourceDir === '.' ? '' : sourceDir, toRelative) || path.posix.basename(toRelative);
    const values = new Map();
    addVariant(values, fromRelative, toRelative);
    addVariant(values, `./${fromRelative}`, `./${toRelative}`);
    addVariant(values, relativeFromSource, relativeToSource);
    addVariant(values, `./${relativeFromSource}`, `./${relativeToSource}`);
    addVariant(values, `/${fromRelative}`, `/${toRelative}`);
    if (fromDir === sourceDir || (sourceDir === '.' && fromDir === '.')) {
        addVariant(values, path.posix.basename(fromRelative), path.posix.basename(toRelative));
    }
    const output = [];
    values.forEach((to, from) => {
        output.push({ from, to });
        if (from.indexOf('/') >= 0) {
            output.push({ from: from.replace(/\//g, '\\'), to: to.replace(/\//g, '\\') });
        }
    });
    return output;
}

function addVariant(values, from, to) {
    if (from && to) values.set(from, to);
}

function auditTree(tree, managed, renameHistory, bundlePairs, algorithm, hashLength, rounds) {
    const errors = [];
    const staleReferences = [];
    const missingReferences = [];
    const references = [];
    const historyMap = flattenRenameHistory(renameHistory);
    const bundleAudit = auditCocosBundleVersions(tree, errors, algorithm, hashLength);

    managed.forEach((relative) => {
        const buffer = tree.get(relative);
        if (!buffer || !isGeneralFingerprintCandidate(relative) || isCocosBundleEntry(relative)) return;
        if (!isHashNamed(relative)) {
            errors.push(`managed file is not fingerprinted: ${relative}`);
            return;
        }
        const actual = contentHash(buffer, algorithm, hashLength);
        const expected = getHashSegment(relative);
        if (actual !== expected) {
            errors.push(`content hash mismatch: ${relative}, expected ${expected}, actual ${actual}`);
        }
    });

    tree.forEach((buffer, relative) => {
        if (relative === MANIFEST_FILE || !isTextFile(relative)) return;
        const source = stripHtmlComments(buffer.toString('utf8'), relative);
        extractLocalReferences(source, relative).forEach((reference) => {
            const target = resolveReference(relative, reference, tree);
            if (!target) return;
            references.push({ from: relative, reference, target });
            if (!tree.has(target)) {
                missingReferences.push(`${relative} -> ${reference}`);
            }
        });
        historyMap.forEach((to, from) => {
            if (source.indexOf(from) >= 0 || source.indexOf(`./${from}`) >= 0) {
                staleReferences.push(`${relative} still references ${from}; expected ${to}`);
            }
        });
    });

    if (!tree.has('index.html')) {
        errors.push('index.html is missing');
    }
    const importMaps = Array.from(tree.keys()).filter((relative) => /^src\/import-map(?:\.[a-f0-9]+)?\.json$/i.test(relative));
    if (importMaps.length !== 1) {
        errors.push(`expected exactly one src/import-map*.json, found ${importMaps.length}`);
    } else {
        try {
            JSON.parse(tree.get(importMaps[0]).toString('utf8'));
        } catch (error) {
            errors.push(`invalid import-map JSON: ${importMaps[0]}: ${error.message}`);
        }
    }

    const workers = Array.from(tree.keys()).filter((relative) => /^firebase-messaging-sw(?:\.[a-f0-9]+)?\.js$/i.test(path.posix.basename(relative)));
    if (workers.length !== 1) {
        errors.push(`expected exactly one firebase-messaging-sw*.js, found ${workers.length}`);
    } else {
        const workerName = path.posix.basename(workers[0]);
        const html = tree.has('index.html') ? tree.get('index.html').toString('utf8') : '';
        if (html.indexOf(workerName) < 0) errors.push(`index.html does not reference ${workerName}`);
        const workerSource = tree.get(workers[0]).toString('utf8');
        if (!/cocos-pwa-cache-v[0-9]+/.test(workerSource)) errors.push(`${workers[0]} has no versioned PWA cache`);
        if (!/networkFirst/.test(workerSource)) errors.push(`${workers[0]} has no network-first cache migration path`);
        const workerDebugHandling = /searchParams\.get\(['"]debug['"]\)/.test(workerSource)
            || (workerSource.indexOf('SERVICE_WORKER_DEBUG') >= 0
                && workerSource.indexOf('searchParams') >= 0
                && workerSource.indexOf('debug') >= 0);
        if (!workerDebugHandling) errors.push(`${workers[0]} has no debug query handling`);
    }

    missingReferences.forEach((entry) => errors.push(`missing local reference: ${entry}`));
    staleReferences.forEach((entry) => errors.push(`stale local reference: ${entry}`));
    return {
        passed: errors.length === 0,
        errors,
        rounds: rounds || 0,
        references,
        missingReferences,
        staleReferences,
        renamedFiles: renameHistory.length,
        managedFiles: managed.size,
        bundlePairs: Array.from(bundlePairs.keys()).sort(),
        bundles: bundleAudit,
    };
}

function auditCocosBundleVersions(tree, errors, algorithm, hashLength) {
    const entriesByBundle = groupBundleEntries(discoverCocosBundleEntries(tree));
    const configBundles = new Set();
    tree.forEach((buffer, relative) => {
        const match = /^assets\/([^/]+)\/config(?:\.[a-f0-9]+)?\.json$/i.exec(relative);
        if (match) configBundles.add(match[1]);
    });
    configBundles.forEach((bundleName) => {
        if (!entriesByBundle.has(bundleName)) {
            errors.push(`Cocos bundle config has no index entry: ${bundleName}`);
        }
    });

    const settingsFile = findSettingsFile(tree);
    let settings = null;
    if (settingsFile) {
        try {
            settings = JSON.parse(tree.get(settingsFile).toString('utf8'));
        } catch (error) {
            errors.push(`invalid Cocos settings JSON: ${settingsFile}: ${error.message}`);
        }
    }

    const bundleVersions = settings && settings.assets && settings.assets.bundleVers;
    if (!bundleVersions || typeof bundleVersions !== 'object') {
        errors.push(`${settingsFile || 'src/settings*.json'} has no assets.bundleVers for Cocos bundle entries`);
    }

    return Array.from(entriesByBundle.entries()).sort(([left], [right]) => left.localeCompare(right)).map(([bundleName, entries]) => {
        if (entries.length !== 1) {
            errors.push(`Cocos bundle index must have exactly one file: ${bundleName} has ${entries.length}`);
        }
        const index = entries[0];
        const configs = findBundleConfigs(tree, bundleName);
        if (configs.length !== 1) {
            errors.push(`Cocos bundle config must have exactly one file: ${bundleName} has ${configs.length}`);
        }
        const config = configs[0] || '';
        const indexVersion = getHashSegment(index);
        const configVersion = getHashSegment(config);
        const settingsVersion = bundleVersions && bundleVersions[bundleName] || '';
        const expectedVersion = index && config && tree.has(index) && tree.has(config)
            ? bundleContentHash(tree.get(index), tree.get(config), algorithm, hashLength)
            : '';
        const indexContentDigest = index && tree.has(index) ? contentHash(tree.get(index), algorithm, 32) : '';
        const configContentDigest = config && tree.has(config) ? contentHash(tree.get(config), algorithm, 32) : '';

        if (!config) {
            errors.push(`Cocos bundle config missing for ${index}`);
        }
        if (!indexVersion) {
            errors.push(`Cocos bundle entry is not fingerprinted: ${index}`);
        }
        if (config && configVersion !== indexVersion) {
            errors.push(`Cocos bundle version mismatch: ${index} vs ${config}`);
        }
        if (settingsVersion !== indexVersion) {
            errors.push(`Cocos settings bundle version mismatch: ${bundleName}=${settingsVersion || '<missing>'}, expected ${indexVersion}`);
        }
        if (expectedVersion && (indexVersion !== expectedVersion || configVersion !== expectedVersion || settingsVersion !== expectedVersion)) {
            errors.push([
                `Cocos bundle version content mismatch: ${bundleName}`,
                `expected=${expectedVersion}`,
                `index=${indexVersion || '<missing>'}`,
                `config=${configVersion || '<missing>'}`,
                `settings=${settingsVersion || '<missing>'}`,
            ].join(', '));
        }

        return {
            bundle: bundleName,
            index,
            config,
            indexVersion,
            configVersion,
            settingsVersion,
            expectedVersion,
            indexContentDigest,
            configContentDigest,
        };
    });
}

function commitTree(root, initialTree, tree) {
    const stage = path.join(root, `.release-pipeline-staging-${process.pid}-${Date.now()}`);
    const stageNew = path.join(stage, 'new');
    const stageOld = path.join(stage, 'old');
    const movedOld = [];
    const movedNew = [];
    const overwritten = [];
    fs.mkdirSync(stageNew, { recursive: true });
    fs.mkdirSync(stageOld, { recursive: true });

    try {
        tree.forEach((buffer, relative) => {
            const absolute = path.join(root, relative);
            const old = initialTree.get(relative);
            if (!old || !old.equals(buffer)) {
                const staged = path.join(stageNew, relative);
                fs.mkdirSync(path.dirname(staged), { recursive: true });
                fs.writeFileSync(staged, buffer);
            }
        });

        initialTree.forEach((buffer, relative) => {
            const current = tree.get(relative);
            if (current && current.equals(buffer)) return;
            const absolute = path.join(root, relative);
            if (!fs.existsSync(absolute)) return;
            const staged = path.join(stageOld, relative);
            fs.mkdirSync(path.dirname(staged), { recursive: true });
            fs.renameSync(absolute, staged);
            movedOld.push({ staged, absolute });
        });

        tree.forEach((buffer, relative) => {
            const staged = path.join(stageNew, relative);
            if (!fs.existsSync(staged)) return;
            const absolute = path.join(root, relative);
            if (fs.existsSync(absolute)) {
                const previous = path.join(stageOld, `overwrite-${movedNew.length}-${path.basename(relative)}`);
                fs.mkdirSync(path.dirname(previous), { recursive: true });
                fs.renameSync(absolute, previous);
                overwritten.push({ previous, absolute });
            }
            fs.mkdirSync(path.dirname(absolute), { recursive: true });
            fs.renameSync(staged, absolute);
            movedNew.push({ absolute, staged });
        });
        fs.rmSync(stage, { recursive: true, force: true });
        return true;
    } catch (error) {
        movedNew.reverse().forEach((entry) => {
            if (fs.existsSync(entry.absolute)) fs.rmSync(entry.absolute, { force: true });
        });
        overwritten.reverse().forEach((entry) => {
            if (fs.existsSync(entry.previous)) fs.renameSync(entry.previous, entry.absolute);
        });
        movedOld.reverse().forEach((entry) => {
            if (fs.existsSync(entry.staged)) fs.renameSync(entry.staged, entry.absolute);
        });
        fs.rmSync(stage, { recursive: true, force: true });
        throw new Error(`Cannot atomically commit fingerprinted build: ${error.message}`);
    }
}

function atomicWriteFile(file, value) {
    const directory = path.dirname(file);
    const temporary = path.join(directory, `.${path.basename(file)}.release-pipeline-${process.pid}-${Date.now()}.tmp`);
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(temporary, value);
    try {
        fs.renameSync(temporary, file);
    } catch (error) {
        fs.rmSync(temporary, { force: true });
        throw error;
    }
}

function findBundleConfigs(tree, bundleName) {
    return Array.from(tree.keys())
        .filter((relative) => new RegExp(`^assets/${escapeRegExp(bundleName)}/config(?:\\.[a-f0-9]+)?\\.json$`, 'i').test(relative))
        .sort();
}

function findBundleConfig(tree, bundleName) {
    return findBundleConfigs(tree, bundleName)[0] || '';
}

function discoverCocosBundleEntries(tree) {
    return Array.from(tree.keys())
        .filter((relative) => /^assets\/[^/]+\/index(?:\.[a-f0-9]+)?\.js$/i.test(relative))
        .sort();
}

function groupBundleEntries(entries) {
    const grouped = new Map();
    entries.forEach((relative) => {
        const match = /^assets\/([^/]+)\/index(?:\.[a-f0-9]+)?\.js$/i.exec(relative);
        if (!match) return;
        const list = grouped.get(match[1]) || [];
        list.push(relative);
        grouped.set(match[1], list);
    });
    return grouped;
}

function findSettingsFile(tree) {
    return Array.from(tree.keys()).find((relative) => /^src\/settings(?:\.[a-f0-9]+)?\.json$/i.test(relative)) || '';
}

function findTaskResult(context, name) {
    const task = (context.report.tasks || []).find((entry) => entry.name === name && entry.status === 'success');
    return task && task.result || null;
}

function isFingerprintCandidate(relative, selected) {
    if (isCocosBundleEntry(relative)) return true;
    if (isCocosBundleConfig(relative)) return true;
    if (selected.has(relative)) return true;
    return isGeneralFingerprintCandidate(relative);
}

function isGeneralFingerprintCandidate(relative) {
    const normalized = relative.replace(/\\/g, '/');
    if (isPipelineArtifact(normalized) || normalized.indexOf('cocos-js/') === 0) return false;
    if (normalized.indexOf('assets/') === 0) return /^assets\/[^/]+\/index(?:\.[a-f0-9]+)?\.js$/i.test(normalized);
    return /\.(?:css|js|json)$/i.test(normalized) && (normalized.indexOf('src/') === 0 || normalized.indexOf('/') < 0);
}

function isCocosBundleEntry(relative) {
    return /^assets\/[^/]+\/index(?:\.[a-f0-9]+)?\.js$/i.test(relative);
}

function isCocosBundleConfig(relative) {
    return /^assets\/[^/]+\/config(?:\.[a-f0-9]+)?\.json$/i.test(relative);
}

function isHashNamed(relative) {
    return Boolean(HASHED_NAME_PATTERN.exec(path.posix.basename(relative)));
}

function getHashSegment(relative) {
    const match = HASHED_NAME_PATTERN.exec(path.posix.basename(relative));
    return match ? match[2].toLowerCase() : '';
}

function replaceHashSegment(relative, hash, hashLength) {
    const directory = path.posix.dirname(relative);
    const basename = path.posix.basename(relative);
    const match = HASHED_NAME_PATTERN.exec(basename);
    let next;
    if (match) {
        next = `${match[1]}.${hash}${match[3]}`;
    } else {
        const extension = path.posix.extname(basename);
        if (!extension) return relative;
        next = `${basename.slice(0, -extension.length)}.${hash}${extension}`;
    }
    return directory === '.' ? next : `${directory}/${next}`;
}

function contentHash(buffer, algorithm, hashLength) {
    return crypto.createHash(algorithm).update(buffer).digest('hex').slice(0, hashLength).toLowerCase();
}

function bundleContentHash(indexBuffer, configBuffer, algorithm, hashLength) {
    const hash = crypto.createHash(algorithm);
    hash.update(`${BUNDLE_HASH_CONTRACT}\0`, 'utf8');
    updateBundleHashPart(hash, 'index.js', indexBuffer);
    updateBundleHashPart(hash, 'config.json', configBuffer);
    return hash.digest('hex').slice(0, hashLength).toLowerCase();
}

function updateBundleHashPart(hash, label, buffer) {
    hash.update(`${label}\0${buffer.length}\0`, 'utf8');
    hash.update(buffer);
}

function flattenRenameHistory(history) {
    const output = new Map();
    history.forEach((entry) => {
        output.set(entry.from, entry.to);
    });
    let changed = true;
    while (changed) {
        changed = false;
        output.forEach((to, from) => {
            const final = output.get(to);
            if (final && final !== to) {
                output.set(from, final);
                changed = true;
            }
        });
    }
    return output;
}

function remapSet(set, renameMap) {
    const next = new Set();
    set.forEach((relative) => next.add(renameMap.get(relative) || relative));
    set.clear();
    next.forEach((relative) => set.add(relative));
}

function extractLocalReferences(source, relative) {
    const extension = path.posix.extname(relative).toLowerCase();
    if (extension === '.json') {
        return extractJsonReferences(source, relative);
    }
    if (extension === '.css') {
        return extractCssReferences(source);
    }

    const code = stripJavaScriptComments(source);
    const output = [];
    const patterns = [
        // Cocos' top-level entry uses System.import and its generated modules use e.import.
        new RegExp(`\\bimport\\s*\\(\\s*${QUOTED_ASSET_PATTERN.source}`, 'gi'),
        new RegExp(`\\b(?:import|export)\\s+(?:[^'\"\\x60;\\n]+?\\s+from\\s+)?${QUOTED_ASSET_PATTERN.source}`, 'gi'),
        new RegExp(`\\b(?:fetch|importScripts|require)\\s*\\(\\s*${QUOTED_ASSET_PATTERN.source}`, 'gi'),
        new RegExp(`(?:navigator\\.)?serviceWorker\\.register\\s*\\(\\s*${QUOTED_ASSET_PATTERN.source}`, 'gi'),
        new RegExp(`\\bnew\\s+(?:Worker|SharedWorker|URL)\\s*\\(\\s*${QUOTED_ASSET_PATTERN.source}`, 'gi'),
        new RegExp(`(?:\\.\\s*(?:src|href)|\\[\\s*['\"](?:src|href)['\"]\\s*\\])\\s*=\\s*${QUOTED_ASSET_PATTERN.source}`, 'gi'),
        new RegExp(`\\.setAttribute\\s*\\(\\s*['\"](?:src|href)['\"]\\s*,\\s*${QUOTED_ASSET_PATTERN.source}`, 'gi'),
        new RegExp(`\\b[A-Za-z_$][\\w$]*(?:Url|URL|Path|Src|Href|Worker)\\s*=\\s*${QUOTED_ASSET_PATTERN.source}`, 'gi'),
        new RegExp(`\\b(?:swUrl|workerUrl|scriptUrl|serviceWorkerUrl|sourceUrl)\\s*:\\s*${QUOTED_ASSET_PATTERN.source}`, 'gi'),
        new RegExp(`\\b(?:e|_export)\\s*\\(\\s*['\"]default['\"]\\s*,\\s*${QUOTED_ASSET_PATTERN.source}`, 'gi'),
    ];
    patterns.forEach((pattern) => collectQuotedReferences(code, pattern, output));

    // Anonymous System.register dependencies are real files for index.*.js/application.*.js.
    // Named chunks:///_virtual modules resolve inside an already loaded bundle and are not HTTP files.
    const anonymousSystemRegister = /\bSystem\.register\s*\(\s*(\[[\s\S]*?\])\s*,/gi;
    let registerMatch;
    while ((registerMatch = anonymousSystemRegister.exec(code))) {
        collectQuotedReferences(registerMatch[1], newAssetPattern(), output);
    }

    if (extension === '.html') {
        const htmlPattern = /<(?:script|link)\b[^>]*?\b(?:src|href)\s*=\s*(['"])([^'"]+)\1/gi;
        let htmlMatch;
        while ((htmlMatch = htmlPattern.exec(source))) {
            output.push(htmlMatch[2]);
        }
    }

    return uniqueLocalReferences(output);
}

const QUOTED_ASSET_PATTERN = /(['"\x60])((?:\.{0,2}\/|\/)?[^'"\x60<>\s]+?\.(?:js|json|css|wasm|bin)(?:[?#][^'"\x60<>\s]*)?)\1/gi;

function newAssetPattern() {
    return new RegExp(QUOTED_ASSET_PATTERN.source, 'gi');
}

function collectQuotedReferences(source, pattern, output) {
    let match;
    while ((match = pattern.exec(source))) {
        output.push(match[2]);
    }
}

function extractJsonReferences(source, relative) {
    let value;
    try {
        value = JSON.parse(source);
    } catch (error) {
        throw new Error(`Cannot parse JSON while auditing ${relative}: ${error.message}`);
    }
    const output = [];
    const visit = (item) => {
        if (typeof item === 'string' && /\.(?:js|json|css|wasm|bin)(?:[?#].*)?$/i.test(item)) {
            output.push(item);
            return;
        }
        if (Array.isArray(item)) {
            item.forEach(visit);
            return;
        }
        if (item && typeof item === 'object') {
            Object.values(item).forEach(visit);
        }
    };
    visit(value);
    return uniqueLocalReferences(output);
}

function extractCssReferences(source) {
    const output = [];
    const pattern = /\burl\(\s*(['"])([^'"]+)\1/gi;
    let match;
    while ((match = pattern.exec(source))) {
        if (/\.(?:js|json|css|wasm|bin)(?:[?#].*)?$/i.test(match[2])) output.push(match[2]);
    }
    return uniqueLocalReferences(output);
}

function uniqueLocalReferences(references) {
    return Array.from(new Set(references)).filter((reference) => {
        return !/^(?:[a-z]+:|\/\/|data:|blob:)/i.test(reference);
    });
}

function stripJavaScriptComments(source) {
    let output = '';
    let state = 'code';
    for (let index = 0; index < source.length; index += 1) {
        const current = source[index];
        const next = source[index + 1];
        if (state === 'code') {
            if (current === '/' && next === '/') {
                output += '  ';
                index += 1;
                state = 'lineComment';
            } else if (current === '/' && next === '*') {
                output += '  ';
                index += 1;
                state = 'blockComment';
            } else if (current === '\"' || current === '\'' || current === '`') {
                output += current;
                state = current === '`' ? 'template' : current;
            } else {
                output += current;
            }
        } else if (state === 'lineComment') {
            if (current === '\n' || current === '\r') {
                output += current;
                state = 'code';
            } else {
                output += ' ';
            }
        } else if (state === 'blockComment') {
            if (current === '*' && next === '/') {
                output += '  ';
                index += 1;
                state = 'code';
            } else {
                output += current === '\n' || current === '\r' ? current : ' ';
            }
        } else {
            output += current;
            if (current === '\\') {
                if (index + 1 < source.length) output += source[++index];
            } else if (current === state) {
                state = 'code';
            }
        }
    }
    return output;
}

function resolveReference(sourceRelative, reference, tree) {
    const clean = reference.split(/[?#]/)[0].replace(/\\/g, '/');
    if (!clean || /^(?:[a-z]+:|\/\/|data:|blob:)/i.test(clean)) return '';
    if (clean.charAt(0) === '/') {
        return normalizeReferencePath(clean.slice(1));
    }

    const sourceRelativeTarget = normalizeReferencePath(
        path.posix.join(path.posix.dirname(sourceRelative), clean)
    );
    if (clean.indexOf('./') === 0 || clean.indexOf('../') === 0 || !tree) {
        return sourceRelativeTarget;
    }

    // Cocos settings and resource metadata also use root-relative paths without
    // a leading slash, for example "src/effect.bin" from src/settings*.json.
    // Prefer the existing root path only when the source-relative candidate is
    // absent; ambiguous paths remain source-relative and are audited normally.
    const rootRelativeTarget = normalizeReferencePath(clean);
    if (!tree.has(sourceRelativeTarget) && tree.has(rootRelativeTarget)) {
        return rootRelativeTarget;
    }
    return sourceRelativeTarget;
}

function normalizeReferencePath(value) {
    const normalized = path.posix.normalize(value).replace(/^\.\//, '');
    if (normalized.indexOf('../') === 0 || normalized === '..') return '';
    return normalized;
}

function stripHtmlComments(source, relative) {
    return path.posix.extname(relative).toLowerCase() === '.html'
        ? source.replace(/<!--[\s\S]*?-->/g, '')
        : source;
}

function isTextFile(relative) {
    return TEXT_EXTENSIONS.has(path.posix.extname(relative).toLowerCase());
}

function isPipelineArtifact(relative) {
    return relative === '.release-pipeline'
        || relative.indexOf('.release-pipeline/') === 0
        || relative.indexOf('.release-pipeline-backups/') === 0
        || relative.indexOf('.release-pipeline-reports/') === 0
        || relative.indexOf('.release-pipeline-staging-') === 0;
}

function walkFiles(root, callback) {
    const stack = [root];
    while (stack.length) {
        const directory = stack.pop();
        fs.readdirSync(directory, { withFileTypes: true }).forEach((entry) => {
            const absolute = path.join(directory, entry.name);
            if (entry.isDirectory()) {
                stack.push(absolute);
            } else if (entry.isFile()) {
                callback(absolute, relativePosix(root, absolute));
            }
        });
    }
}

function matchesAny(value, patterns) {
    return patterns.some((pattern) => globToRegExp(pattern).test(value));
}

function globToRegExp(pattern) {
    const input = String(pattern).replace(/\\/g, '/');
    let source = '';
    for (let index = 0; index < input.length; index += 1) {
        const char = input[index];
        const next = input[index + 1];
        const afterNext = input[index + 2];
        if (char === '*' && next === '*' && afterNext === '/') {
            source += '(?:.*/)?';
            index += 2;
        } else if (char === '*' && next === '*') {
            source += '.*';
            index += 1;
        } else if (char === '*') {
            source += '[^/]*';
        } else if (char === '?') {
            source += '[^/]';
        } else {
            source += escapeRegExp(char);
        }
    }
    return new RegExp(`^${source}$`);
}

function escapeRegExp(value) {
    return value.replace(/[|\\{}()[\]^$+?.]/g, '\\$&');
}

module.exports = {
    run,
    atomicWriteFile,
    auditTree,
    bundleContentHash,
    contentHash,
};
