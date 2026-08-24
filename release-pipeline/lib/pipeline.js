'use strict';

const cleanBackup = require('./tasks/clean-backup');
const obfuscateJs = require('./tasks/obfuscate-js');
const fingerprintBuild = require('./tasks/fingerprint-build');
const zipBuild = require('./tasks/zip-build');
const writeReport = require('./tasks/write-report');

const TASKS = {
    cleanBackup,
    obfuscateJs,
    fingerprintBuild,
    zipBuild,
    writeReport,
};

async function runPipeline(context) {
    const config = context.config || {};
    if (config.enabled === false) {
        context.logger.info('pipeline disabled by config');
        return context.report;
    }

    if (Array.isArray(config.platforms) && config.platforms.length && !config.platforms.includes(context.platform)) {
        context.logger.info(`platform skipped: ${context.platform}`);
        return context.report;
    }

    const tasks = ensureFingerprintTask(Array.isArray(config.tasks) ? config.tasks : []);
    context.logger.info(`start ${context.platform} pipeline at ${context.buildRoot}`);

    for (const entry of tasks) {
        const taskConfig = normalizeTask(entry);
        if (!taskConfig.enabled) {
            context.logger.info(`skip disabled task: ${taskConfig.name}`);
            continue;
        }

        const task = TASKS[taskConfig.name];
        if (!task) {
            const message = `unknown task: ${taskConfig.name}`;
            context.report.warnings.push(message);
            context.logger.warn(message);
            continue;
        }

        const taskReport = {
            name: taskConfig.name,
            startedAt: new Date().toISOString(),
            status: 'running',
        };
        context.report.tasks.push(taskReport);
        context.logger.info(`run task: ${taskConfig.name}`);

        try {
            const result = await task.run(context, taskConfig.options || {});
            taskReport.status = 'success';
            taskReport.finishedAt = new Date().toISOString();
            taskReport.result = result || {};
        } catch (error) {
            taskReport.status = 'failed';
            taskReport.finishedAt = new Date().toISOString();
            taskReport.error = error && (error.stack || error.message) || String(error);
            throw error;
        }
    }

    context.report.finishedAt = new Date().toISOString();
    writeFinalReportIfConfigured(context);
    context.logger.info('pipeline finished');
    return context.report;
}

function ensureFingerprintTask(entries) {
    const normalized = entries.map(normalizeTask);
    const output = [];

    normalized.forEach((entry, index) => {
        if (entry.name === 'fingerprintBuild') {
            output.push(entry);
            return;
        }

        const hasLaterFingerprint = normalized.slice(index + 1).some((item) => {
            return item.name === 'fingerprintBuild' && item.enabled !== false;
        });
        if (entry.name === 'zipBuild' && entry.enabled !== false && !hasEnabledFingerprint(output) && !hasLaterFingerprint) {
            output.push({ name: 'fingerprintBuild', enabled: true, options: { automatic: true } });
        }
        output.push(entry);

        if (entry.name === 'obfuscateJs' && entry.enabled !== false && !hasEnabledFingerprint(output) && !hasLaterFingerprint) {
            output.push({ name: 'fingerprintBuild', enabled: true, options: { automatic: true } });
        }
    });

    return output;
}

function hasEnabledFingerprint(entries) {
    return entries.some((entry) => entry.name === 'fingerprintBuild' && entry.enabled !== false);
}

function writeFinalReportIfConfigured(context) {
    const reportTask = context.report.tasks.find((task) => {
        return task.name === 'writeReport' && task.status === 'success' && task.result && !task.result.skipped;
    });

    if (!reportTask || typeof writeReport.writeReportFiles !== 'function') {
        return;
    }

    writeReport.writeReportFiles(context, reportTask.result);
}

function normalizeTask(entry) {
    if (typeof entry === 'string') {
        return { name: entry, enabled: true, options: {} };
    }
    return {
        name: entry.name,
        enabled: entry.enabled !== false,
        options: entry.options || {},
    };
}

module.exports = {
    runPipeline,
    TASKS,
};
