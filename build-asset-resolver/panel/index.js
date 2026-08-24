'use strict';

const PACKAGE_NAME = 'build-asset-resolver';
let latestResult = null;

function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, (character) => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
    }[character]));
}

function renderResult(result, panel) {
    latestResult = result || null;
    panel.$.openBtn.disabled = !result || !result.ok || !result.sourceAssets || !result.sourceAssets.some(asset => asset.exists && !asset.historical);
    panel.$.copyBtn.disabled = !result || !result.ok || !result.sourceAssets || result.sourceAssets.length === 0;

    if (!result) {
        panel.$.summary.textContent = '请输入构建资源路径、文件名或 UUID。';
        panel.$.content.innerHTML = '';
        return;
    }

    if (!result.ok) {
        panel.$.summary.textContent = result.message || '未找到源资源。';
        panel.$.content.innerHTML = `<div class="empty">UUID: ${escapeHtml(result.uuid || '-')}</div>`;
        return;
    }

    panel.$.summary.textContent = `UUID: ${result.uuid}`;
    const sourceRows = result.sourceAssets.map(asset => `
        <div class="item">
          <div class="label">${asset.historical ? 'Git 源文件' : '源资源'}</div><div class="value">${escapeHtml(asset.assetPath)}</div>
          <div class="label">Meta</div><div class="value muted">${escapeHtml(asset.metaPath)}</div>
          <div class="label">状态</div><div class="value">${asset.historical ? `Git 历史 (${escapeHtml(asset.commit)})` : (asset.exists ? '存在' : '缺失')}</div>
        </div>
    `).join('');
    const buildRows = result.buildFiles.length
        ? result.buildFiles.map(file => `<div class="build-file">${escapeHtml(file)}</div>`).join('')
        : '<div class="muted">build/ 下未找到匹配文件。</div>';

    panel.$.content.innerHTML = `
      <section><h3>源资源</h3>${sourceRows}</section>
      <section><h3>构建文件</h3>${buildRows}</section>
    `;
}

exports.template = /* html */ `
<div class="wrap">
  <div class="input-row">
    <ui-input id="input" class="input" placeholder="build/.../native/xx/<uuid>.<hash>.png 或 UUID"></ui-input>
    <ui-button id="resolveBtn">定位</ui-button>
  </div>
  <div id="summary" class="summary">请输入构建资源路径、文件名或 UUID。</div>
  <main id="content" class="content"></main>
  <div class="actions">
    <ui-button id="openBtn" disabled>打开源资源</ui-button>
    <ui-button id="copyBtn" disabled>复制源路径</ui-button>
  </div>
</div>
`;

exports.style = /* css */ `
  :host { display: flex; flex: 1; }
  .wrap { display: flex; flex: 1; min-width: 0; min-height: 0; flex-direction: column; gap: 12px; padding: 14px; font-size: 13px; }
  .input-row { display: flex; gap: 8px; }
  .input { flex: 1; min-width: 0; }
  .summary { min-height: 18px; color: var(--color-normal-contrast); font-family: Consolas, "Courier New", monospace; }
  .content { flex: 1; min-height: 0; overflow: auto; padding: 10px; border: 1px solid rgba(255, 255, 255, 0.1); background: rgba(0, 0, 0, 0.18); }
  section + section { margin-top: 16px; }
  h3 { margin: 0 0 8px; font-size: 12px; opacity: 0.74; text-transform: uppercase; }
  .item { display: grid; grid-template-columns: 58px minmax(0, 1fr); gap: 4px 10px; padding: 8px 0; border-top: 1px solid rgba(255, 255, 255, 0.08); }
  .label { opacity: 0.58; }
  .value, .build-file { overflow-wrap: anywhere; font-family: Consolas, "Courier New", monospace; }
  .build-file { padding: 4px 0; border-top: 1px solid rgba(255, 255, 255, 0.08); }
  .muted { opacity: 0.58; }
  .empty { padding: 24px 0; text-align: center; opacity: 0.7; }
  .actions { display: flex; justify-content: flex-end; gap: 8px; }
`;

exports.$ = {
    input: '#input',
    resolveBtn: '#resolveBtn',
    summary: '#summary',
    content: '#content',
    openBtn: '#openBtn',
    copyBtn: '#copyBtn',
};

exports.methods = {
    updateResult(result) {
        renderResult(result, this);
    },

    async resolve() {
        const value = String(this.$.input.value || '').trim();
        if (!value) {
            this.$.summary.textContent = '请输入构建资源路径、文件名或 UUID。';
            return;
        }
        this.$.resolveBtn.disabled = true;
        try {
            const result = await Editor.Message.request(PACKAGE_NAME, 'resolve-build-asset', value);
            renderResult(result, this);
        } catch (error) {
            this.$.summary.textContent = `定位失败：${error && (error.message || error.stack) || error}`;
        } finally {
            this.$.resolveBtn.disabled = false;
        }
    },

    async openSource() {
        if (!latestResult || !latestResult.ok) return;
        await Editor.Message.request(PACKAGE_NAME, 'open-source-asset', latestResult.uuid);
    },

    async copySourcePath() {
        if (!latestResult || !latestResult.sourceAssets || latestResult.sourceAssets.length === 0) return;
        const text = latestResult.sourceAssets.map(asset => asset.assetPath).join('\n');
        try {
            await navigator.clipboard.writeText(text);
            this.$.summary.textContent = '源路径已复制。';
        } catch (error) {
            this.$.summary.textContent = '复制失败，请在结果面板中手动选择路径。';
        }
    },
};

exports.ready = async function ready() {
    this.$.resolveBtn.addEventListener('confirm', () => this.resolve());
    this.$.openBtn.addEventListener('confirm', () => this.openSource());
    this.$.copyBtn.addEventListener('confirm', () => this.copySourcePath());
    this.$.input.addEventListener('keydown', event => {
        if (event.key === 'Enter') this.resolve();
    });
    renderResult(await Editor.Message.request(PACKAGE_NAME, 'get-last-result'), this);
};
