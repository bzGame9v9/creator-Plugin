'use strict';

const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');
const {
    MANIFEST_FILE,
    calculateReleaseId,
    canonicalZipPayloadSha256,
    sha256,
} = require('../../release-pipeline/lib/release-integrity');

const DEFAULT_TIMEOUT = 15000;
const DEFAULT_CONCURRENCY = 4;

async function diagnose(options, hooks = {}) {
    const timeout = Number(options.timeout || DEFAULT_TIMEOUT);
    const concurrency = Math.max(1, Math.min(16, Number(options.concurrency || DEFAULT_CONCURRENCY)));
    const issues = [];
    const zipPath = path.resolve(options.zipPath || '');
    notifyStage(hooks, '读取 ZIP', `正在读取 ZIP：${zipPath}`);
    const local = inspectZip(zipPath, issues);
    const publicBase = normalizeBaseUrl(options.publicUrl || options.url || '');
    const originBase = options.originUrl ? normalizeBaseUrl(options.originUrl) : null;
    const report = {
        schemaVersion: 1,
        generatedAt: new Date().toISOString(),
        zipPath,
        publicUrl: publicBase ? publicBase.origin : '',
        originUrl: originBase ? originBase.origin : '',
        timeout,
        concurrency,
        local,
        origin: null,
        public: null,
        browser: options.browserReport || null,
        issues,
        severity: '提示',
        conclusion: '',
    };
    if (!local.ok) {
        report.severity = severityForIssues(issues);
        report.conclusion = classifyConclusion(issues);
        return report;
    }

    if (!publicBase && !originBase) {
        report.mode = 'local-only';
        report.conclusion = '本地 ZIP 检查完成，未执行公网诊断。';
        notifyStage(hooks, '分析结果', report.conclusion);
        return report;
    }

    if (originBase) notifyStage(hooks, '源站检查', '正在请求源站关键文件');
    report.origin = originBase
        ? await inspectPublication('源站', originBase, local, { timeout, concurrency, criticalOnly: Boolean(options.criticalOnly) }, hooks)
        : null;
    if (publicBase) notifyStage(hooks, '公网检查', '正在请求 CDN 公网关键文件');
    report.public = publicBase
        ? await inspectPublication('CDN 公网', publicBase, local, { timeout, concurrency, criticalOnly: Boolean(options.criticalOnly) }, hooks)
        : null;
    notifyStage(hooks, '分析结果', '正在比较 SHA-256 和引用链');
    classifyComparison(report, issues);
    report.severity = severityForIssues(issues);
    report.conclusion = classifyConclusion(issues, report.public);
    return report;
}

function mergeBrowserReport(report, browserReport) {
    const merged = { ...report, browser: browserReport };
    const browserIssues = new Set(['browser_check_required', 'service_worker_stale', 'cache_storage_mismatch']);
    const issues = (report.issues || []).filter((issue) => !browserIssues.has(issue));
    merged.issues = issues;
    classifyComparison(merged, merged.issues);
    merged.severity = severityForIssues(merged.issues);
    merged.conclusion = classifyConclusion(merged.issues, merged.public);
    return merged;
}

function inspectZip(zipPath, issues) {
    if (!zipPath || !fs.existsSync(zipPath)) {
        issues.push('zip_corrupt');
        issues.push('missing_file');
        issues.push('build_mismatch');
        return { ok: false, path: zipPath, files: [], bundles: [], manifest: null };
    }
    let zip;
    try {
        zip = new AdmZip(zipPath);
    } catch (error) {
        issues.push('zip_corrupt');
        issues.push('build_mismatch');
        return { ok: false, path: zipPath, files: [], bundles: [], manifest: null, error: error.message };
    }
    const manifestEntry = zip.getEntries().find((entry) => {
        return path.posix.basename(entry.entryName.replace(/\\/g, '/')) === MANIFEST_FILE;
    });
    if (!manifestEntry) {
        issues.push('zip_corrupt');
        issues.push('missing_file');
        issues.push('build_mismatch');
        return { ok: false, path: zipPath, files: [], bundles: [], manifest: null };
    }
    let manifest;
    try {
        manifest = JSON.parse(manifestEntry.getData().toString('utf8'));
    } catch (error) {
        issues.push('zip_corrupt');
        issues.push('build_mismatch');
        return { ok: false, path: zipPath, files: [], bundles: [], manifest: null, error: error.message };
    }
    const root = path.posix.dirname(manifestEntry.entryName.replace(/\\/g, '/'));
    const files = [];
    for (const expected of manifest.files || []) {
        const entry = zip.getEntry(joinZipPath(root, expected.path));
        if (!entry) {
            issues.push('missing_file');
            files.push({ path: expected.path, status: 404, expectedSha256: expected.sha256 });
            continue;
        }
        const data = entry.getData();
        const actual = {
            path: expected.path,
            status: 200,
            bytes: data.length,
            sha256: sha256(data),
            expectedBytes: expected.bytes,
            expectedSha256: expected.sha256,
        };
        files.push(actual);
        if (actual.bytes !== expected.bytes || actual.sha256 !== expected.sha256) issues.push('build_mismatch');
    }
    const expectedReleaseId = calculateReleaseId(manifest);
    if (expectedReleaseId !== manifest.releaseId) issues.push('build_mismatch');
    const payloadSha256 = canonicalZipPayloadSha256(zip);
    if (manifest.zipSha256 !== payloadSha256) issues.push('build_mismatch');
    (manifest.bundles || []).forEach((bundle) => {
        const index = files.find((file) => file.path === bundle.index && file.sha256 === bundle.indexSha256);
        const config = files.find((file) => file.path === bundle.config && file.sha256 === bundle.configSha256);
        if (!index || !config) issues.push('build_mismatch');
    });
    return {
        ok: issues.length === 0,
        path: zipPath,
        root,
        manifest,
        files,
        bundles: manifest.bundles || [],
        zipPayloadSha256: payloadSha256,
    };
}

async function inspectPublication(label, baseUrl, local, options, hooks) {
    const paths = collectCriticalPaths(local);
    const responses = [];
    const bodyByPath = new Map();
    const queue = paths.slice();
    let completed = 0;
    const worker = async () => {
        while (queue.length) {
            checkCancelled(hooks);
            const relative = queue.shift();
            const result = await fetchResource(baseUrl, relative, options.timeout, hooks);
            const row = toResponseRow(baseUrl, relative, result, local);
            responses.push(row);
            if (result.body) bodyByPath.set(relative, result.body.toString('utf8'));
            completed += 1;
            if (hooks.onProgress) hooks.onProgress({
                phase: label === '源站' ? '源站检查' : '公网检查',
                label,
                current: completed,
                total: paths.length,
                path: relative,
                response: row,
            });
        }
    };
    await Promise.all(Array.from({ length: Math.min(options.concurrency, paths.length) }, worker));

    const settingsPath = local.manifest.entry && local.manifest.entry.settings;
    const settings = parseJson(bodyByPath.get(settingsPath));
    const manifest = parseJson(bodyByPath.get(MANIFEST_FILE));
    const runtimePaths = settings ? bundlePathsFromSettings(settings) : [];
    for (const relative of runtimePaths) {
        if (responses.some((response) => response.path === relative)) continue;
        checkCancelled(hooks);
        const result = await fetchResource(baseUrl, relative, options.timeout, hooks);
        const row = toResponseRow(baseUrl, relative, result, local);
        responses.push(row);
        if (hooks.onProgress) hooks.onProgress({
            phase: label === '源站' ? '源站检查' : '公网检查',
            label,
            current: responses.length,
            total: paths.length + runtimePaths.length,
            path: relative,
            response: row,
        });
    }
    return {
        label,
        baseUrl: baseUrl.origin,
        ok: responses.every((response) => response.status >= 200 && response.status < 400)
            && responses.every((response) => !response.mismatch),
        responses: (options.criticalOnly ? responses.filter((response) => isCriticalPath(response.path)) : responses)
            .sort((left, right) => left.path.localeCompare(right.path)),
        manifest,
        settings,
        browserCacheHint: false,
    };
}

function toResponseRow(baseUrl, relative, result, local) {
    const expected = local.files.find((file) => file.path === relative);
    const row = {
        path: relative,
        url: safeUrl(baseUrl, relative),
        status: result.status,
        bytes: result.bytes,
        sha256: result.body ? sha256(result.body) : '',
        cacheControl: result.headers['cache-control'] || '',
        etag: result.headers.etag || '',
        age: result.headers.age || '',
        cfCacheStatus: result.headers['cf-cache-status'] || '',
        lastModified: result.headers['last-modified'] || '',
        error: result.error || '',
        expectedSha256: expected && expected.expectedSha256 || '',
        mismatch: Boolean(expected && result.status === 200 && sha256(result.body) !== expected.expectedSha256),
    };
    return row;
}

async function fetchResource(baseUrl, relative, timeout, hooks) {
    if (relative.includes('/api/')) return { status: 0, bytes: 0, body: null, headers: {}, error: 'API path is excluded' };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    const onCancel = () => controller.abort();
    if (hooks.signal && typeof hooks.signal.onCancel === 'function') hooks.signal.onCancel(onCancel);
    try {
        const response = await fetch(new URL(relative, baseUrl), {
            cache: 'no-store',
            signal: controller.signal,
        });
        const body = Buffer.from(await response.arrayBuffer());
        const headers = {};
        response.headers.forEach((value, key) => { headers[key] = value; });
        return { status: response.status, bytes: body.length, body, headers };
    } catch (error) {
        return { status: 0, bytes: 0, body: null, headers: {}, error: error.message };
    } finally {
        clearTimeout(timer);
    }
}

function collectCriticalPaths(local) {
    const paths = new Set([MANIFEST_FILE, 'index.html']);
    const entry = local.manifest.entry || {};
    Object.values(entry).filter(Boolean).forEach((relative) => paths.add(relative));
    (local.manifest.bundles || []).forEach((bundle) => {
        paths.add(bundle.index);
        paths.add(bundle.config);
    });
    return Array.from(paths).sort();
}

function bundlePathsFromSettings(settings) {
    const versions = settings && settings.assets && settings.assets.bundleVers || {};
    return Object.keys(versions).flatMap((bundle) => [
        `assets/${bundle}/index.${versions[bundle]}.js`,
        `assets/${bundle}/config.${versions[bundle]}.json`,
    ]);
}

function classifyComparison(report, issues) {
    const origin = report.origin;
    const publicReport = report.public;
    if (origin && !origin.ok) issues.push('deploy_mismatch');
    if (origin && origin.ok && publicReport && !publicReport.ok) issues.push('cdn_stale');
    if (!origin && publicReport && !publicReport.ok) issues.push('deploy_mismatch');
    [origin, publicReport].filter(Boolean).forEach((layer) => {
        if (layer.manifest && report.local.manifest && layer.manifest.releaseId !== report.local.manifest.releaseId) {
            issues.push('reference_split');
        }
        layer.responses.forEach((response) => {
            if (response.status === 404) issues.push('missing_file');
            if (response.mismatch && isContentAddressed(response.path)) issues.push('immutable_collision');
            if (isEntryOrWorker(response.path) && /\bimmutable\b/i.test(response.cacheControl)) issues.push('cache_header_error');
        });
    });
    if (report.browser) {
        const activeWorkers = report.browser.registrations || [];
        const hasCurrentCache = (report.browser.cacheStorage || []).some((cache) => /cocos-pwa-cache-v5/i.test(cache.name || ''));
        if (activeWorkers.some((registration) => registration.active) && !hasCurrentCache) {
            issues.push('service_worker_stale');
        }
        (report.browser.cacheStorage || []).forEach((cache) => {
            (cache.criticalEntries || []).forEach((entry) => {
                const relative = safeRelativePath(entry.url);
                const expected = report.local.files.find((file) => file.path === relative);
                if (expected && entry.sha256 && entry.sha256 !== expected.expectedSha256) issues.push('cache_storage_mismatch');
            });
        });
    } else if (!issues.length && publicReport && publicReport.ok) {
        issues.push('browser_check_required');
    }
}

function classifyConclusion(issues, publicReport) {
    const unique = Array.from(new Set(issues));
    if (unique.includes('zip_corrupt')) return 'ZIP 损坏：缺少发布清单或关键内容无法读取。';
    if (unique.includes('build_mismatch')) return '本地构建不一致：请重新执行构建、混淆、指纹和 ZIP。';
    if (unique.includes('immutable_collision')) return '同一指纹对应不同内容：禁止继续发布，检查 Bundle 组合指纹和缓存。';
    if (unique.includes('deploy_mismatch')) return '源站部署不一致：检查上传、解压和站点目录切换。';
    if (unique.includes('cdn_stale')) return 'CDN 返回旧版本：检查 Cloudflare 缓存规则和源站响应头。';
    if (unique.includes('reference_split')) return 'HTML、Settings、Bundle 版本混用：重新生成完整发布包。';
    if (unique.includes('service_worker_stale')) return 'Service Worker 过期：浏览器仍由旧 Worker 控制。';
    if (unique.includes('cache_storage_mismatch')) return 'CacheStorage 内容不一致：浏览器缓存不是当前发布版本。';
    if (unique.includes('cache_header_error')) return '缓存响应头配置错误：入口和 Worker 不能使用 immutable。';
    if (unique.includes('missing_file')) return '关键文件缺失或返回 404。';
    if (unique.includes('browser_check_required')) return '公网文件一致，需要浏览器侧检查 Service Worker 和 CacheStorage。';
    if (publicReport && publicReport.ok) return '全部通过。';
    return '诊断未完成：请检查输入地址和 ZIP。';
}

function severityForIssues(issues) {
    const unique = new Set(issues);
    if (unique.has('zip_corrupt') || unique.has('build_mismatch') || unique.has('immutable_collision')) return '严重';
    if (unique.has('deploy_mismatch') || unique.has('cdn_stale') || unique.has('reference_split')) return '高';
    if (unique.has('service_worker_stale') || unique.has('cache_storage_mismatch') || unique.has('missing_file') || unique.has('cache_header_error')) return '中';
    return '提示';
}

function normalizeBaseUrl(value) {
    if (!value) return null;
    const url = new URL(value);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error(`不支持的地址协议：${value}`);
    url.search = '';
    url.hash = '';
    if (!url.pathname.endsWith('/')) url.pathname += '/';
    return url;
}

function safeUrl(baseUrl, relative) {
    const url = new URL(relative, baseUrl);
    url.search = '';
    url.hash = '';
    return url.origin + url.pathname;
}

function safeRelativePath(value) {
    try {
        const url = new URL(value);
        return url.pathname.replace(/^\/+/, '');
    } catch (error) {
        return String(value || '').replace(/^\/+/, '').split('?')[0];
    }
}

function joinZipPath(root, relative) {
    return path.posix.normalize(`${root}/${relative}`).replace(/^\.\//, '');
}

function parseJson(value) {
    if (!value) return null;
    try { return JSON.parse(value); } catch (error) { return null; }
}

function isEntryOrWorker(relative) {
    return relative === 'index.html'
        || relative === MANIFEST_FILE
        || /^firebase-messaging-sw(?:\.|$)/i.test(relative)
        || /^src\/(?:settings|import-map)/i.test(relative);
}

function isContentAddressed(relative) {
    return /\.[a-f0-9]{5,32}\.(?:js|json|css|wasm)$/i.test(relative);
}

function isCriticalPath(relative) {
    return relative === 'index.html'
        || relative === MANIFEST_FILE
        || /^index\./i.test(relative)
        || /^application\./i.test(relative)
        || /^firebase-messaging-sw/i.test(relative)
        || /^src\/(?:settings|import-map)/i.test(relative)
        || /^assets\/[^/]+\/(?:index|config)\./i.test(relative);
}

function checkCancelled(hooks) {
    if (hooks.signal && hooks.signal.cancelled) {
        const error = new Error('诊断已取消');
        error.code = 'DIAGNOSE_CANCELLED';
        throw error;
    }
}

function notifyStage(hooks, phase, message) {
    if (hooks.onStage) hooks.onStage({ phase, message, at: new Date().toISOString() });
}

module.exports = {
    DEFAULT_CONCURRENCY,
    DEFAULT_TIMEOUT,
    diagnose,
    mergeBrowserReport,
    inspectZip,
    normalizeBaseUrl,
};
