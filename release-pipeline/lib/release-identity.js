'use strict';

const fs = require('fs');
const path = require('path');

const APP_VERSION_CONFIG = path.join('assets', 'base', 'src', 'Config.ts');
const APP_VERSION_CONFIG_CANDIDATES = [
    APP_VERSION_CONFIG,
    path.join('assets', 'src', 'Config.ts'),
];
const RELEASE_ENVIRONMENTS = new Set(['development', 'test', 'production']);
const APP_ENVIRONMENT_BY_RELEASE = Object.freeze({
    development: 'dev',
    test: 'test',
    production: 'prod',
});

function resolveAppVersion(projectRoot, provided) {
    if (provided !== undefined && provided !== null && String(provided).trim()) {
        return normalizePathSegment(provided, 'app version');
    }

    const configPath = APP_VERSION_CONFIG_CANDIDATES
        .map(relative => path.join(projectRoot, relative))
        .find(file => fs.existsSync(file));
    if (!configPath) {
        throw new Error(`Cannot resolve app version: none of ${APP_VERSION_CONFIG_CANDIDATES.join(', ')} exists in ${projectRoot}`);
    }

    const source = fs.readFileSync(configPath, 'utf8');
    const pattern = /^\s*app_version\s*:\s*(["'])([^"'\\\r\n]+)\1\s*,?\s*(?:\/\/.*)?$/gm;
    const matches = Array.from(source.matchAll(pattern));
    if (matches.length !== 1) {
        throw new Error(`Cannot resolve app version: expected exactly one app_version in ${configPath}, found ${matches.length}`);
    }
    return normalizePathSegment(matches[0][2], 'app version');
}

function resolveReleaseEnvironment(provided, outputName) {
    if (provided !== undefined && provided !== null && String(provided).trim()) {
        const normalized = String(provided).trim().toLowerCase();
        if (!RELEASE_ENVIRONMENTS.has(normalized)) {
            throw new Error(`Invalid release environment: ${provided}`);
        }
        return normalized;
    }

    const normalizedOutput = String(outputName || '').trim().toLowerCase();
    for (const environment of RELEASE_ENVIRONMENTS) {
        const pattern = new RegExp(`(^|[-_.])${environment}($|[-_.])`);
        if (pattern.test(normalizedOutput)) return environment;
    }
    return 'production';
}

function resolveH5Host(projectRoot, releaseEnvironment) {
    const environment = APP_ENVIRONMENT_BY_RELEASE[resolveReleaseEnvironment(releaseEnvironment)];
    const configPath = APP_VERSION_CONFIG_CANDIDATES
        .map(relative => path.join(projectRoot, relative))
        .find(file => fs.existsSync(file));
    if (!configPath) {
        throw new Error(`Cannot resolve h5Host: none of ${APP_VERSION_CONFIG_CANDIDATES.join(', ')} exists in ${projectRoot}`);
    }

    const source = fs.readFileSync(configPath, 'utf8');
    const environmentPattern = new RegExp(`\\b${environment}\\s*:\\s*\\{([\\s\\S]*?)\\n\\s*\\},`);
    const environmentMatch = source.match(environmentPattern);
    const h5HostMatch = environmentMatch && environmentMatch[1].match(/\bh5Host\s*:\s*(["'])([^"'\\\r\n]+)\1/);
    if (!h5HostMatch) {
        throw new Error(`Cannot resolve h5Host for ${environment} from ${configPath}`);
    }

    let parsed;
    try {
        parsed = new URL(h5HostMatch[2]);
    } catch (_) {
        throw new Error(`Invalid h5Host for ${environment} in ${configPath}: ${h5HostMatch[2]}`);
    }
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.search || parsed.hash) {
        throw new Error(`h5Host must be a public HTTPS origin for ${environment}: ${h5HostMatch[2]}`);
    }
    return parsed.origin;
}

function createDisplayVersion(appVersion, fingerprint) {
    return `${normalizePathSegment(appVersion, 'app version')}_${normalizePathSegment(fingerprint, 'build fingerprint')}`;
}

function normalizePathSegment(value, label) {
    const normalized = String(value || '').trim();
    if (!/^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/.test(normalized) || normalized === '.' || normalized === '..') {
        throw new Error(`Invalid ${label}: ${value}`);
    }
    return normalized;
}

function formatArchiveTimestamp(value = new Date()) {
    const date = value instanceof Date ? value : new Date(value);
    if (!Number.isFinite(date.getTime())) {
        throw new Error(`Invalid archive time: ${value}`);
    }

    const chinaTime = new Date(date.getTime() + 8 * 60 * 60 * 1000);
    const pad = (number, length = 2) => String(number).padStart(length, '0');
    return [
        chinaTime.getUTCFullYear(),
        pad(chinaTime.getUTCMonth() + 1),
        pad(chinaTime.getUTCDate()),
    ].join('') + '-' + [
        pad(chinaTime.getUTCHours()),
        pad(chinaTime.getUTCMinutes()),
        pad(chinaTime.getUTCSeconds()),
        pad(chinaTime.getUTCMilliseconds(), 3),
    ].join('');
}

module.exports = {
    APP_VERSION_CONFIG,
    APP_VERSION_CONFIG_CANDIDATES,
    RELEASE_ENVIRONMENTS,
    createDisplayVersion,
    formatArchiveTimestamp,
    normalizePathSegment,
    resolveAppVersion,
    resolveH5Host,
    resolveReleaseEnvironment,
};
