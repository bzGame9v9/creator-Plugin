'use strict';

const PACKAGE_NAME = 'render-optimization-platform';
let latestState = null;
let currentTab = 'overview';

const SEVERITY_LABELS = {
    critical: '严重',
    high: '高',
    medium: '中',
    low: '低',
    info: '信息',
};

const TEXT_STATUS = {
    idle: '等待扫描',
    scanning: '扫描中',
    completed: '扫描完成',
    failed: '扫描失败',
    cancelled: '扫描已取消',
};

function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, character => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[character]));
}

function formatBytes(bytes) {
    const value = Number(bytes || 0);
    if (value < 1024) return `${value} B`;
    if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KiB`;
    if (value < 1024 * 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MiB`;
    return `${(value / (1024 * 1024 * 1024)).toFixed(2)} GiB`;
}

function metric(label, value, tone = '') {
    return `<div class="metric ${tone}"><div class="metric-value">${escapeHtml(value)}</div><div class="metric-label">${escapeHtml(label)}</div></div>`;
}

function severityBadge(severity) {
    return `<span class="severity severity-${escapeHtml(severity)}">${escapeHtml(SEVERITY_LABELS[severity] || severity)}</span>`;
}

function firstAsset(finding) {
    return finding && finding.affectedAssets && finding.affectedAssets[0] || '';
}

function progressPercent(progress) {
    if (!progress || !progress.total) return progress && progress.phase === 'complete' ? 100 : 4;
    return Math.max(2, Math.min(100, Math.round((progress.current / progress.total) * 100)));
}

function reportOverview(report) {
    const summary = report.summary;
    const severity = summary.findingsBySeverity || {};
    const components = Object.entries(summary.componentCounts || {})
        .sort((left, right) => right[1] - left[1])
        .map(([kind, count]) => `<tr><td>${escapeHtml(kind)}</td><td class="number">${count}</td></tr>`)
        .join('');
    const topFindings = report.findings.slice(0, 12).map(finding => `
        <div class="finding-row compact">
          <div>${severityBadge(finding.severity)}</div>
          <div class="finding-main"><div class="finding-title">${escapeHtml(finding.title)}</div><div class="finding-meta">${escapeHtml(finding.ruleId)} · ${escapeHtml(finding.confidence)}</div></div>
          ${firstAsset(finding) ? `<ui-button class="open-asset" data-open-path="${escapeHtml(firstAsset(finding))}">打开</ui-button>` : ''}
        </div>
    `).join('');

    return `
      <div class="metric-grid">
        ${metric('资产', summary.assetCount)}
        ${metric('场景 / 预制体', `${summary.sceneCount} / ${summary.prefabCount}`)}
        ${metric('纹理', summary.textureCount)}
        ${metric('材质 / 图集', `${summary.materialCount} / ${summary.atlasCount}`)}
        ${metric('节点', summary.nodeCount)}
        ${metric('渲染器', summary.rendererCount)}
        ${metric('严重', severity.critical || 0, 'critical')}
        ${metric('高', severity.high || 0, 'high')}
        ${metric('中', severity.medium || 0, 'medium')}
        ${metric('部分解析失败', report.coverage.parseErrors, report.coverage.parseErrors ? 'high' : 'ok')}
      </div>
      <div class="overview-columns">
        <section class="plain-section">
          <h2>主要问题</h2>
          <div class="finding-list">${topFindings || '<div class="empty">当前规则未命中问题</div>'}</div>
        </section>
        <section class="plain-section">
          <h2>组件分布</h2>
          <table><thead><tr><th>组件</th><th class="number">数量</th></tr></thead><tbody>${components || '<tr><td colspan="2">无数据</td></tr>'}</tbody></table>
          <h2 class="space-top">静态资源成本</h2>
          <div class="kv"><span>纹理源文件</span><strong>${formatBytes(report.metrics.textureSourceBytes)}</strong></div>
          <div class="kv"><span>RGBA 理论上限</span><strong>${formatBytes(report.metrics.textureRgbaMemoryUpperBound)}</strong></div>
          <div class="kv"><span>重复纹理组</span><strong>${report.metrics.exactDuplicateTextureGroups}</strong></div>
          <div class="kv"><span>等价材质组</span><strong>${report.metrics.equivalentMaterialGroups}</strong></div>
        </section>
      </div>
    `;
}

function reportFindings(report, severityFilter, query) {
    const normalizedQuery = query.toLowerCase();
    const findings = report.findings.filter(finding => {
        if (severityFilter !== 'all' && finding.severity !== severityFilter) return false;
        if (!normalizedQuery) return true;
        const haystack = [finding.title, finding.description, finding.ruleId, finding.category, ...(finding.affectedAssets || []), ...(finding.affectedNodes || [])].join(' ').toLowerCase();
        return haystack.includes(normalizedQuery);
    });
    if (!findings.length) return '<div class="empty">没有匹配的分析结果</div>';
    return `<div class="finding-list">${findings.slice(0, 250).map(finding => `
      <article class="finding-row">
        <div class="finding-side">${severityBadge(finding.severity)}<span class="category">${escapeHtml(finding.category)}</span></div>
        <div class="finding-main">
          <div class="finding-title">${escapeHtml(finding.title)}</div>
          <div class="finding-description">${escapeHtml(finding.description)}</div>
          <div class="finding-meta">${escapeHtml(finding.ruleId)} · 置信度 ${escapeHtml(finding.confidence)} · 操作 ${escapeHtml(finding.actionSafety)}</div>
          <div class="recommendation">${escapeHtml(finding.recommendation)}</div>
          ${finding.evidence && finding.evidence.length ? `<details><summary>证据 ${finding.evidence.length}</summary><pre>${escapeHtml(finding.evidence.slice(0, 30).join('\n'))}</pre></details>` : ''}
        </div>
        <div class="finding-actions">${firstAsset(finding) ? `<ui-button class="open-asset" data-open-path="${escapeHtml(firstAsset(finding))}">打开资源</ui-button>` : ''}</div>
      </article>
    `).join('')}</div>${findings.length > 250 ? `<div class="limit-note">仅展示前 250 条，完整结果请导出报告。</div>` : ''}`;
}

function reportAssets(report, query) {
    const normalizedQuery = query.toLowerCase();
    const assets = report.assets.filter(asset => {
        if (!normalizedQuery) return true;
        return `${asset.relativePath} ${asset.uuid} ${asset.importer}`.toLowerCase().includes(normalizedQuery);
    });
    const rows = assets.slice(0, 350).map(asset => {
        const texture = asset.texture ? `${asset.texture.width} x ${asset.texture.height}` : '';
        return `<tr>
          <td class="path-cell">${escapeHtml(asset.relativePath)}</td>
          <td>${escapeHtml(asset.importer || asset.extension)}</td>
          <td>${escapeHtml(texture)}</td>
          <td class="number">${formatBytes(asset.byteSize)}</td>
          <td class="number">${asset.dependencies.length}</td>
          <td><ui-button class="open-asset icon-button" data-open-path="${escapeHtml(asset.relativePath)}">打开</ui-button></td>
        </tr>`;
    }).join('');
    return `<table class="asset-table"><thead><tr><th>资源</th><th>类型</th><th>尺寸</th><th class="number">源大小</th><th class="number">依赖</th><th></th></tr></thead><tbody>${rows || '<tr><td colspan="6">没有匹配的资源</td></tr>'}</tbody></table>${assets.length > 350 ? '<div class="limit-note">仅展示前 350 条，完整索引请导出报告。</div>' : ''}`;
}

function reportRenderTrees(report, query) {
    const normalizedQuery = query.toLowerCase();
    const documents = report.renderDocuments.filter(document => !normalizedQuery || document.path.toLowerCase().includes(normalizedQuery));
    if (!documents.length) return '<div class="empty">没有匹配的场景或预制体</div>';
    return documents.slice(0, 220).map(document => {
        const breaks = document.estimatedBreaks;
        return `<section class="document-row">
          <div class="document-head">
            <div><div class="finding-title">${escapeHtml(document.path)}</div><div class="finding-meta">${document.kind} · ${document.nodeCount} 个节点 · 深度 ${document.maxDepth}</div></div>
            <ui-button class="open-asset" data-open-path="${escapeHtml(document.path)}">打开</ui-button>
          </div>
          <div class="document-metrics">
            <span>渲染器 <strong>${breaks.rendererCount}</strong></span>
            <span>估算 Batch <strong>${breaks.estimatedBatches}</strong></span>
            <span>纹理 <strong>${breaks.textureSwitches}</strong></span>
            <span>材质 <strong>${breaks.materialSwitches}</strong></span>
            <span>混合 <strong>${breaks.blendSwitches}</strong></span>
            <span>遮罩 <strong>${breaks.maskBarriers}</strong></span>
          </div>
          <details><summary>渲染树 ${document.renderTree.length} 个纹理组</summary><pre>${escapeHtml(JSON.stringify(document.renderTree.slice(0, 20), null, 2))}</pre></details>
        </section>`;
    }).join('');
}

function reportLimitations(report) {
    return `<section class="plain-section limitations"><h2>采集边界</h2>${report.limitations.map(item => `<div class="limitation">${escapeHtml(item)}</div>`).join('')}<h2 class="space-top">运行时指标</h2><div class="runtime-grid"><div>DrawCall<strong>暂无数据</strong></div><div>FPS<strong>暂无数据</strong></div><div>CPU 渲染<strong>暂无数据</strong></div><div>缓冲上传<strong>暂无数据</strong></div></div></section>`;
}

exports.template = /* html */ `
<div class="shell">
  <header class="toolbar">
    <div class="identity"><div class="title">渲染优化平台</div><div id="status" class="status">等待扫描</div></div>
    <div class="actions">
      <ui-button id="scanBtn">扫描项目</ui-button>
      <ui-button id="cancelBtn" disabled>取消</ui-button>
      <ui-button id="exportBtn" disabled>导出</ui-button>
      <ui-button id="folderBtn">报告目录</ui-button>
    </div>
  </header>
  <div class="progress-track"><div id="progressBar" class="progress-bar"></div></div>
  <div class="subbar">
    <nav id="tabBar" class="tabs">
      <button data-tab="overview" class="active">概览</button>
      <button data-tab="findings">问题</button>
      <button data-tab="assets">资产</button>
      <button data-tab="trees">渲染树</button>
      <button data-tab="limitations">限制</button>
    </nav>
    <div id="filters" class="filters">
      <select id="severityFilter"><option value="all">全部风险</option><option value="critical">严重</option><option value="high">高</option><option value="medium">中</option><option value="low">低</option><option value="info">信息</option></select>
      <input id="searchInput" type="search" placeholder="筛选路径、规则或节点">
    </div>
  </div>
  <main id="content" class="content"><div class="empty">等待第一次扫描</div></main>
</div>
`;

exports.style = /* css */ `
  :host { display: flex; color: var(--color-normal-contrast); background: var(--color-normal-fill); }
  * { box-sizing: border-box; letter-spacing: 0; }
  .shell { display: flex; flex: 1; min-width: 0; min-height: 0; flex-direction: column; font-size: 13px; }
  .toolbar { display: flex; align-items: center; justify-content: space-between; gap: 16px; min-height: 58px; padding: 10px 14px; border-bottom: 1px solid rgba(255,255,255,.08); }
  .identity { min-width: 0; }
  .title { font-size: 15px; font-weight: 600; }
  .status { margin-top: 3px; opacity: .62; font: 12px/16px Consolas, "Courier New", monospace; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .actions { display: flex; flex: 0 0 auto; gap: 7px; }
  .progress-track { height: 2px; background: rgba(255,255,255,.05); }
  .progress-bar { width: 0; height: 100%; background: #35a7a0; transition: width .15s ease; }
  .subbar { display: flex; align-items: center; justify-content: space-between; gap: 14px; min-height: 43px; padding: 0 14px; border-bottom: 1px solid rgba(255,255,255,.08); }
  .tabs { display: flex; align-self: stretch; gap: 2px; }
  .tabs button { min-width: 74px; padding: 0 10px; border: 0; border-bottom: 2px solid transparent; color: inherit; background: transparent; cursor: pointer; opacity: .68; }
  .tabs button.active { border-bottom-color: #35a7a0; opacity: 1; }
  .filters { display: flex; gap: 8px; }
  select, input { height: 26px; border: 1px solid rgba(255,255,255,.13); border-radius: 3px; color: inherit; background: rgba(0,0,0,.2); outline: none; }
  select { width: 110px; padding: 0 7px; }
  input { width: 230px; padding: 0 9px; }
  .content { flex: 1; min-height: 0; overflow: auto; padding: 14px; }
  .empty { padding: 52px 16px; text-align: center; opacity: .58; }
  .error { max-width: 980px; padding: 14px; border-left: 3px solid #ef6a6a; background: rgba(239,106,106,.08); white-space: pre-wrap; overflow-wrap: anywhere; }
  .metric-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(118px, 1fr)); gap: 8px; }
  .metric { min-height: 70px; padding: 10px 11px; border: 1px solid rgba(255,255,255,.09); border-radius: 4px; background: rgba(255,255,255,.025); }
  .metric-value { font: 600 21px/28px Consolas, "Courier New", monospace; }
  .metric-label { margin-top: 4px; opacity: .58; }
  .metric.critical { border-left: 3px solid #ef6a6a; }
  .metric.high { border-left: 3px solid #ef9b58; }
  .metric.medium { border-left: 3px solid #d6bd50; }
  .metric.ok { border-left: 3px solid #58b47b; }
  .overview-columns { display: grid; grid-template-columns: minmax(0, 1.6fr) minmax(280px, .8fr); gap: 24px; margin-top: 22px; }
  .plain-section { min-width: 0; }
  h2 { margin: 0 0 9px; font-size: 13px; font-weight: 600; }
  .space-top { margin-top: 22px; }
  .finding-list { border-top: 1px solid rgba(255,255,255,.09); }
  .finding-row { display: grid; grid-template-columns: 92px minmax(0, 1fr) max-content; gap: 12px; align-items: start; padding: 12px 4px; border-bottom: 1px solid rgba(255,255,255,.08); }
  .finding-row.compact { grid-template-columns: 76px minmax(0, 1fr) max-content; padding: 9px 3px; }
  .finding-side { display: flex; align-items: flex-start; flex-direction: column; gap: 6px; }
  .severity { display: inline-flex; align-items: center; min-width: 65px; height: 20px; padding: 0 6px; border-left: 3px solid currentColor; font: 600 11px/20px Consolas, "Courier New", monospace; }
  .severity-critical { color: #ef6a6a; background: rgba(239,106,106,.1); }
  .severity-high { color: #ef9b58; background: rgba(239,155,88,.1); }
  .severity-medium { color: #d6bd50; background: rgba(214,189,80,.1); }
  .severity-low { color: #72b58b; background: rgba(114,181,139,.1); }
  .severity-info { color: #5da8cc; background: rgba(93,168,204,.1); }
  .category { font-size: 11px; opacity: .52; }
  .finding-main { min-width: 0; }
  .finding-title { font-size: 13px; font-weight: 600; overflow-wrap: anywhere; }
  .finding-description { margin-top: 5px; line-height: 1.55; opacity: .78; }
  .finding-meta { margin-top: 4px; opacity: .5; font: 11px/16px Consolas, "Courier New", monospace; overflow-wrap: anywhere; }
  .recommendation { margin-top: 8px; padding-left: 9px; border-left: 2px solid rgba(53,167,160,.55); line-height: 1.55; }
  .finding-actions { min-width: 76px; text-align: right; }
  details { margin-top: 8px; }
  summary { cursor: pointer; opacity: .66; }
  pre { max-height: 280px; margin: 7px 0 0; padding: 9px; overflow: auto; border: 1px solid rgba(255,255,255,.08); background: rgba(0,0,0,.17); font: 11px/1.5 Consolas, "Courier New", monospace; white-space: pre-wrap; overflow-wrap: anywhere; }
  table { width: 100%; border-collapse: collapse; }
  th, td { padding: 7px 8px; border-bottom: 1px solid rgba(255,255,255,.08); text-align: left; vertical-align: middle; }
  th { position: sticky; top: -14px; z-index: 1; background: var(--color-normal-fill); font-size: 11px; opacity: .65; }
  .number { text-align: right; font-family: Consolas, "Courier New", monospace; }
  .path-cell { max-width: 540px; overflow-wrap: anywhere; font-family: Consolas, "Courier New", monospace; }
  .kv { display: flex; justify-content: space-between; gap: 12px; padding: 7px 0; border-bottom: 1px solid rgba(255,255,255,.08); }
  .kv span { opacity: .62; }
  .kv strong { font-family: Consolas, "Courier New", monospace; }
  .document-row { padding: 13px 2px; border-bottom: 1px solid rgba(255,255,255,.09); }
  .document-head { display: flex; justify-content: space-between; gap: 12px; }
  .document-metrics { display: grid; grid-template-columns: repeat(6, minmax(90px, 1fr)); gap: 6px; margin-top: 10px; }
  .document-metrics span { padding: 7px; border-left: 2px solid rgba(255,255,255,.12); background: rgba(255,255,255,.025); opacity: .68; }
  .document-metrics strong { display: block; margin-top: 3px; color: var(--color-normal-contrast); font: 600 15px/20px Consolas, "Courier New", monospace; opacity: 1; }
  .limitation { padding: 9px 0; border-bottom: 1px solid rgba(255,255,255,.08); line-height: 1.55; }
  .runtime-grid { display: grid; grid-template-columns: repeat(4, minmax(120px, 1fr)); gap: 8px; }
  .runtime-grid div { padding: 9px; border-left: 2px solid #5da8cc; background: rgba(93,168,204,.06); }
  .runtime-grid strong { display: block; margin-top: 5px; font: 12px/18px Consolas, "Courier New", monospace; opacity: .55; }
  .limit-note { padding: 10px 0; text-align: center; opacity: .54; }
  @media (max-width: 900px) { .overview-columns { grid-template-columns: 1fr; } .document-metrics { grid-template-columns: repeat(3, 1fr); } .filters input { width: 160px; } }
`;

exports.$ = {
    status: '#status',
    scanBtn: '#scanBtn',
    cancelBtn: '#cancelBtn',
    exportBtn: '#exportBtn',
    folderBtn: '#folderBtn',
    progressBar: '#progressBar',
    tabBar: '#tabBar',
    filters: '#filters',
    severityFilter: '#severityFilter',
    searchInput: '#searchInput',
    content: '#content',
};

exports.methods = {
    updateState(state) {
        latestState = state;
        this.render();
    },

    render() {
        const state = latestState || { status: 'idle', progress: {}, report: null, error: '' };
        const progress = state.progress || {};
        const progressDetail = progress.total ? ` ${progress.current}/${progress.total}` : '';
        this.$.status.textContent = `${TEXT_STATUS[state.status] || state.status}${progress.message ? ` · ${progress.message}${progressDetail}` : ''}`;
        this.$.progressBar.style.width = state.status === 'scanning' ? `${progressPercent(progress)}%` : state.status === 'completed' ? '100%' : '0%';
        this.$.scanBtn.disabled = state.status === 'scanning';
        this.$.cancelBtn.disabled = state.status !== 'scanning';
        this.$.exportBtn.disabled = !state.report || state.status === 'scanning';
        this.$.filters.style.visibility = currentTab === 'overview' || currentTab === 'limitations' ? 'hidden' : 'visible';
        this.$.severityFilter.style.display = currentTab === 'findings' ? '' : 'none';

        for (const button of this.$.tabBar.querySelectorAll('button')) button.classList.toggle('active', button.dataset.tab === currentTab);
        if (state.status === 'failed' && !state.report) {
            this.$.content.innerHTML = `<div class="error">${escapeHtml(state.error || '扫描失败')}</div>`;
            return;
        }
        if (!state.report) {
            const message = state.status === 'scanning' ? '正在建立资产索引…' : state.status === 'cancelled' ? '扫描已取消，尚无可展示报告' : '等待第一次扫描';
            this.$.content.innerHTML = `<div class="empty">${message}</div>`;
            return;
        }

        const query = String(this.$.searchInput.value || '').trim();
        const severity = String(this.$.severityFilter.value || 'all');
        if (currentTab === 'findings') this.$.content.innerHTML = reportFindings(state.report, severity, query);
        else if (currentTab === 'assets') this.$.content.innerHTML = reportAssets(state.report, query);
        else if (currentTab === 'trees') this.$.content.innerHTML = reportRenderTrees(state.report, query);
        else if (currentTab === 'limitations') this.$.content.innerHTML = reportLimitations(state.report);
        else this.$.content.innerHTML = reportOverview(state.report);
    },
};

exports.ready = async function ready() {
    this.$.scanBtn.addEventListener('confirm', () => Editor.Message.request(PACKAGE_NAME, 'scan-project'));
    this.$.cancelBtn.addEventListener('confirm', () => Editor.Message.request(PACKAGE_NAME, 'cancel-scan'));
    this.$.exportBtn.addEventListener('confirm', async () => {
        try {
            const result = await Editor.Message.request(PACKAGE_NAME, 'export-last-report');
            this.$.status.textContent = `报告已导出 · ${result.jsonPath}`;
        } catch (error) {
            this.$.status.textContent = `导出失败 · ${error && (error.message || error.stack) || error}`;
        }
    });
    this.$.folderBtn.addEventListener('confirm', () => Editor.Message.request(PACKAGE_NAME, 'open-report-directory'));
    this.$.tabBar.addEventListener('click', event => {
        const button = event.target.closest('button[data-tab]');
        if (!button) return;
        currentTab = button.dataset.tab;
        this.render();
    });
    this.$.severityFilter.addEventListener('change', () => this.render());
    this.$.searchInput.addEventListener('input', () => this.render());
    this.$.content.addEventListener('confirm', event => {
        const button = event.target.closest('[data-open-path]');
        if (button) Editor.Message.request(PACKAGE_NAME, 'open-asset', button.dataset.openPath);
    });
    this.$.content.addEventListener('click', event => {
        const button = event.target.closest('[data-open-path]');
        if (button && button.tagName !== 'UI-BUTTON') Editor.Message.request(PACKAGE_NAME, 'open-asset', button.dataset.openPath);
    });
    latestState = await Editor.Message.request(PACKAGE_NAME, 'get-state');
    this.render();
};
