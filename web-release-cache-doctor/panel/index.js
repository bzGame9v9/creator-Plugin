'use strict';

const PACKAGE_NAME = 'web-release-cache-doctor';
const { normalizeInputs, validateInputs } = require('../core/validation');
let currentState = null;
let activeTab = 'quick';
let helpFilter = '';
let formInitialized = false;
let formDirty = false;

const ISSUE_TEXT = {
    build_mismatch: '本地构建不一致',
    zip_corrupt: 'ZIP 损坏',
    deploy_mismatch: '源站部署不一致',
    cdn_stale: 'CDN 返回旧版本',
    immutable_collision: '同一指纹对应不同内容',
    reference_split: 'HTML/Settings/Bundle 版本混用',
    service_worker_stale: 'Service Worker 过期',
    cache_storage_mismatch: 'CacheStorage 内容不一致',
    browser_check_required: '需要浏览器侧检查',
    cache_header_error: '缓存响应头配置错误',
    missing_file: '关键文件缺失',
};

const HELP_SECTIONS = [
    ['插件用途', 'Web 发布诊断中心用于对比本地发布 ZIP、源站和 CDN 公网响应，定位指纹、上传、引用链、HTTP 缓存、Service Worker 和 CacheStorage 问题。默认只读，不注销 Worker、不删除缓存、不执行 Cloudflare purge。'],
    ['快速诊断与完整诊断', '快速诊断读取 ZIP 清单并请求启动关键文件，适合发布后第一轮检查。完整诊断仍需补充源站地址、浏览器只读诊断 JSON 和关键资源逐项对比；诊断参数不会改变正式资源 URL。'],
    ['输入项填写', '游戏地址填写玩家实际访问的 HTTPS 地址，例如 https://h5test.dudle.shop；构建目录选择 build/web-mobile；ZIP 必须来自同一构建目录；源站地址只有在能绕过 CDN 访问源站时填写；超时和并发保持默认即可。'],
    ['正确使用流程', '先运行 release:web:all 生成新 ZIP，再用本面板或 CLI 诊断本地 ZIP；手动部署完整 ZIP 后重新诊断公网；最后在已有旧 Worker/CacheStorage 的浏览器普通刷新，并导入浏览器只读 JSON。'],
    ['问题分类', '本地构建不一致表示 ZIP 清单或文件自身错误；源站部署不一致表示上传、解压或目录切换错误；CDN 返回旧版本表示源站正确但边缘缓存错误；同一指纹对应不同内容表示严重的内容寻址碰撞；版本混用表示 HTML、settings 或 Bundle config 来自不同发布。'],
    ['四层判断', 'ZIP 错先修打包插件；ZIP 对而源站错先修上传和解压；源站对而 CDN 错先修 Cloudflare 和响应头；公网全部正确但浏览器旧，检查 Service Worker、CacheStorage 和 HTTP Cache。'],
    ['浏览器诊断脚本', '点击“复制浏览器只读脚本”，在游戏页面控制台执行，把输出的 JSON 粘贴到“浏览器缓存”页导入。脚本只读取当前页面、公开 manifest、Service Worker 注册和 cocos-pwa-cache-*，不读取 Cookie、localStorage、IndexedDB、Token、API 响应或用户数据。'],
    ['恢复脚本边界', 'browser-cache-doctor-fix.js 是独立事故恢复脚本，执行前会确认，只注销当前站点 Worker 并删除 cocos-pwa-cache-*，不会清理登录态。它不能代替正确的组合指纹、缓存响应头和发布目录切换。'],
    ['Cloudflare 与浏览器缓存', 'Cloudflare purge 只能清边缘缓存，不能删除玩家浏览器 HTTP Cache、Service Worker 或 CacheStorage。purge 成功后仍必须重新请求公网文件并核对 SHA-256。'],
    ['诊断参数', 'debug=1 或时间戳只能用于诊断采样，不能作为玩家获取新版本的正式方案。正式修复必须让最终字节变化生成新 URL，并让入口 HTML、Worker 和启动元数据可重新验证。'],
    ['导出报告', '诊断完成后报告写入 build/cache-doctor-reports，包含 latest.json、latest.md、latest.html。将 JSON、Markdown 或 HTML 一并交给开发人员，报告不包含 Cloudflare Token、Cookie 或 API 数据。'],
    ['安全边界', '网络请求只访问填写的游戏地址和可选源站地址，不访问 /api/；URL 查询参数会被去掉后再记录；清理、purge、删除报告均不由快速诊断执行。'],
    ['发布与回滚清单', '发布前确认 build/web-mobile.zip、release-integrity-manifest.json、四个 Bundle 的 index/config 和 settings 版本一致；发布后确认入口 no-cache、内容指纹资源 immutable；回滚恢复上一份完整 ZIP，不把新内容写回旧 hash URL。'],
];

function escapeHtml(value) {
    return String(value == null ? '' : value)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function issueText(issues) {
    return Array.from(new Set(issues || [])).map((issue) => ISSUE_TEXT[issue] || issue).join('、') || '全部通过';
}

function statusText(state) {
    return state && state.status || '就绪';
}

function valueOf(element) {
    return element && (element.value || element.getAttribute('value') || '');
}

function reportRows(report) {
    const rows = [];
    [report && report.origin, report && report.public].filter(Boolean).forEach((layer) => {
        (layer.responses || []).forEach((row) => rows.push({ layer: layer.label, ...row }));
    });
    return rows;
}

exports.template = /* html */ `
<div class="wrap">
  <header class="header">
    <div><h1>Web 发布诊断中心</h1><div id="status" class="status">就绪</div></div>
    <div class="header-actions"><ui-button id="openLatest">打开最新报告</ui-button><ui-button id="openReportDirectory">打开报告目录</ui-button><ui-button id="stop" disabled>停止诊断</ui-button></div>
  </header>
  <nav id="tabBar" class="tabs">
    <button class="tab active" data-tab="quick">快速诊断</button>
    <button class="tab" data-tab="files">文件对比</button>
    <button class="tab" data-tab="chain">引用链</button>
    <button class="tab" data-tab="browser">浏览器缓存</button>
    <button class="tab" data-tab="history">历史报告</button>
    <button class="tab" data-tab="help">使用帮助</button>
  </nav>
  <main id="pages">
    <section id="quick" class="page active">
      <div class="form-grid">
        <label>游戏地址<input id="publicUrl" type="url" placeholder="https://h5test.dudle.shop"></label>
        <label>本地构建目录<input id="buildDirectory" type="text" placeholder="build/web-mobile"></label>
        <label>本地发布 ZIP<input id="zipPath" type="text" placeholder="build/web-mobile.zip"></label>
        <label>可选源站地址<input id="originUrl" type="url" placeholder="可留空"></label>
        <label>请求超时（毫秒）<input id="timeout" type="number" min="1000" step="1000"></label>
        <label>并发数<input id="concurrency" type="number" min="1" max="16"></label>
      </div>
      <div class="actions"><ui-button id="start" class="primary">开始快速诊断</ui-button></div>
      <div id="progress" class="notice">等待输入。</div>
      <div id="conclusion" class="conclusion">尚未诊断</div>
      <div id="validation" class="validation"></div>
      <div class="log-toolbar"><strong>执行日志</strong><ui-button id="copyLogs">复制日志</ui-button><ui-button id="clearLogs">清空日志</ui-button><ui-button id="exportLogs">导出日志</ui-button></div>
      <pre id="logOutput" class="log-output">暂无日志。</pre>
      <div id="reportPaths" class="report-paths">尚未生成报告。</div>
      <pre id="error" class="error"></pre>
    </section>
    <section id="files" class="page">
      <div id="fileSummary" class="notice">完成诊断后显示 ZIP、源站和 CDN 文件对比。</div>
      <div class="table-wrap"><table><thead><tr><th>层级</th><th>文件</th><th>HTTP</th><th>大小</th><th>SHA-256</th><th>Cache-Control</th><th>ETag</th><th>Age</th><th>CF-Cache-Status</th><th>问题类型</th></tr></thead><tbody id="fileRows"></tbody></table></div>
    </section>
    <section id="chain" class="page"><pre id="chainText" class="chain">完成诊断后显示引用链。</pre></section>
    <section id="browser" class="page">
      <div class="notice">只读诊断不会修改浏览器状态。复制脚本后，在游戏页面控制台执行，再把 JSON 导入这里。</div>
      <div class="actions"><ui-button id="copyScript">复制浏览器只读诊断脚本</ui-button><ui-button id="importBrowser">导入浏览器 JSON</ui-button></div>
      <textarea id="browserJson" class="browser-json" placeholder="粘贴 browser-cache-doctor.js 输出的 JSON"></textarea>
      <pre id="browserSummary" class="chain">尚未导入浏览器报告。</pre>
    </section>
    <section id="history" class="page"><div class="history-tools"><input id="historyLeft" type="text" placeholder="左侧 JSON 报告文件名"><input id="historyRight" type="text" placeholder="右侧 JSON 报告文件名"><ui-button id="compareHistory">对比两个报告</ui-button></div><pre id="historyCompare" class="chain">请选择两个 JSON 报告进行对比。</pre><div id="historyRows" class="history">没有诊断报告。</div></section>
    <section id="help" class="page"><input id="helpSearch" class="help-search" type="search" placeholder="搜索帮助内容"><div id="helpContent" class="help-content"></div></section>
  </main>
</div>
`;

exports.style = /* css */ `
:host{display:flex;min-width:0;min-height:0;color:var(--color-normal-contrast);background:var(--color-normal-fill)}
.wrap{display:flex;flex:1;min-width:0;min-height:0;flex-direction:column;font-size:13px}
.header{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:14px 18px;border-bottom:1px solid rgba(255,255,255,.1)}
h1{margin:0;font-size:17px;letter-spacing:0}.status{margin-top:4px;color:rgba(255,255,255,.65)}
.header-actions,.actions{display:flex;align-items:center;flex-wrap:wrap;gap:8px}.tabs{display:flex;gap:2px;overflow:auto;padding:0 12px;border-bottom:1px solid rgba(255,255,255,.1)}
.tab{flex:0 0 auto;padding:10px 12px;border:0;border-bottom:2px solid transparent;color:rgba(255,255,255,.66);background:transparent;cursor:pointer}.tab.active{color:#fff;border-bottom-color:#55a9d1}
main{min-width:0;min-height:0;flex:1;overflow:hidden}.page{display:none;min-width:0;height:100%;box-sizing:border-box;overflow:auto;padding:18px}.page.active{display:block}
.form-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px 16px;max-width:920px}.form-grid label{display:flex;min-width:0;flex-direction:column;gap:6px;color:rgba(255,255,255,.72)}
input,textarea{box-sizing:border-box;width:100%;border:1px solid rgba(255,255,255,.16);border-radius:3px;outline:0;color:inherit;background:rgba(0,0,0,.18)}input{height:30px;padding:0 9px}textarea{min-height:260px;padding:10px;font:12px/1.55 Consolas,"Courier New",monospace}input:focus,textarea:focus{border-color:#55a9d1}
.actions{margin-top:16px}.notice,.conclusion{margin-top:14px;padding:10px 12px;line-height:1.6;background:rgba(255,255,255,.05)}.conclusion{color:#9de0ae}.validation{margin-top:8px;color:#ffb0b0;white-space:pre-wrap}.log-toolbar{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:14px}.log-toolbar strong{margin-right:auto}.log-output{height:180px;overflow:auto;margin:8px 0;padding:10px;color:#d4e4ee;background:rgba(0,0,0,.2);white-space:pre-wrap}.report-paths{margin-top:8px;color:rgba(255,255,255,.68);white-space:pre-wrap;overflow-wrap:anywhere}.error{display:none;margin-top:12px;padding:10px;color:#ff9d9d;background:rgba(180,50,50,.15);white-space:pre-wrap}
.table-wrap{max-width:100%;overflow:auto;margin-top:12px}table{width:100%;min-width:1050px;border-collapse:collapse}th,td{padding:7px 8px;border:1px solid rgba(255,255,255,.1);text-align:left;vertical-align:top}th{position:sticky;top:0;background:#292b2f;white-space:nowrap}td{max-width:260px;overflow-wrap:anywhere}td.code{font:11px/1.45 Consolas,"Courier New",monospace}
.chain{min-height:260px;margin:0;padding:14px;overflow:auto;white-space:pre-wrap;line-height:1.65;background:rgba(0,0,0,.18)}.browser-json{margin-top:14px}.history-tools{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr) auto;gap:8px;margin-bottom:12px}.history-item{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 0;border-bottom:1px solid rgba(255,255,255,.08)}.history-item code{overflow-wrap:anywhere}
.help-search{max-width:520px;margin-bottom:14px}.help-content{max-width:920px}.help-section{padding:0 0 16px;margin:0 0 16px;border-bottom:1px solid rgba(255,255,255,.09)}.help-section h2{margin:0 0 7px;font-size:14px}.help-section p{margin:0;line-height:1.75;color:rgba(255,255,255,.76)}
@media(max-width:760px){.form-grid{grid-template-columns:minmax(0,1fr)}.header{align-items:flex-start;flex-direction:column}}
`;

exports.$ = {
    tabBar: '#tabBar', pages: '#pages', status: '#status', openLatest: '#openLatest', openReportDirectory: '#openReportDirectory', stop: '#stop', start: '#start', publicUrl: '#publicUrl',
    buildDirectory: '#buildDirectory', zipPath: '#zipPath', originUrl: '#originUrl', timeout: '#timeout',
    concurrency: '#concurrency', progress: '#progress', conclusion: '#conclusion', validation: '#validation', logOutput: '#logOutput', copyLogs: '#copyLogs', clearLogs: '#clearLogs', exportLogs: '#exportLogs', reportPaths: '#reportPaths', error: '#error',
    fileSummary: '#fileSummary', fileRows: '#fileRows', chainText: '#chainText', copyScript: '#copyScript',
    importBrowser: '#importBrowser', browserJson: '#browserJson', browserSummary: '#browserSummary',
    historyLeft: '#historyLeft', historyRight: '#historyRight', compareHistory: '#compareHistory', historyCompare: '#historyCompare', historyRows: '#historyRows', helpSearch: '#helpSearch', helpContent: '#helpContent',
};

exports.methods = {
    updateState(next) { currentState = next; this.render(); },
    render() {
        const state = currentState || { status: '就绪', defaults: {} };
        this.$.status.textContent = statusText(state);
        const defaults = state.input || state.defaults || {};
        if (!formInitialized) {
            ['publicUrl', 'buildDirectory', 'zipPath', 'originUrl', 'timeout', 'concurrency'].forEach((key) => {
                if (this.$[key]) this.$[key].value = defaults[key] == null ? '' : defaults[key];
            });
            formInitialized = true;
        }
        const busy = ['校验输入', '读取 ZIP', '源站检查', '公网检查', '分析结果', '写入报告', '诊断中'].includes(state.status);
        this.$.start.disabled = busy;
        this.$.start.textContent = busy ? '诊断中…' : '开始快速诊断';
        this.$.stop.disabled = !busy;
        this.$.progress.textContent = progressText(state);
        this.$.conclusion.textContent = state.report
            ? `严重程度：${state.report.severity || '提示'}；${state.report.conclusion}`
            : '尚未诊断';
        this.$.validation.textContent = Object.values(state.validationErrors || {}).join('\n');
        this.$.logOutput.textContent = state.logs && state.logs.length
            ? state.logs.map(formatLog).join('\n')
            : '暂无日志。';
        this.$.logOutput.scrollTop = this.$.logOutput.scrollHeight;
        this.$.reportPaths.textContent = state.files
            ? `报告 JSON：${state.files.jsonPath}\n报告 Markdown：${state.files.markdownPath}\n报告 HTML：${state.files.htmlPath}${state.files.failedJsonPath ? `\n失败报告 JSON：${state.files.failedJsonPath}\n失败报告 Markdown：${state.files.failedMarkdownPath}\n失败报告 HTML：${state.files.failedHtmlPath}` : ''}`
            : '尚未生成报告。';
        this.$.error.textContent = state.error || '';
        this.$.error.style.display = state.error ? 'block' : 'none';
        renderFileRows(this.$.fileRows, state.report);
        renderChain(this.$.chainText, state.report);
        renderBrowser(this.$.browserSummary, state.browserReport);
        renderHistory(this.$.historyRows, state.history);
        this.$.historyCompare.textContent = state.historyComparison ? JSON.stringify(state.historyComparison, null, 2) : '请选择两个 JSON 报告进行对比。';
        renderHelp(this.$.helpContent, helpFilter);
    },
};

exports.ready = async function ready() {
    this.$.tabs = Array.from(this.$.tabBar.querySelectorAll('.tab'));
    this.$.tabs.forEach((tab) => tab.addEventListener('click', () => switchTab(this, tab.dataset.tab)));
    ['publicUrl', 'buildDirectory', 'zipPath', 'originUrl', 'timeout', 'concurrency'].forEach((key) => {
        this.$[key].addEventListener('input', () => { formDirty = true; });
    });
    this.$.start.addEventListener('confirm', async () => {
        const inputs = readInputs(this);
        const errors = validateInputs(inputs, { requirePublicUrl: true });
        if (Object.keys(errors).length) {
            currentState = { ...(currentState || {}), status: '失败', input: inputs, validationErrors: errors, error: Object.values(errors)[0] };
            this.render();
            if (errors.publicUrl) this.$.publicUrl.focus();
            return;
        }
        // Freeze the exact form snapshot before any render can touch the inputs.
        currentState = { ...(currentState || {}), status: '校验输入', input: inputs, validationErrors: {}, error: '' };
        this.render();
        currentState = await Editor.Message.request(PACKAGE_NAME, 'quick-diagnose', inputs);
        this.render();
    });
    this.$.stop.addEventListener('confirm', async () => {
        currentState = await Editor.Message.request(PACKAGE_NAME, 'stop-diagnose');
        this.render();
    });
    this.$.openLatest.addEventListener('confirm', () => Editor.Message.request(PACKAGE_NAME, 'open-latest-report'));
    this.$.openReportDirectory.addEventListener('confirm', () => Editor.Message.request(PACKAGE_NAME, 'open-report-directory'));
    this.$.copyLogs.addEventListener('confirm', () => copyText((currentState && currentState.logs || []).map(formatLog).join('\n')));
    this.$.clearLogs.addEventListener('confirm', async () => { currentState = await Editor.Message.request(PACKAGE_NAME, 'clear-logs'); this.render(); });
    this.$.exportLogs.addEventListener('confirm', async () => { currentState = await Editor.Message.request(PACKAGE_NAME, 'export-logs'); this.render(); });
    this.$.copyScript.addEventListener('confirm', async () => {
        const result = await Editor.Message.request(PACKAGE_NAME, 'copy-browser-script');
        this.$.browserSummary.textContent = result && result.copied ? '脚本已复制到剪贴板。' : '请手动复制脚本文件内容。';
    });
    this.$.importBrowser.addEventListener('confirm', async () => {
        try {
            currentState = await Editor.Message.request(PACKAGE_NAME, 'load-browser-report', JSON.parse(this.$.browserJson.value));
            this.render();
        }
        catch (error) { this.$.browserSummary.textContent = `浏览器 JSON 无效：${error.message}`; }
    });
    this.$.compareHistory.addEventListener('confirm', async () => {
        try {
            const result = await Editor.Message.request(PACKAGE_NAME, 'compare-reports', { left: this.$.historyLeft.value, right: this.$.historyRight.value });
            currentState = { ...(currentState || {}), historyComparison: result };
            this.render();
        } catch (error) { this.$.historyCompare.textContent = `报告对比失败：${error.message}`; }
    });
    this.$.historyRows.addEventListener('click', (event) => {
        const button = event.target.closest('[data-open-report]');
        if (button) void Editor.Message.request(PACKAGE_NAME, 'open-report', button.dataset.openReport);
    });
    this.$.helpSearch.addEventListener('input', () => { helpFilter = this.$.helpSearch.value; renderHelp(this.$.helpContent, helpFilter); });
    const initialState = await Editor.Message.request(PACKAGE_NAME, 'get-state');
    if (initialState) {
        currentState = initialState;
        formInitialized = false;
        this.render();
    }
    await Editor.Message.request(PACKAGE_NAME, 'panel-ready');
};

function readInputs(view) {
    return normalizeInputs({
        publicUrl: valueOf(view.$.publicUrl).trim(),
        buildDirectory: valueOf(view.$.buildDirectory).trim(),
        zipPath: valueOf(view.$.zipPath).trim(),
        originUrl: valueOf(view.$.originUrl).trim(),
        timeout: Number(valueOf(view.$.timeout)),
        concurrency: Number(valueOf(view.$.concurrency)),
    }, Editor.Project && Editor.Project.path || process.cwd());
}

function progressText(state) {
    if (state.status === '完成') return `诊断完成，共检查 ${state.checked || 0} 个文件，耗时 ${state.elapsedMs || 0} 毫秒。`;
    if (state.status === '失败') return `诊断失败：${state.error || '请查看执行日志。'}`;
    if (state.status === '已取消') return '诊断已取消。';
    if (state.progress && state.progress.total) return `${state.progress.phase || state.status}：正在请求 ${state.progress.current}/${state.progress.total}：${state.progress.path || ''}`;
    if (state.status === '就绪') return '等待输入。';
    return `${state.status || '处理中'}：${state.progress && state.progress.path || '正在处理。'}`;
}

function formatLog(entry) {
    const details = [entry.source, entry.path, entry.status && `HTTP ${entry.status}`, entry.bytes != null && `${entry.bytes} bytes`, entry.mismatch && 'mismatch', entry.error].filter(Boolean).join(' | ');
    return `[${entry.time || ''}] ${entry.phase || ''} ${entry.message || ''}${details ? ` | ${details}` : ''}`;
}

async function copyText(value) {
    if (!value) return;
    if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(value);
        return;
    }
    const textarea = document.createElement('textarea');
    textarea.value = value;
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    textarea.remove();
}

function switchTab(view, tab) {
    activeTab = tab;
    view.$.tabs.forEach((item) => item.classList.toggle('active', item.dataset.tab === tab));
    view.$.pages.querySelectorAll('.page').forEach((page) => page.classList.toggle('active', page.id === tab));
}

function renderFileRows(target, report) {
    if (!target) return;
    const rows = reportRows(report);
    target.innerHTML = rows.length ? rows.map((row) => `<tr><td>${escapeHtml(row.layer)}</td><td class="code">${escapeHtml(row.path)}</td><td>${escapeHtml(row.status)}</td><td>${escapeHtml(row.bytes)}</td><td class="code">${escapeHtml(row.sha256)}</td><td>${escapeHtml(row.cacheControl)}</td><td>${escapeHtml(row.etag)}</td><td>${escapeHtml(row.age)}</td><td>${escapeHtml(row.cfCacheStatus)}</td><td>${row.mismatch ? '同一指纹对应不同内容' : row.status === 404 ? '关键文件缺失' : ''}</td></tr>`).join('') : '<tr><td colspan="10">完成诊断后显示结果。</td></tr>';
}

function renderChain(target, report) {
    if (!target) return;
    if (!report || !report.local || !report.local.manifest) { target.textContent = '完成诊断后显示引用链。'; return; }
    const entry = report.local.manifest.entry || {};
    const lines = ['index.html', `  -> ${entry.rootIndex || '缺失 root index'}`, `  -> ${entry.application || '缺失 application'}`, `  -> ${entry.importMap || '缺失 import-map'}`, `  -> ${entry.settings || '缺失 settings'}`];
    (report.local.manifest.bundles || []).forEach((bundle) => lines.push(`  -> ${bundle.bundle}: ${bundle.index} + ${bundle.config} = ${bundle.bundleVersion}`));
    const summary = Array.from(new Set(report.issues || [])).map((issue) => ISSUE_TEXT[issue] || issue);
    lines.push('', `结论：${summary.join('、') || '全部通过'}`);
    target.textContent = lines.join('\n');
}

function renderBrowser(target, report) {
    if (!target) return;
    if (!report) { target.textContent = '尚未导入浏览器报告。'; return; }
    target.textContent = JSON.stringify({ location: report.location, controller: report.controller, registrations: report.registrations, cacheStorage: report.cacheStorage, conclusion: report.conclusion }, null, 2);
}

function renderHistory(target, history) {
    if (!target) return;
    if (!history || history.length === 0) { target.innerHTML = '没有诊断报告。'; return; }
    target.innerHTML = history.map((item) => `<div class="history-item"><code>${escapeHtml(item.name)}</code><span>${new Date(item.time).toLocaleString()}</span><button data-open-report="${escapeHtml(item.name)}">打开</button></div>`).join('');
}

function renderHelp(target, filter) {
    if (!target) return;
    const query = String(filter || '').trim().toLowerCase();
    const sections = HELP_SECTIONS.filter(([title, body]) => !query || `${title} ${body}`.toLowerCase().includes(query));
    target.innerHTML = sections.length ? sections.map(([title, body]) => `<article class="help-section"><h2>${escapeHtml(title)}</h2><p>${escapeHtml(body)}</p></article>`).join('') : '<div class="notice">没有匹配的帮助内容。</div>';
}
