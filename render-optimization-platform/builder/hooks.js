'use strict';

const path = require('path');
const { scanProject } = require('../core/scanner');
const { writeReport } = require('../core/report');

const PACKAGE_NAME = 'render-optimization-platform';
exports.throwError = false;

function getProjectRoot() {
    if (global.Editor && Editor.Project && Editor.Project.path) return Editor.Project.path;
    return process.cwd();
}

function packageOptions(options) {
    const value = options && options.packages && options.packages[PACKAGE_NAME];
    if (!value) return {};
    if (typeof value === 'string') {
        try {
            return JSON.parse(value);
        } catch (error) {
            return {};
        }
    }
    return value;
}

function buildOutputRoot(options, result) {
    return options && (options.dest || options.outputName)
        || result && (result.dest || result.outputPath)
        || path.join(getProjectRoot(), 'build');
}

exports.load = async function load() {
    console.log(`[${PACKAGE_NAME}] build hooks loaded`);
};

exports.unload = async function unload() {
    console.log(`[${PACKAGE_NAME}] build hooks unloaded`);
};

exports.onAfterBuild = async function onAfterBuild(options, result) {
    const settings = packageOptions(options);
    if (settings.enabled === false) {
        console.log(`[${PACKAGE_NAME}] build report disabled`);
        return;
    }
    try {
        const report = await scanProject(getProjectRoot());
        const outputDirectory = path.join(path.resolve(buildOutputRoot(options, result)), 'render-optimization-report');
        const paths = await writeReport(report, outputDirectory, {
            baseName: 'render-report',
            markdown: settings.markdown === true,
        });
        console.log(`[${PACKAGE_NAME}] build report: ${paths.jsonPath}`);
    } catch (error) {
        console.warn(`[${PACKAGE_NAME}] build report failed: ${error && (error.stack || error.message) || error}`);
    }
};
