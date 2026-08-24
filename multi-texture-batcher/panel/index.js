'use strict';

const PACKAGE_NAME = 'multi-texture-batcher';
let latestState = null;
let assetFilter = '';

const STATUS_TEXT = {
    idle: '检查中',
    enabling: '正在启用合批运行时',
    enabled: '总开关已打开，合批运行时已安装',
    disabling: '正在关闭合批运行时',
    disabled: '总开关已关闭，使用 Creator 官方渲染',
    scanning: '正在只读扫描 Scene / Prefab',
    scanned: '只读扫描完成',
    restoring: '正在恢复旧版转换',
    restored: '旧版转换已恢复',
    'restore-conflict': '部分文件恢复冲突，未覆盖人工改动',
    failed: '操作失败',
};

function escapeHtml(value) {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function availableAssets() {
    return latestState && latestState.scan && latestState.scan.assets || [];
}

function filteredAssets() {
    const filter = assetFilter.trim().toLowerCase();
    if (!filter) return availableAssets();
    return availableAssets().filter(asset => asset.path.toLowerCase().includes(filter));
}

exports.template = /* html */ `
<div class="wrap">
  <header>
    <div>
      <h1>多纹理合批</h1>
      <div id="status" class="status">检查中</div>
    </div>
    <div class="master-control">
      <span>总开关</span>
      <ui-checkbox id="masterSwitch">启用多纹理合批</ui-checkbox>
    </div>
  </header>
  <main>
    <section>
      <h2>运行边界</h2>
      <div class="row"><span>平台</span><strong>Creator 3.8.6 Web / H5</strong></div>
      <div class="row"><span>组件</span><strong>标准 Sprite、Label 运行时实例</strong></div>
      <div class="row"><span>纹理槽</span><strong>每批最多 8 张，第 9 张安全拆批</strong></div>
      <div class="row"><span>资产安全</span><strong>不修改 Scene、Prefab 和组件 __type__</strong></div>
      <div class="row"><span>生命周期</span><strong id="masterState">-</strong></div>
      <div class="row"><span>运行时目录</span><code id="runtimePath">-</code></div>
    </section>
    <section>
      <h2>自动接入</h2>
      <p>打开总开关后才会安装运行时，并扫描当前激活 Canvas，对官方 Sprite、Label 实例做可逆升级。关闭总开关会完整移除运行时，Creator 重启只检查状态，不会自动安装。</p>
      <p>Mask、Graphics、自定义组件、自定义材质、RenderTexture、Tiled/Filled Sprite 和非 Web 平台保持官方渲染。扫描功能只用于查看候选，不会修改文件。</p>
      <div class="actions-row">
        <ui-button id="scanBtn">只读扫描项目</ui-button>
        <ui-button id="restoreBtn">恢复旧版转换</ui-button>
      </div>
      <div id="scanSummary" class="scan-summary">尚未扫描</div>
      <input id="assetFilter" class="asset-filter" type="search" placeholder="筛选 Prefab / Scene，例如 Hall2Scene">
      <div id="scanAssets" class="scan-assets"><div class="asset-empty">请先只读扫描项目</div></div>
    </section>
    <section>
      <h2>隔离自测</h2>
      <p><code>?multiTextureBatcher=selftest</code>：8 张 Sprite 纹理，预期 1 个多纹理批次。</p>
      <p><code>?multiTextureBatcher=selftest-nine</code>：9 张纹理，预期安全拆成 2 个批次。</p>
      <p><code>?multiTextureBatcher=selftest-mixed</code>：Sprite 与带描边、阴影的 NONE Label 混排。</p>
      <p><code>?multiTextureBatcher=selftest-mask</code>：矩形 Mask 边界和裁剪回归。</p>
      <p>控制台的 <code>setEnabled(false)</code> 只用于当前页面临时调试，不会改变编辑器总开关。</p>
    </section>
    <pre id="error" class="error"></pre>
  </main>
</div>
`;

exports.style = /* css */ `
  :host { display: flex; color: var(--color-normal-contrast); background: var(--color-normal-fill); }
  .wrap { display: flex; flex: 1; min-width: 0; min-height: 0; flex-direction: column; font-size: 13px; }
  header { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 16px 18px; border-bottom: 1px solid rgba(255,255,255,.09); }
  h1 { margin: 0; font-size: 17px; letter-spacing: 0; }
  h2 { margin: 0 0 10px; font-size: 14px; letter-spacing: 0; }
  .status { margin-top: 4px; opacity: .68; }
  .master-control, .actions-row { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; }
  .master-control > span { opacity: .68; }
  .actions-row { margin-top: 12px; }
  main { min-height: 0; overflow: auto; padding: 18px; }
  section { padding: 0 0 18px; margin: 0 0 18px; border-bottom: 1px solid rgba(255,255,255,.08); }
  .row { display: grid; grid-template-columns: 118px minmax(0, 1fr); gap: 14px; align-items: baseline; padding: 6px 0; }
  .row span { opacity: .62; }
  .row strong { font-weight: 500; }
  p { margin: 8px 0; line-height: 1.65; opacity: .78; }
  code { min-width: 0; overflow-wrap: anywhere; font: 12px/18px Consolas, "Courier New", monospace; color: #70b8d6; }
  .scan-summary { margin-top: 12px; padding: 10px 12px; line-height: 1.65; background: rgba(255,255,255,.045); }
  .asset-filter { width: 100%; height: 28px; box-sizing: border-box; margin-top: 10px; padding: 0 9px; border: 1px solid rgba(255,255,255,.14); border-radius: 3px; outline: none; color: inherit; background: rgba(0,0,0,.16); }
  .asset-filter:focus { border-color: #4c9fc5; }
  .scan-assets { max-height: 260px; overflow: auto; margin-top: 8px; border: 1px solid rgba(255,255,255,.08); background: rgba(0,0,0,.14); }
  .asset-row { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 8px; align-items: center; min-height: 34px; padding: 5px 10px; box-sizing: border-box; border-bottom: 1px solid rgba(255,255,255,.055); }
  .asset-row:last-child { border-bottom: 0; }
  .asset-path { min-width: 0; overflow-wrap: anywhere; font: 12px/18px Consolas, "Courier New", monospace; }
  .asset-count { color: rgba(255,255,255,.58); font-size: 12px; white-space: nowrap; }
  .asset-empty { padding: 18px 12px; color: rgba(255,255,255,.5); text-align: center; }
  .error { display: none; margin: 0; padding: 10px; color: #ff9898; background: rgba(180,50,50,.12); white-space: pre-wrap; }
`;

exports.$ = {
    status: '#status',
    runtimePath: '#runtimePath',
    masterState: '#masterState',
    masterSwitch: '#masterSwitch',
    scanBtn: '#scanBtn',
    restoreBtn: '#restoreBtn',
    scanSummary: '#scanSummary',
    assetFilter: '#assetFilter',
    scanAssets: '#scanAssets',
    error: '#error',
};

exports.methods = {
    updateState(state) {
        latestState = state;
        this.render();
    },

    render() {
        const state = latestState || { status: 'idle', runtime: null, error: '' };
        const busy = ['enabling', 'disabling', 'scanning', 'restoring'].includes(state.status);
        const masterEnabled = Boolean(state.masterEnabled && state.runtime && state.runtime.installed);
        const summary = state.scan && state.scan.summary;
        const assets = filteredAssets();
        this.$.status.textContent = STATUS_TEXT[state.status] || state.status;
        this.$.runtimePath.textContent = state.runtime && state.runtime.directory || '-';
        this.$.masterState.textContent = masterEnabled ? '已启用；Web/H5 预览和新构建会加载运行时' : '已关闭；重启 Creator 不会自动启用';
        this.$.masterSwitch.value = masterEnabled;
        if (busy) this.$.masterSwitch.setAttribute('disabled', '');
        else this.$.masterSwitch.removeAttribute('disabled');
        this.$.scanBtn.disabled = busy;
        this.$.restoreBtn.disabled = busy || !(state.conversion && state.conversion.restorable);
        this.$.assetFilter.disabled = busy || !summary;
        if (this.$.assetFilter.value !== assetFilter) this.$.assetFilter.value = assetFilter;
        this.$.scanSummary.textContent = summary
            ? `扫描 ${summary.files} 个资产；${summary.candidateFiles} 个文件包含安全候选；Sprite ${summary.sprites}，Label ${summary.labels}；候选 ${summary.candidates}；旧版已转换 ${summary.convertedSprites + summary.convertedLabels}；解析失败 ${summary.parseErrors}`
            : '尚未扫描';
        if (!summary) {
            this.$.scanAssets.innerHTML = '<div class="asset-empty">请先只读扫描项目</div>';
        } else if (assets.length === 0) {
            this.$.scanAssets.innerHTML = '<div class="asset-empty">没有符合筛选条件的资产</div>';
        } else {
            this.$.scanAssets.innerHTML = assets.map(asset => `
                <div class="asset-row">
                  <span class="asset-path" title="${escapeHtml(asset.path)}">${escapeHtml(asset.path)}</span>
                  <span class="asset-count">Sprite ${asset.sprites} / Label ${asset.labels}</span>
                </div>
            `).join('');
        }
        const conflicts = state.restore && state.restore.conflicts || [];
        const errorText = state.error || (conflicts.length > 0
            ? `以下文件在旧版转换后又被修改，插件没有覆盖：\n${conflicts.join('\n')}`
            : '');
        this.$.error.textContent = errorText;
        this.$.error.style.display = errorText ? 'block' : 'none';
    },
};

exports.ready = async function ready() {
    this.$.masterSwitch.addEventListener('confirm', () => {
        void Editor.Message.request(PACKAGE_NAME, 'set-master-enabled', Boolean(this.$.masterSwitch.value));
    });
    this.$.scanBtn.addEventListener('confirm', () => Editor.Message.request(PACKAGE_NAME, 'scan-project'));
    this.$.restoreBtn.addEventListener('confirm', () => Editor.Message.request(PACKAGE_NAME, 'restore-last-conversion'));
    this.$.assetFilter.addEventListener('input', event => {
        assetFilter = event.target.value || '';
        this.render();
    });
    latestState = await Editor.Message.request(PACKAGE_NAME, 'get-state');
    this.render();
};
