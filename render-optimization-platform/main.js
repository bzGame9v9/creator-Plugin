'use strict';

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { scanProject } = require('./core/scanner');
const { writeReport } = require('./core/report');
const { resolveProjectRoot } = require('../shared/project-runtime');

const PACKAGE_NAME = 'render-optimization-platform';
let activeSignal = null;
let lastReport = null;
let lastPanelReport = null;
let state = createState('idle');

function getProjectRoot() {
    return resolveProjectRoot();
}

function createState(status, overrides = {}) {
    return {
        status,
        progress: { phase: status, current: 0, total: 0, message: '' },
        report: lastPanelReport,
        error: '',
        exportResult: null,
        updatedAt: new Date().toISOString(),
        ...overrides,
    };
}

function emitState() {
    state.updatedAt = new Date().toISOString();
    if (global.Editor && Editor.Message) Editor.Message.send(PACKAGE_NAME, 'state-updated', state);
}

function updateState(next) {
    state = { ...state, ...next, updatedAt: new Date().toISOString() };
    emitState();
}

function reportDirectory() {
    return path.join(getProjectRoot(), 'build', 'render-optimization-reports');
}

function createPanelReport(report) {
    return {
        schemaVersion: report.schemaVersion,
        pluginVersion: report.pluginVersion,
        creatorVersion: report.creatorVersion,
        project: report.project,
        generatedAt: report.generatedAt,
        durationMs: report.durationMs,
        partial: report.partial,
        coverage: report.coverage,
        summary: report.summary,
        metrics: report.metrics,
        findings: report.findings,
        assets: report.assets.map(asset => ({
            uuid: asset.uuid,
            dbUrl: asset.dbUrl,
            relativePath: asset.relativePath,
            extension: asset.extension,
            importer: asset.importer,
            byteSize: asset.byteSize,
            texture: asset.texture,
            dependencies: asset.dependencies,
            parseStatus: asset.parseStatus,
            atlasPath: asset.atlasPath,
        })),
        renderDocuments: report.renderDocuments.map(document => ({
            assetUuid: document.assetUuid,
            path: document.path,
            dbUrl: document.dbUrl,
            kind: document.kind,
            nodeCount: document.nodeCount,
            maxDepth: document.maxDepth,
            componentCounts: document.componentCounts,
            estimatedBreaks: document.estimatedBreaks,
            renderTree: document.renderTree.slice(0, 20).map(textureGroup => ({
                textureKey: textureGroup.textureKey,
                materials: textureGroup.materials.slice(0, 12).map(materialGroup => ({
                    materialKey: materialGroup.materialKey,
                    blends: materialGroup.blends.slice(0, 8).map(blendGroup => ({
                        blendKey: blendGroup.blendKey,
                        renderers: blendGroup.renderers.slice(0, 10),
                    })),
                })),
            })),
        })),
        limitations: report.limitations,
    };
}

function openPath(target) {
    if (!target || !fs.existsSync(target)) return false;
    const opener = process.platform === 'win32' ? 'explorer' : process.platform === 'darwin' ? 'open' : 'xdg-open';
    const child = spawn(opener, [target], { detached: true, stdio: 'ignore', windowsHide: true });
    child.unref();
    return true;
}

async function openPanel() {
    await Editor.Panel.open(PACKAGE_NAME);
}

async function runProjectScan() {
    if (activeSignal) return state;
    activeSignal = { cancelled: false };
    state = createState('scanning', {
        progress: { phase: 'discover', current: 0, total: 0, message: 'Discovering assets' },
        report: lastPanelReport,
    });
    emitState();

    try {
        const report = await scanProject(getProjectRoot(), {
            signal: activeSignal,
            onProgress(progress) {
                updateState({ status: 'scanning', progress });
            },
        });
        lastReport = report;
        lastPanelReport = createPanelReport(report);
        const cacheDirectory = path.join(getProjectRoot(), 'temp', 'render-optimization-platform');
        const exportResult = await writeReport(report, cacheDirectory, { baseName: 'latest-render-report', markdown: false });
        state = createState('completed', {
            progress: { phase: 'complete', current: 1, total: 1, message: 'Scan complete' },
            report: lastPanelReport,
            exportResult,
        });
        console.log(`[${PACKAGE_NAME}] scan complete: ${report.summary.findingCount} finding(s), ${report.durationMs} ms`);
    } catch (error) {
        if (error && error.code === 'SCAN_CANCELLED') {
            state = createState('cancelled', {
                progress: { ...state.progress, message: 'Scan cancelled' },
                report: lastPanelReport,
            });
            console.log(`[${PACKAGE_NAME}] scan cancelled`);
        } else {
            const message = error && (error.stack || error.message) || String(error);
            state = createState('failed', {
                progress: { ...state.progress, message: 'Scan failed' },
                report: lastPanelReport,
                error: message,
            });
            console.error(`[${PACKAGE_NAME}] scan failed: ${message}`);
        }
    } finally {
        activeSignal = null;
        emitState();
    }
    return state;
}

async function exportLastReport() {
    if (!lastReport) throw new Error('No render optimization report is available. Run a scan first.');
    const result = await writeReport(lastReport, reportDirectory());
    updateState({ exportResult: result });
    console.log(`[${PACKAGE_NAME}] report exported: ${result.jsonPath}`);
    return result;
}

async function resolveUuid(input) {
    if (!input || !global.Editor || !Editor.Message) return '';
    const reportAsset = lastReport && lastReport.assets.find(asset => asset.relativePath === input || asset.dbUrl === input || asset.uuid === input);
    if (reportAsset && reportAsset.uuid) return reportAsset.uuid;
    if (String(input).startsWith('db://')) {
        try {
            return await Editor.Message.request('asset-db', 'query-uuid', input);
        } catch (error) {
            return '';
        }
    }
    return String(input);
}

exports.load = function load() {
    console.log(`[${PACKAGE_NAME}] loaded`);
};

exports.unload = function unload() {
    if (activeSignal) activeSignal.cancelled = true;
    activeSignal = null;
    console.log(`[${PACKAGE_NAME}] unloaded`);
};

exports.methods = {
    async openPanel() {
        await openPanel();
        return state;
    },

    async openHelp() {
        await Editor.Panel.open(`${PACKAGE_NAME}.help`);
    },

    async scanProject() {
        await openPanel();
        return runProjectScan();
    },

    cancelScan() {
        if (!activeSignal) return false;
        activeSignal.cancelled = true;
        updateState({ progress: { ...state.progress, message: 'Cancelling scan' } });
        return true;
    },

    exportLastReport,

    async openReportDirectory() {
        await fs.promises.mkdir(reportDirectory(), { recursive: true });
        return openPath(reportDirectory());
    },

    async openAsset(input) {
        const uuid = await resolveUuid(input);
        if (!uuid) return false;
        try {
            await Editor.Message.request('asset-db', 'open-asset', uuid);
            return true;
        } catch (error) {
            console.warn(`[${PACKAGE_NAME}] open asset failed: ${error && (error.message || error.stack) || error}`);
            return false;
        }
    },

    getState() {
        return state;
    },
};
