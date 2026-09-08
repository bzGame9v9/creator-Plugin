'use strict';

const fs = require('fs');
const path = require('path');
const { resolveProjectPath, relativePosix } = require('../context');
const { atomicWriteFile } = require('../asset-fingerprint');
const { requireProjectDependency } = require('../../../shared/project-runtime');

async function run(context) {
    const JavaScriptObfuscator = requireProjectDependency('javascript-obfuscator', context.projectRoot);
    const config = context.config.obfuscation || {};
    if (config.enabled === false) {
        return { skipped: true };
    }
    if (!fs.existsSync(context.buildRoot)) {
        throw new Error(`Build root not found: ${context.buildRoot}`);
    }

    const marker = config.marker || 'release-pipeline-obfuscated';
    const files = listFiles(context.buildRoot, '.js');
    const groups = createGroups(config);
    const selected = selectFiles(context.buildRoot, files, groups);

    const backupDir = createBackupDir(context);
    const processed = [];
    const skipped = [];

    for (const entry of selected) {
        const { file, group } = entry;
        const relative = relativePosix(context.buildRoot, file);
        const source = fs.readFileSync(file, 'utf8');
        if (!context.force && source.slice(0, 200).includes(marker)) {
            skipped.push({ file: relative, group: group.name, reason: 'already-obfuscated' });
            continue;
        }

        if (backupDir) {
            const backupPath = path.join(backupDir, relative);
            if (!context.dryRun) {
                fs.mkdirSync(path.dirname(backupPath), { recursive: true });
                fs.copyFileSync(file, backupPath);
            }
        }

        const obfuscated = JavaScriptObfuscator
            .obfuscate(source, group.options)
            .getObfuscatedCode();
        const output = `/* ${marker} */\n${obfuscated}`;

        if (!context.dryRun) {
            atomicWriteFile(file, Buffer.from(output, 'utf8'));
        } else {
            if (!context.pendingFileContents) {
                context.pendingFileContents = new Map();
            }
            context.pendingFileContents.set(relative, Buffer.from(output, 'utf8'));
        }

        processed.push({
            file: relative,
            group: group.name,
            beforeBytes: Buffer.byteLength(source),
            afterBytes: Buffer.byteLength(output),
        });
    }

    return {
        scanned: files.length,
        matched: selected.length,
        groups: summarizeGroups(selected, groups),
        processed,
        skipped,
        backupDir,
    };
}

function createGroups(config) {
    const globalExclude = config.exclude || [];
    const baseOptions = config.options || {};
    const configuredGroups = Array.isArray(config.groups) ? config.groups : [];

    if (!configuredGroups.length) {
        return [
            normalizeGroup({
                name: 'default',
                include: config.include || ['assets/main/index.*.js'],
                exclude: globalExclude,
                options: baseOptions,
            }, baseOptions, []),
        ];
    }

    return configuredGroups
        .filter((group) => group && group.enabled !== false)
        .map((group, index) => normalizeGroup(group, baseOptions, globalExclude, index));
}

function normalizeGroup(group, baseOptions, globalExclude, index) {
    return {
        name: group.name || `group-${index + 1}`,
        include: group.include || [],
        exclude: globalExclude.concat(group.exclude || []),
        options: Object.assign({}, baseOptions, group.options || {}),
    };
}

function selectFiles(buildRoot, files, groups) {
    const selected = [];
    const seen = new Set();

    for (const group of groups) {
        for (const file of files) {
            const relative = relativePosix(buildRoot, file);
            if (seen.has(relative)) {
                continue;
            }
            if (!matchesAny(relative, group.include)) {
                continue;
            }
            if (matchesAny(relative, group.exclude)) {
                continue;
            }

            seen.add(relative);
            selected.push({ file, group });
        }
    }

    return selected;
}

function summarizeGroups(selected, groups) {
    const summary = {};
    for (const group of groups) {
        summary[group.name] = { matched: 0 };
    }
    for (const entry of selected) {
        if (!summary[entry.group.name]) {
            summary[entry.group.name] = { matched: 0 };
        }
        summary[entry.group.name].matched += 1;
    }
    return summary;
}

function createBackupDir(context) {
    const backupConfig = context.config.backup || {};
    if (backupConfig.enabled === false) {
        return '';
    }

    const root = resolveProjectPath(context.projectRoot, backupConfig.root || 'project://build/.release-pipeline-backups');
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const dir = path.join(root, context.outputName, stamp);
    if (!context.dryRun) {
        fs.mkdirSync(dir, { recursive: true });
    }
    return dir;
}

function listFiles(root, extension) {
    const output = [];
    walk(root, output, extension);
    return output;
}

function walk(dir, output, extension) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            walk(fullPath, output, extension);
        } else if (entry.isFile() && fullPath.toLowerCase().endsWith(extension)) {
            output.push(fullPath);
        }
    }
}

function matchesAny(filePath, patterns) {
    return patterns.some((pattern) => globToRegExp(pattern).test(filePath));
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

module.exports = { run };
