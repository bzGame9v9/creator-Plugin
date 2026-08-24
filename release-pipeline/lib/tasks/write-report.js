'use strict';

const fs = require('fs');
const path = require('path');
const { resolveProjectPath } = require('../context');

async function run(context) {
    const config = context.config.reports || {};
    if (config.enabled === false) {
        return { skipped: true };
    }

    return prepareReportPaths(context, config);
}

function prepareReportPaths(context, config) {
    const reportRoot = resolveProjectPath(context.projectRoot, config.root || 'project://build/.release-pipeline-reports');
    const latest = path.join(reportRoot, `${context.outputName}-latest.json`);
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const history = path.join(reportRoot, `${context.outputName}-${stamp}.json`);

    return { latest, history };
}

function writeReportFiles(context, paths) {
    if (!paths || paths.skipped) {
        return;
    }

    const latest = paths.latest;
    const history = paths.history;
    const reportRoot = path.dirname(latest);
    fs.mkdirSync(reportRoot, { recursive: true });
    fs.writeFileSync(latest, JSON.stringify(context.report, null, 2), 'utf8');
    fs.writeFileSync(history, JSON.stringify(context.report, null, 2), 'utf8');
}

module.exports = { run, writeReportFiles };
