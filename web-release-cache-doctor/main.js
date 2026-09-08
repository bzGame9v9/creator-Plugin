'use strict';

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { diagnose, mergeBrowserReport } = require('./core/cache-doctor');
const { writeReport } = require('./core/report');
const { normalizeInputs, validateInputs } = require('./core/validation');
const { resolveProjectRoot } = require('../shared/project-runtime');

const PACKAGE_NAME = 'web-release-cache-doctor';
const REPORT_DIRECTORY = 'build/cache-doctor-reports';
const SETTINGS_FILE = '.dev/web-release-cache-doctor.json';
const ISSUE_TEXT = {
    build_mismatch: '本地构建不一致',
    zip_corrupt: 'ZIP 损坏',
    deploy_mismatch: '源站部署不一致',
    cdn_stale: 'CDN 返回旧版本',
    immutable_collision: '同一指纹对应不同内容',
    reference_split: 'HTML/Settings/Bundle 版本混用',
    service_worker_stale: 'Service Worker 过期',
    cache_storage_mismatch: 'CacheStorage 内容不一致',
    cache_header_error: '缓存响应头配置错误',
    missing_file: '关键文件缺失',
    diagnose_failed: '诊断执行失败',
};
let state = null;
let activeSignal = null;
let panelReady = false;
let startedAt = 0;

function projectRoot() {
    return resolveProjectRoot();
}

function reportDirectory() {
    return path.join(projectRoot(), REPORT_DIRECTORY);
}

function settingsPath() {
    return path.join(projectRoot(), SETTINGS_FILE);
}

function readSettings() {
    try { return JSON.parse(fs.readFileSync(settingsPath(), 'utf8')); } catch (error) { return {}; }
}

function writeSettings(settings) {
    const file = settingsPath();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(settings, null, 2), 'utf8');
}

function findLatestBuild() {
    const root = path.join(projectRoot(), 'build');
    if (!fs.existsSync(root)) return '';
    return fs.readdirSync(root, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && /^web-mobile(?:-.+)?$/i.test(entry.name))
        .map((entry) => {
            const directory = path.join(root, entry.name);
            const index = path.join(directory, 'index.html');
            return { directory, time: fs.existsSync(index) ? fs.statSync(index).mtimeMs : 0 };
        })
        .filter((entry) => entry.time > 0)
        .sort((left, right) => right.time - left.time)[0]?.directory || '';
}

function findZipForBuild(buildDirectory) {
    const buildRoot = path.join(projectRoot(), 'build');
    const outputName = buildDirectory ? path.basename(buildDirectory) : 'web-mobile';
    const candidates = [
        path.join(buildRoot, `${outputName}.zip`),
        path.join(buildRoot, 'web-mobile.zip'),
    ];
    return candidates.find((file) => fs.existsSync(file)) || '';
}

function defaults() {
    const saved = readSettings();
    const buildDirectory = saved.buildDirectory && fs.existsSync(saved.buildDirectory)
        ? saved.buildDirectory
        : findLatestBuild();
    return {
        publicUrl: saved.publicUrl || '',
        buildDirectory,
        zipPath: saved.zipPath && fs.existsSync(saved.zipPath) ? saved.zipPath : findZipForBuild(buildDirectory),
        originUrl: saved.originUrl || '',
        timeout: saved.timeout || 15000,
        concurrency: saved.concurrency || 4,
    };
}

function emitState() {
    if (!panelReady || !global.Editor || !Editor.Message) return;
    try {
        Editor.Message.send(PACKAGE_NAME, 'state-updated', state);
    } catch (error) {
        panelReady = false;
    }
}

function setState(status, values = {}) {
    state = { ...(state || {}), status, ...values, updatedAt: new Date().toISOString() };
    emitState();
}

function appendLog(entry) {
    const logs = Array.isArray(state && state.logs) ? state.logs.slice() : [];
    logs.push({ time: new Date().toISOString(), ...entry });
    if (logs.length > 300) logs.splice(0, logs.length - 300);
    state = { ...(state || {}), logs, lastActivityAt: new Date().toISOString() };
    emitState();
}

function appendFinalSummary(report, input) {
    const publicResponses = report && report.public && report.public.responses || [];
    const originResponses = report && report.origin && report.origin.responses || [];
    const responses = publicResponses.length ? publicResponses : originResponses;
    const mismatches = responses.filter((response) => response.mismatch).length;
    const missing = responses.filter((response) => response.status === 404).length;
    const allOk = responses.length > 0 && responses.every((response) => response.status === 200);
    const issueTexts = Array.from(new Set(report && report.issues || []));
    const issueMessage = issueTexts.length ? issueTexts.map((issue) => ISSUE_TEXT[issue] || issue).join('、') : '未发现';
    const sourceMessage = report && report.origin
        ? `已执行，源站文件 ${report.origin.ok ? '通过' : '存在问题'}`
        : '未执行，因为没有填写源站地址';
    const reportPaths = input && input.reportPaths
        ? Object.values(input.reportPaths).join(' | ')
        : '见报告目录';
    const summary = [
        '========== 诊断结果摘要 ==========',
        `本地 ZIP：${report && report.local && report.local.ok ? '通过' : '失败'}`,
        `公网文件：${report && report.public ? (report.public.ok ? '通过' : '存在问题') : '未执行'}`,
        `关键文件：${responses.length} 个${allOk ? '全部 200' : '存在异常'}`,
        `SHA-256 不一致：${mismatches}`,
        `404：${missing}`,
        `版本混用：${issueTexts.includes('reference_split') ? '发现' : '未发现'}`,
        `源站对比：${sourceMessage}`,
        `releaseId：${report && report.local && report.local.manifest && report.local.manifest.releaseId || '无'}`,
        `问题点：${issueMessage}`,
        `结论：${report && report.conclusion || '未生成结论'}`,
        `详细报告：${reportPaths}`,
        '====================================',
    ].join('\n');
    appendLog({ phase: report && report.mode === 'failed' ? '失败' : '完成', message: summary });
}

function failureReport(input, phase, error) {
    return {
        schemaVersion: 1,
        generatedAt: new Date().toISOString(),
        mode: 'failed',
        zipPath: input.zipPath,
        publicUrl: input.publicUrl,
        originUrl: input.originUrl,
        input,
        phase,
        error: String(error || ''),
        local: null,
        origin: null,
        public: null,
        issues: ['diagnose_failed'],
        severity: '高',
        conclusion: `诊断失败：${phase}；${error}`,
    };
}

function writeFailureReport(input, phase, error) {
    const report = failureReport(input, phase, error);
    const files = writeReport(report, reportDirectory());
    appendLog({ phase: '写入报告', message: '失败报告已写入', reportPaths: files });
    return { report, files };
}

function createSignal() {
    const listeners = [];
    return {
        cancelled: false,
        onCancel(listener) { listeners.push(listener); },
        cancel() {
            this.cancelled = true;
            listeners.splice(0).forEach((listener) => listener());
        },
    };
}

async function quickDiagnose(input = {}) {
    if (activeSignal) return state;
    const values = normalizeInputs({ ...defaults(), ...input }, projectRoot());
    writeSettings({ ...readSettings(), ...values });
    const validationErrors = validateInputs(values, { requirePublicUrl: true });
    if (Object.keys(validationErrors).length) {
        const firstError = Object.values(validationErrors)[0];
        appendLog({ phase: '校验输入', message: firstError, error: firstError });
        const failed = writeFailureReport(values, '校验输入', firstError);
        setState('失败', { input: values, validationErrors, report: failed.report, files: failed.files, history: listReports(), error: firstError });
        appendFinalSummary(failed.report, { reportPaths: failed.files });
        return state;
    }
    activeSignal = createSignal();
    startedAt = Date.now();
    setState('校验输入', {
        error: '',
        input: values,
        validationErrors: {},
        logs: [],
        progress: { phase: '校验输入', current: 0, total: 0, path: '' },
        startedAt,
        lastActivityAt: new Date().toISOString(),
    });
    appendLog({ phase: '校验输入', message: '输入校验通过' });
    try {
        setState('读取 ZIP', { progress: { phase: '读取 ZIP', current: 0, total: 0, path: '' } });
        const report = await diagnose({
            projectRoot: projectRoot(),
            zipPath: values.zipPath,
            publicUrl: values.publicUrl,
            originUrl: values.originUrl,
            timeout: values.timeout,
            concurrency: values.concurrency,
        }, {
            signal: activeSignal,
            onStage(stage) {
                setState(stage.phase, { progress: { phase: stage.phase, current: 0, total: 0, path: '' } });
                appendLog({ phase: stage.phase, message: stage.message });
            },
            onProgress(progress) {
                const response = progress.response || {};
                setState(progress.phase, {
                    progress: {
                        phase: progress.phase,
                        current: progress.current,
                        total: progress.total,
                        path: progress.path,
                    },
                });
                appendLog({
                    phase: progress.phase,
                    source: progress.label,
                    path: progress.path,
                    status: response.status,
                    bytes: response.bytes,
                    mismatch: response.mismatch,
                    error: response.error,
                    url: response.url,
                });
            },
        });
        const networkError = [report.origin, report.public].filter(Boolean).flatMap((layer) => layer.responses || []).find((response) => response.status === 0);
        if (networkError) {
            report.mode = 'failed';
            report.phase = networkError.path || report.publicUrl || report.originUrl;
            report.error = networkError.error || '网络请求失败';
            report.conclusion = `诊断失败：${report.error}`;
        }
        setState('写入报告', { progress: { phase: '写入报告', current: 0, total: 0, path: '' } });
        appendLog({ phase: '写入报告', message: '正在生成 JSON/Markdown/HTML' });
        const files = writeReport(report, reportDirectory());
        appendLog({ phase: '写入报告', message: '报告已写入', reportPaths: files });
        const elapsedMs = Date.now() - startedAt;
        const checked = [report.origin, report.public].filter(Boolean).reduce((sum, layer) => sum + (layer.responses || []).length, 0);
        setState(report.mode === 'failed' ? '失败' : '完成', {
            report,
            files,
            history: listReports(),
            elapsedMs,
            checked,
            progress: { phase: '完成', current: checked, total: checked, path: '' },
            error: report.error || '',
        });
        appendLog({ phase: report.mode === 'failed' ? '失败' : '完成', message: report.mode === 'failed'
            ? `诊断失败，已检查 ${checked} 个文件，耗时 ${elapsedMs} 毫秒`
            : `诊断完成，共检查 ${checked} 个文件，耗时 ${elapsedMs} 毫秒` });
        appendFinalSummary(report, { reportPaths: files });
    } catch (error) {
        const cancelled = error && error.code === 'DIAGNOSE_CANCELLED';
        const message = error && (error.stack || error.message) || String(error);
        const phase = state && state.status || '诊断';
        appendLog({ phase: cancelled ? '已取消' : phase, message, error: message });
        const failed = writeFailureReport(values, cancelled ? '已取消' : phase, message);
        setState(cancelled ? '已取消' : '失败', {
            report: failed.report,
            files: failed.files,
            history: listReports(),
            error: message,
            elapsedMs: Date.now() - startedAt,
        });
        appendFinalSummary(failed.report, { reportPaths: failed.files });
    } finally {
        activeSignal = null;
        emitState();
    }
    return state;
}

function stopDiagnose() {
    if (activeSignal) activeSignal.cancel();
    return state;
}

function listReports() {
    const directory = reportDirectory();
    if (!fs.existsSync(directory)) return [];
    return fs.readdirSync(directory)
        .filter((name) => /\.(json|md|html)$/i.test(name))
        .map((name) => ({ name, path: path.join(directory, name), time: fs.statSync(path.join(directory, name)).mtimeMs }))
        .sort((left, right) => right.time - left.time);
}

function openPath(target) {
    if (!target || !fs.existsSync(target)) return false;
    const opener = process.platform === 'win32' ? 'explorer' : process.platform === 'darwin' ? 'open' : 'xdg-open';
    const child = execFile(opener, [target], { windowsHide: true });
    child.unref();
    return true;
}

function safeReportPath(name) {
    const base = path.basename(String(name || ''));
    const target = path.join(reportDirectory(), base);
    return target.startsWith(reportDirectory()) ? target : '';
}

function compareReports(input) {
    const leftPath = safeReportPath(input && input.left);
    const rightPath = safeReportPath(input && input.right);
    if (!leftPath || !rightPath || !fs.existsSync(leftPath) || !fs.existsSync(rightPath)) {
        throw new Error('请选择报告目录中存在的两个 JSON 报告。');
    }
    const left = JSON.parse(fs.readFileSync(leftPath, 'utf8'));
    const right = JSON.parse(fs.readFileSync(rightPath, 'utf8'));
    const leftManifest = left.local && left.local.manifest || {};
    const rightManifest = right.local && right.local.manifest || {};
    const differences = [];
    if (leftManifest.releaseId !== rightManifest.releaseId) differences.push(`releaseId: ${leftManifest.releaseId || '无'} -> ${rightManifest.releaseId || '无'}`);
    const leftBundles = Object.fromEntries((leftManifest.bundles || []).map((bundle) => [bundle.bundle, bundle.bundleVersion]));
    const rightBundles = Object.fromEntries((rightManifest.bundles || []).map((bundle) => [bundle.bundle, bundle.bundleVersion]));
    new Set([...Object.keys(leftBundles), ...Object.keys(rightBundles)]).forEach((bundle) => {
        if (leftBundles[bundle] !== rightBundles[bundle]) differences.push(`${bundle}: ${leftBundles[bundle] || '无'} -> ${rightBundles[bundle] || '无'}`);
    });
    return { left: path.basename(leftPath), right: path.basename(rightPath), differences };
}

function browserScriptPath() {
    return path.join(projectRoot(), 'tools', 'browser-cache-doctor.js');
}

function copyBrowserScript() {
    const source = fs.readFileSync(browserScriptPath(), 'utf8');
    if (process.platform !== 'win32') return { copied: false, script: source };
    const child = execFile('clip.exe', [], { windowsHide: true });
    child.stdin.end(source, 'utf8');
    return { copied: true, script: source };
}

function exportLogs() {
    const file = path.join(reportDirectory(), 'latest.log.txt');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, (state && state.logs || []).map((entry) => JSON.stringify(entry)).join('\n') + '\n', 'utf8');
    return file;
}

function loadBrowserReport(input) {
    let report = input;
    if (typeof input === 'string') report = JSON.parse(input);
    if (!report || typeof report !== 'object') throw new Error('浏览器诊断 JSON 无效');
    const mergedReport = state && state.report ? mergeBrowserReport(state.report, report) : state && state.report;
    setState('浏览器报告已导入', { browserReport: report, report: mergedReport || state && state.report });
    return state;
}

exports.load = function load() {
    state = { status: '就绪', defaults: defaults(), history: listReports(), browserScript: browserScriptPath() };
};

exports.unload = function unload() {
    panelReady = false;
    stopDiagnose();
};

exports.methods = {
    async openPanel() { await Editor.Panel.open(PACKAGE_NAME); return state; },
    panelReady() { panelReady = true; emitState(); return state; },
    quickDiagnose,
    stopDiagnose,
    async openLatestReport() { const latest = path.join(reportDirectory(), 'latest.html'); openPath(latest); return latest; },
    async openReportDirectory() { fs.mkdirSync(reportDirectory(), { recursive: true }); openPath(reportDirectory()); return reportDirectory(); },
    async openReport(name) { const target = safeReportPath(name); if (!target) throw new Error('报告路径无效。'); openPath(target); return target; },
    compareReports,
    async getState() { if (!state) exports.load(); return state; },
    saveSettings(values) { writeSettings({ ...readSettings(), ...values }); state = { ...(state || {}), defaults: defaults() }; emitState(); return state; },
    exportLogs,
    clearLogs() { state = { ...(state || {}), logs: [] }; emitState(); return state; },
    loadBrowserReport,
    copyBrowserScript,
};
