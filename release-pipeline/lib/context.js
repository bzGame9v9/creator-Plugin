'use strict';

const fs = require('fs');
const path = require('path');
const { resolveAppVersion, resolveReleaseEnvironment } = require('./release-identity');
const { resolveProjectRoot } = require('../../shared/project-runtime');

const PACKAGE_ROOT = path.resolve(__dirname, '..');
const DEFAULT_CONFIG_PATH = path.join(PACKAGE_ROOT, 'config', 'default-config.json');

function createContext(input) {
    const projectRoot = resolveProjectRoot(input.projectRoot, input.options, input.result);
    const fileConfig = loadConfig(projectRoot, input.configPath);
    const config = mergeDeep(fileConfig, input.configOverrides || {});
    const options = input.options || {};
    const platform = input.platform || options.platform || config.platform || 'web-mobile';
    const outputName = input.outputName || options.outputName || platform;
    const buildPath = input.buildPath || options.buildPath || 'project://build';
    const buildBase = resolveProjectPath(projectRoot, buildPath);
    const buildRoot = path.resolve(input.buildRoot || inferBuildRoot(projectRoot, options, input.result, buildBase, outputName));
    const environment = resolveReleaseEnvironment(input.environment, outputName);
    const appVersion = resolveAppVersion(projectRoot, input.appVersion);
    const report = {
        source: input.source || 'unknown',
        platform,
        outputName,
        environment,
        appVersion,
        projectRoot,
        buildRoot,
        startedAt: new Date().toISOString(),
        tasks: [],
        warnings: [],
    };

    return {
        projectRoot,
        packageRoot: PACKAGE_ROOT,
        config,
        options,
        result: input.result || {},
        platform,
        outputName,
        environment,
        appVersion,
        buildPath,
        buildBase,
        buildRoot,
        report,
        logger: input.logger || createLogger(),
        dryRun: Boolean(input.dryRun),
        force: Boolean(input.force),
    };
}

function loadConfig(projectRoot, configPath) {
    const baseConfig = readJson(DEFAULT_CONFIG_PATH);
    const envConfigPath = process.env.RELEASE_PIPELINE_CONFIG;
    const overridePath = configPath || envConfigPath;
    if (!overridePath) {
        return baseConfig;
    }

    const resolved = resolveProjectPath(projectRoot, overridePath);
    if (!fs.existsSync(resolved)) {
        throw new Error(`Release pipeline config not found: ${resolved}`);
    }
    return mergeDeep(baseConfig, readJson(resolved));
}

function inferBuildRoot(projectRoot, options, result, buildBase, outputName) {
    const candidates = [
        result && result.dest,
        result && result.buildPath,
        result && result.outputPath,
        result && result.paths && result.paths.dest,
        result && result.paths && result.paths.build,
    ].filter(Boolean);

    for (const candidate of candidates) {
        const resolved = resolveProjectPath(projectRoot, candidate);
        if (fs.existsSync(resolved) && fs.statSync(resolved).isDirectory()) {
            return resolved;
        }
    }

    return path.join(buildBase, outputName);
}

function resolveProjectPath(projectRoot, value) {
    if (!value) {
        return projectRoot;
    }
    const normalized = String(value).replace(/\\/g, '/');
    if (normalized.startsWith('project://')) {
        return path.resolve(projectRoot, normalized.slice('project://'.length));
    }
    if (path.isAbsolute(value)) {
        return path.resolve(value);
    }
    return path.resolve(projectRoot, value);
}

function readJson(filePath) {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function mergeDeep(base, override) {
    if (Array.isArray(base) || Array.isArray(override)) {
        return override === undefined ? clone(base) : clone(override);
    }
    if (!isPlainObject(base) || !isPlainObject(override)) {
        return override === undefined ? clone(base) : clone(override);
    }

    const output = clone(base);
    for (const key of Object.keys(override)) {
        output[key] = mergeDeep(base[key], override[key]);
    }
    return output;
}

function clone(value) {
    if (value === undefined) {
        return undefined;
    }
    return JSON.parse(JSON.stringify(value));
}

function isPlainObject(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function createLogger() {
    return {
        info(message) {
            console.log(`[release-pipeline] ${message}`);
        },
        warn(message) {
            console.warn(`[release-pipeline] ${message}`);
        },
        error(message) {
            console.error(`[release-pipeline] ${message}`);
        },
    };
}

function toPosixPath(filePath) {
    return filePath.replace(/\\/g, '/');
}

function relativePosix(from, to) {
    return toPosixPath(path.relative(from, to));
}

module.exports = {
    createContext,
    resolveProjectPath,
    mergeDeep,
    toPosixPath,
    relativePosix,
};
