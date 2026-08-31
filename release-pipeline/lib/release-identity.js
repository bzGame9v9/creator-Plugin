'use strict';

const fs = require('fs');
const path = require('path');

const APP_VERSION_CONFIG = path.join('assets', 'src', 'Config.ts');
const RELEASE_ENVIRONMENTS = new Set(['development', 'test', 'production']);

function resolveAppVersion(projectRoot, provided) {
    if (provided !== undefined && provided !== null && String(provided).trim()) {
        return normalizePathSegment(provided, 'app version');
    }

    const configPath = path.join(projectRoot, APP_VERSION_CONFIG);
    if (!fs.existsSync(configPath)) {
        throw new Error(`Cannot resolve app version: ${configPath} does not exist`);
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
    RELEASE_ENVIRONMENTS,
    createDisplayVersion,
    formatArchiveTimestamp,
    normalizePathSegment,
    resolveAppVersion,
    resolveReleaseEnvironment,
};
