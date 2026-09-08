'use strict';

const { createContext } = require('./lib/context');
const { runPipeline } = require('./lib/pipeline');
const { resolveProjectRoot } = require('../shared/project-runtime');

const PACKAGE_NAME = 'release-pipeline';

exports.throwError = true;

exports.load = async function load() {
    console.log(`[${PACKAGE_NAME}] hooks loaded`);
};

exports.unload = async function unload() {
    console.log(`[${PACKAGE_NAME}] hooks unloaded`);
};

exports.onAfterBuild = async function onAfterBuild(options, result) {
    if (process.env.RELEASE_PIPELINE_SKIP_HOOK === '1') {
        console.log(`[${PACKAGE_NAME}] skipped by RELEASE_PIPELINE_SKIP_HOOK`);
        return;
    }

    const packageOptions = normalizePackageOptions(options);
    const enabled = readEnabled(packageOptions);
    if (!enabled) {
        console.log(`[${PACKAGE_NAME}] disabled for this build`);
        return;
    }

    const taskNames = parseTaskNames(packageOptions.releasePipelineTasks || packageOptions.tasks);
    const projectRoot = resolveProjectRoot('', options, result);

    const context = createContext({
        projectRoot,
        options,
        result,
        source: 'cocos-hook',
        configOverrides: taskNames.length ? { tasks: taskNames.map((name) => ({ name, enabled: true })) } : {},
    });

    await runPipeline(context);
};

function normalizePackageOptions(options) {
    const packages = options && options.packages ? options.packages : {};
    const raw = packages[PACKAGE_NAME] || packages.releasePipeline || packages['releasePipeline'] || {};
    if (typeof raw === 'string') {
        try {
            return JSON.parse(raw);
        } catch (error) {
            console.warn(`[${PACKAGE_NAME}] failed to parse package options: ${error.message}`);
            return {};
        }
    }
    return raw || {};
}

function readEnabled(packageOptions) {
    if (typeof packageOptions.releasePipelineEnabled === 'boolean') {
        return packageOptions.releasePipelineEnabled;
    }
    if (typeof packageOptions.enabled === 'boolean') {
        return packageOptions.enabled;
    }
    return true;
}

function parseTaskNames(value) {
    if (Array.isArray(value)) {
        return value.map(String).map((item) => item.trim()).filter(Boolean);
    }
    if (typeof value !== 'string') {
        return [];
    }
    return value.split(',').map((item) => item.trim()).filter(Boolean);
}
