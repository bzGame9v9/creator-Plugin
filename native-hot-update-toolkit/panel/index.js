'use strict';

const PACKAGE_NAME = 'native-hot-update-toolkit';
let currentState = null;
let activeTab = 'common';
let formInitialized = false;
let formDirty = false;

exports.template = [
  '<div class="shell">',
  '  <header class="topbar">',
  '    <div class="identity"><h1>Android Bundle 发布中心</h1><span id="status" class="status">就绪</span></div>',
  '    <label class="environment">运行环境<select id="environment"><option value="dev">开发（dev）</option><option value="test">测试（test）</option><option value="prod">正式（prod）</option></select></label>',
  '    <div class="top-actions"><ui-button id="saveConfig" class="primary">保存配置</ui-button><ui-button id="refresh">刷新</ui-button><ui-button id="stop" disabled>停止</ui-button></div>',
  '  </header>',
  '  <nav id="tabs" class="tabs">',
  '    <button class="tab active" data-tab="common">基础配置</button>',
  '    <button class="tab" data-tab="base">APK 打包</button>',
  '    <button class="tab" data-tab="resources">资源打包</button>',
  '    <button class="tab" data-tab="bundle">Bundle 打包</button>',
  '    <button class="tab" data-tab="publish">发布帮助</button>',
  '  </nav>',
  '  <main id="pages">',
  '    <section id="common" class="page active">',
  '      <div id="buildSummary" class="summary"></div>',
  '      <div class="section-title">发布版本</div>',
  '      <div class="form-grid">',
  '        <label>首次/重置热更序号（正常构建自动 +1）<input id="releaseSequence" type="number" min="1" step="1"></label>',
  '      </div>',
  '      <div class="section-title">当前环境</div>',
  '      <div class="form-grid">',
  '        <label>应用名称<input id="appName" type="text"></label>',
  '        <label>Android 包名（packageName）<input id="packageName" type="text"></label>',
  '        <label class="span-2">热更资源根地址（baseUrl，外网各环境使用独立域名）<input id="baseUrl" type="url"></label>',
  '        <label class="span-2">本地热更输出目录（outputRoot）<input id="outputRoot" type="text"></label>',
  '      </div>',
  '      <div class="section-title">Creator 与 Android 工具链</div>',
  '      <div class="form-grid">',
  '        <label class="span-2">Cocos Creator 程序路径<input id="creatorExecutable" type="text"></label>',
  '        <label>Android SDK 目录<input id="sdkPath" type="text"></label>',
  '        <label>Android NDK 目录<input id="ndkPath" type="text"></label>',
  '        <label>JDK 17 目录<input id="javaHome" type="text"></label>',
  '        <label>CPU 架构（ABI，逗号分隔）<input id="appABIs" type="text"></label>',
  '      </div>',
  '      <div class="section-title">执行保护与目录</div>',
  '      <div class="toggle-row"><label><input id="confirmed" type="checkbox">允许真实构建</label><label><input id="runChecks" type="checkbox">执行发布前检查</label></div>',
  '      <div class="form-grid">',
  '        <label class="span-2">构建状态文件（stateFile）<input id="stateFile" type="text"></label>',
  '        <label>日志报告目录（reportRoot）<input id="reportRoot" type="text"></label>',
  '        <label>APK 制品目录（artifactRoot）<input id="artifactRoot" type="text"></label>',
  '        <label class="span-2">长期归档根目录（archiveRoot）<input id="archiveRoot" type="text"></label>',
  '      </div>',
  '      <div id="configPath" class="path-line"></div>',
  '      <div class="action-row"><ui-button id="validate">校验公共配置（不构建）</ui-button></div>',
  '    </section>',
  '    <section id="base" class="page">',
  '      <div id="baseSummary" class="summary"></div>',
  '      <div class="section-title">APK 版本</div>',
  '      <div class="form-grid">',
  '        <label>首次/重置 APK versionCode（正常构建自动 +1）<input id="versionCode" type="number" min="1" step="1"></label>',
  '        <label>应用显示版本（versionName）<input id="versionName" type="text"></label>',
  '      </div>',
  '      <div class="section-title">后台 APK 强更配置</div>',
  '      <div class="form-grid">',
  '        <label>安装方式<select id="apkInstallMode"><option value="direct_apk">直接下载 APK</option><option value="google_play">Google Play</option></select></label>',
  '        <label class="span-2">APK 下载地址<input id="apkDownloadUrl" type="url"></label>',
  '        <label class="span-2">APK 更新提示<input id="apkUpdateDesc" type="text"></label>',
  '      </div>',
  '      <div class="section-title">打入 APK 的 Bundle</div>',
  '      <div class="action-row compact"><ui-button id="selectAllApkBundles">全选完整包</ui-button><ui-button id="clearApkBundles">只保留 base</ui-button></div>',
  '      <div id="apkBundleSelection" class="bundle-selection"></div>',
  '      <div class="summary">base 固定内置；勾选的 Bundle 直接打入 APK，适合无需 CDN 的完整测试包。本页不生成资源版本。</div>',
  '      <div class="section-title">基础包执行选项</div>',
  '      <div class="run-options"><label><input id="baseSkipChecks" type="checkbox">跳过发布前检查</label><label><input id="baseSkipCreator" type="checkbox">复用已有 Creator data</label></div>',
  '      <div class="action-row"><ui-button id="baseApk" class="danger">生成基础 APK</ui-button><ui-button id="resume">恢复基础包</ui-button></div>',
  '    </section>',
  '    <section id="resources" class="page">',
  '      <div id="resourceSummary" class="summary"></div>',
  '      <div class="section-title">资源版本配置</div>',
  '      <div class="form-grid">',
  '        <label>资源交付方式<select id="hotfixMode"><option value="incremental">Bundle 内增量</option><option value="full_zip">变化 Bundle 完整 ZIP</option></select></label>',
  '        <label>当前渠道大厅 Bundle<input id="hallBundle" type="text"></label>',
  '        <label class="span-2">可选大厅 Bundle（逗号分隔）<input id="hallBundles" type="text"></label>',
  '        <label class="span-2">资源更新提示<input id="hotfixUpdateDesc" type="text"></label>',
  '      </div>',
  '      <div class="section-title">本次随 base 一起发布的 Bundle</div>',
  '      <div class="summary">base 固定构建且不可取消；其它 Bundle 按需勾选。该模式会完整构建 Creator data，但只发布 base 和勾选项。</div>',
  '      <div class="action-row compact"><ui-button id="selectAllResourceBundles">全选</ui-button><ui-button id="clearResourceBundles">清空其它 Bundle</ui-button></div>',
  '      <div id="resourceBundleSelection" class="bundle-selection"></div>',
  '      <div class="run-options"><label><input id="resourceSkipChecks" type="checkbox">跳过发布前检查</label><label><input id="resourceSkipCreator" type="checkbox">复用已有 Creator 输出</label></div>',
  '      <div class="action-row"><ui-button id="buildResources" class="primary">生成资源包</ui-button></div>',
  '    </section>',
  '    <section id="bundle" class="page">',
  '      <div id="bundleSummary" class="summary"></div>',
  '      <div class="section-title">选择 Creator Bundle</div>',
  '      <div class="summary">此页不包含 base，使用 Creator 官方 Bundle-only；可单选或复选，耗时明显低于资源打包。</div>',
  '      <div class="action-row compact"><ui-button id="selectAllBundles">全选</ui-button><ui-button id="clearBundles">清空</ui-button></div>',
  '      <div id="bundleSelection" class="bundle-selection"></div>',
  '      <div class="run-options"><label><input id="bundleSkipChecks" type="checkbox">跳过发布前检查</label><label><input id="bundleSkipCreator" type="checkbox">复用已有 Creator 输出</label></div>',
  '      <div class="action-row"><ui-button id="buildSelectedBundles" class="primary">生成选中 Bundle</ui-button></div>',
  '    </section>',
  '    <section id="publish" class="page">',
  '      <div class="section-title">固定发布流程</div>',
  '      <div id="publishSummary" class="summary"></div>',
  '      <div class="publish-step"><strong>第一步：上传本次新增制品</strong><span>打开完整 native_hotfix 发布目录，将其中本次生成的 apks、bundle 子目录内容按原层级上传。</span><ui-button id="openPublishDirectory">打开本次发布目录</ui-button></div>',
  '      <div class="publish-step"><strong>第二步：上传版本 Manifest</strong><span>把当前 manifest 文件上传到 CDN 的 native_hotfix 根目录。</span><ui-button id="copyVersionManifest">复制 Manifest 文件</ui-button></div>',
  '      <div class="publish-step"><strong>第三步：更新后台 JSON</strong><span>复制当前后台 JSON 内容，粘贴到 /api/set/get 对应环境。</span><ui-button id="copyBackendJson">复制后台 JSON</ui-button></div>',
  '      <div class="section-title">版本与 Bundle Manifest</div>',
  '      <div class="release-toolbar">',
  '        <select id="releaseSelect"></select>',
  '        <select id="releaseFile"></select>',
  '        <ui-button id="reloadReleases">刷新清单</ui-button>',
  '        <ui-button id="openRelease">打开目录</ui-button>',
  '      </div>',
  '      <div id="releaseSummary" class="summary"></div>',
  '      <textarea id="releaseJson" class="json" readonly></textarea>',
  '    </section>',
  '  </main>',
  '  <section id="completionResult" class="completion-result">',
  '    <div class="completion-content"><strong id="completionTitle"></strong><pre id="completionPaths"></pre></div>',
  '    <div class="completion-actions"><ui-button id="openApkResult">打开 APK 目录</ui-button><ui-button id="openHotUpdateResult">打开热更目录</ui-button></div>',
  '  </section>',
  '  <pre id="error" class="error"></pre>',
  '  <section class="execution-log">',
  '    <div class="log-head"><strong>执行日志</strong><ui-button id="copyLogs">复制日志</ui-button><ui-button id="clearLogs">清空显示</ui-button></div>',
  '    <textarea id="logs" class="logs" readonly spellcheck="false">暂无日志。</textarea>',
  '  </section>',
  '</div>'
].join('\n');

exports.style = [
  ':host{display:flex;min-width:0;min-height:0;color:var(--color-normal-contrast);background:var(--color-normal-fill)}',
  '.shell{display:flex;flex:1;min-width:0;min-height:0;flex-direction:column;font-size:13px}',
  '.topbar{display:grid;grid-template-columns:minmax(220px,1fr) 180px auto;align-items:center;gap:14px;padding:12px 16px;border-bottom:1px solid rgba(255,255,255,.1)}',
  'h1{margin:0;font-size:17px;letter-spacing:0}.status{display:block;margin-top:3px;color:rgba(255,255,255,.62)}',
  '.environment{display:flex;align-items:center;gap:8px}.environment select{flex:1}.top-actions,.release-toolbar,.run-options,.toggle-row,.log-head,.action-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap}',
  '.tabs{display:flex;gap:2px;padding:0 12px;border-bottom:1px solid rgba(255,255,255,.1);flex-wrap:wrap}',
  '.tab{padding:10px 13px;border:0;border-bottom:2px solid transparent;color:rgba(255,255,255,.65);background:transparent;cursor:pointer}.tab.active{color:#fff;border-bottom-color:#55a9d1}',
  'main{min-width:0;min-height:0;flex:1;overflow:hidden}.page{display:none;height:100%;box-sizing:border-box;overflow:auto;padding:16px}.page.active{display:block}',
  'input,select,textarea{box-sizing:border-box;border:1px solid rgba(255,255,255,.16);border-radius:3px;outline:0;color:inherit;background:rgba(0,0,0,.18)}',
  'select option{color:#202124;background:#fff}select option:disabled{color:#777}',
  'input,select{height:30px;padding:0 8px}input:focus,select:focus,textarea:focus{border-color:#55a9d1}',
  '.run-options,.toggle-row{margin-top:12px}.run-options label,.toggle-row label{display:flex;align-items:center;gap:5px;color:rgba(255,255,255,.72)}.action-row{margin-top:18px;padding-top:12px;border-top:1px solid rgba(255,255,255,.1)}',
  '.summary{margin-top:12px;padding:9px 11px;line-height:1.65;background:rgba(255,255,255,.05);white-space:pre-wrap;overflow-wrap:anywhere}',
  '.completion-result{display:none;align-items:center;gap:16px;padding:10px 16px;border-top:1px solid rgba(90,190,125,.35);background:rgba(45,130,75,.14)}.completion-content{min-width:0;flex:1}.completion-content strong{color:#9fe2b4}.completion-content pre{margin:4px 0 0;color:rgba(255,255,255,.72);font:12px/1.5 Consolas,"Courier New",monospace;white-space:pre-wrap;overflow-wrap:anywhere}.completion-actions{display:flex;gap:8px;flex-wrap:wrap}',
  '.execution-log{flex:0 0 220px;min-height:0;box-sizing:border-box;padding:9px 16px 12px;border-top:1px solid rgba(255,255,255,.1)}.log-head strong{margin-right:auto}.logs{width:100%;height:168px;box-sizing:border-box;overflow:auto;margin:7px 0 0;padding:10px;resize:none;color:#d6e4eb;background:rgba(0,0,0,.22);white-space:pre;user-select:text;cursor:text}',
  '.section-title{margin:18px 0 10px;padding-bottom:6px;border-bottom:1px solid rgba(255,255,255,.1);font-weight:600}.section-title:first-child{margin-top:0}',
  '.form-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px 14px}.form-grid label{display:flex;min-width:0;flex-direction:column;gap:5px;color:rgba(255,255,255,.72)}.span-2{grid-column:span 2}',
  '.bundle-table{display:grid;grid-template-columns:70px 130px 100px minmax(220px,1fr) 80px;gap:7px;align-items:center}.bundle-policy{display:grid;grid-template-columns:120px 120px;gap:8px;align-items:center}.bundle-table input[type=checkbox],.bundle-policy input[type=checkbox]{justify-self:center}.bundle-head{font-weight:600;color:rgba(255,255,255,.7)}',
  '.bundle-selection{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:8px 12px;margin:8px 0 12px}.bundle-choice{display:flex;align-items:center;gap:8px;padding:8px 10px;border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.035)}',
  '.action-row.compact{margin-top:6px;padding-top:0;border-top:0}.publish-step{display:grid;grid-template-columns:minmax(220px,1fr) minmax(320px,2fr) auto;align-items:center;gap:12px;padding:12px 10px;border-bottom:1px solid rgba(255,255,255,.1)}.publish-step span{color:rgba(255,255,255,.7)}',
  '.path-line{margin-top:12px;color:rgba(255,255,255,.55);font:12px/1.5 Consolas,"Courier New",monospace;overflow-wrap:anywhere}',
  '.release-toolbar select:first-child{min-width:330px}.release-toolbar select:nth-child(2){min-width:220px}.json{width:100%;min-height:390px;margin-top:12px;padding:11px;resize:vertical;font:12px/1.55 Consolas,"Courier New",monospace}.json[readonly]{color:#c8d5dc}.editable{border-color:rgba(224,177,76,.45)}',
  '.error{display:none;max-height:130px;overflow:auto;margin:0;padding:10px 16px;color:#ffabab;background:rgba(165,45,45,.18);white-space:pre-wrap}',
  '@media(max-width:900px){.topbar{grid-template-columns:1fr}.form-grid{grid-template-columns:1fr}.span-2{grid-column:span 1}.bundle-table{grid-template-columns:65px 100px 85px minmax(180px,1fr) 65px}.completion-result{align-items:flex-start;flex-direction:column}.execution-log{flex-basis:190px}.logs{height:138px}}'
].join('\n');

exports.$ = {
  status: '#status', environment: '#environment', saveConfig: '#saveConfig', refresh: '#refresh',
  tabs: '#tabs', pages: '#pages', validate: '#validate', buildResources: '#buildResources', buildSelectedBundles: '#buildSelectedBundles', baseApk: '#baseApk', resume: '#resume', stop: '#stop',
  selectAllApkBundles: '#selectAllApkBundles', clearApkBundles: '#clearApkBundles', selectAllResourceBundles: '#selectAllResourceBundles', clearResourceBundles: '#clearResourceBundles', selectAllBundles: '#selectAllBundles', clearBundles: '#clearBundles',
  baseSkipChecks: '#baseSkipChecks', baseSkipCreator: '#baseSkipCreator', resourceSkipChecks: '#resourceSkipChecks', resourceSkipCreator: '#resourceSkipCreator', bundleSkipChecks: '#bundleSkipChecks', bundleSkipCreator: '#bundleSkipCreator',
  buildSummary: '#buildSummary', baseSummary: '#baseSummary', resourceSummary: '#resourceSummary', bundleSummary: '#bundleSummary', publishSummary: '#publishSummary', copyLogs: '#copyLogs', clearLogs: '#clearLogs', logs: '#logs',
  releaseSequence: '#releaseSequence', versionCode: '#versionCode', versionName: '#versionName',
  confirmed: '#confirmed', runChecks: '#runChecks', appName: '#appName', packageName: '#packageName',
  baseUrl: '#baseUrl', outputRoot: '#outputRoot', creatorExecutable: '#creatorExecutable', sdkPath: '#sdkPath',
  apkInstallMode: '#apkInstallMode', apkDownloadUrl: '#apkDownloadUrl', apkUpdateDesc: '#apkUpdateDesc', hotfixUpdateDesc: '#hotfixUpdateDesc',
  hallBundle: '#hallBundle', hallBundles: '#hallBundles', apkBundleSelection: '#apkBundleSelection', resourceBundleSelection: '#resourceBundleSelection', bundleSelection: '#bundleSelection',
  ndkPath: '#ndkPath', javaHome: '#javaHome', appABIs: '#appABIs',
  stateFile: '#stateFile', reportRoot: '#reportRoot',
  artifactRoot: '#artifactRoot', archiveRoot: '#archiveRoot', hotfixMode: '#hotfixMode', configPath: '#configPath', releaseSelect: '#releaseSelect', releaseFile: '#releaseFile',
  reloadReleases: '#reloadReleases', openRelease: '#openRelease', releaseSummary: '#releaseSummary', releaseJson: '#releaseJson', error: '#error',
  openPublishDirectory: '#openPublishDirectory', copyVersionManifest: '#copyVersionManifest', copyBackendJson: '#copyBackendJson',
  completionResult: '#completionResult', completionTitle: '#completionTitle', completionPaths: '#completionPaths',
  openApkResult: '#openApkResult', openHotUpdateResult: '#openHotUpdateResult'
};

function escapeHtml(value) {
  return String(value == null ? '' : value).replace(/[&<>"']/g, function (char) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char];
  });
}

function formatEnvironment(value) {
  return { dev: '开发（dev）', test: '测试（test）', prod: '正式（prod）' }[value] || String(value || '');
}

function setValue(panel, key, value) {
  if (panel.$[key]) panel.$[key].value = value == null ? '' : value;
}

function setChecked(panel, key, value) {
  if (panel.$[key]) panel.$[key].checked = value === true;
}

function loadEnvironmentFields(panel, config, environment) {
  const item = config && config.environments && config.environments[environment] || {};
  setValue(panel, 'releaseSequence', item.releaseSequence);
  setValue(panel, 'versionCode', item.versionCode || config.versionCode);
  setVersionFieldsManaged(panel, item.hasPreviousRelease === true);
  setValue(panel, 'appName', item.appName);
  setValue(panel, 'packageName', item.packageName);
  setValue(panel, 'baseUrl', item.baseUrl);
  setValue(panel, 'outputRoot', item.outputRoot);
  setValue(panel, 'apkInstallMode', item.apkInstallMode || (environment === 'prod' ? 'google_play' : 'direct_apk'));
  setValue(panel, 'apkDownloadUrl', item.apkDownloadUrl);
  setValue(panel, 'apkUpdateDesc', item.apkUpdateDesc);
  setValue(panel, 'hotfixUpdateDesc', item.hotfixUpdateDesc);
  setValue(panel, 'hallBundle', item.hallBundle || 'hall');
}

function setVersionFieldsManaged(panel, managed) {
  panel.$.releaseSequence.disabled = managed;
  panel.$.versionCode.disabled = managed;
  panel.$.releaseSequence.title = managed ? '根据该环境上次成功构建自动加 1；删除该环境 state 后可手动设置' : '该环境没有成功记录，可手动设置首次版本';
  panel.$.versionCode.title = panel.$.releaseSequence.title;
}

function renderConfig(panel, config) {
  if (!config || formDirty) return;
  setValue(panel, 'environment', config.environment);
  setValue(panel, 'versionCode', config.versionCode);
  setValue(panel, 'versionName', config.versionName);
  setChecked(panel, 'confirmed', config.confirmed);
  setChecked(panel, 'runChecks', config.pipeline && config.pipeline.runChecks);
  loadEnvironmentFields(panel, config, config.environment);
  setValue(panel, 'creatorExecutable', config.creator && config.creator.executable);
  setValue(panel, 'sdkPath', config.creator && config.creator.sdkPath);
  setValue(panel, 'ndkPath', config.creator && config.creator.ndkPath);
  setValue(panel, 'javaHome', config.creator && config.creator.javaHome);
  setValue(panel, 'appABIs', config.creator && (config.creator.appABIs || []).join(','));
  renderConfiguredBundleChoices(panel, 'apkBundleSelection', config, function (bundle) { return bundle.includeInApk === true; });
  renderConfiguredBundleChoices(panel, 'resourceBundleSelection', config, function () { return false; });
  renderConfiguredBundleChoices(panel, 'bundleSelection', config, function () { return false; });
  setValue(panel, 'stateFile', config.pipeline && config.pipeline.stateFile);
  setValue(panel, 'reportRoot', config.pipeline && config.pipeline.reportRoot);
  setValue(panel, 'artifactRoot', config.pipeline && config.pipeline.artifactRoot);
  setValue(panel, 'archiveRoot', config.pipeline && config.pipeline.archiveRoot);
  setValue(panel, 'hotfixMode', config.pipeline && config.pipeline.hotfixMode || 'incremental');
  setValue(panel, 'hallBundles', config.componentRelease && (config.componentRelease.hallBundles || []).join(',') || 'hall');
  panel.$.configPath.textContent = config.file || '';
  formInitialized = true;
}

function renderConfiguredBundleChoices(panel, containerKey, config, checked) {
  const bundles = Object.keys(config && config.bundles || {});
  const container = panel.$[containerKey];
  container.innerHTML = bundles.map(function (name) {
    return '<label class="bundle-choice"><input type="checkbox" data-bundle="' + escapeHtml(name) + '">' + escapeHtml(name) + '</label>';
  }).join('') || '<div class="summary">没有配置可构建的 Bundle。</div>';
  Array.from(container.querySelectorAll('input[data-bundle]')).forEach(function (input) {
    input.checked = checked(config.bundles[input.dataset.bundle] || {});
    input.addEventListener('change', function () { formDirty = true; });
  });
}

function selectedBundles(panel, containerKey) {
  return Array.from(panel.$[containerKey].querySelectorAll('input[data-bundle]'))
    .filter(function (input) { return input.checked; })
    .map(function (input) { return input.dataset.bundle; });
}

function renderReleases(panel, state) {
  const releases = state.releases || [];
  const selectedPath = state.selectedRelease && state.selectedRelease.releaseFile || panel.$.releaseSelect.value;
  panel.$.releaseSelect.innerHTML = releases.length
    ? releases.map(function (item) {
      const selected = item.releaseFile === selectedPath ? ' selected' : '';
      return '<option value="' + escapeHtml(item.releaseFile) + '"' + selected + '>' +
        escapeHtml(formatEnvironment(item.environment) + ' / ' + item.releaseSequence + ' / ' + item.releaseId) + '</option>';
    }).join('')
    : '<option value="">没有 release</option>';
  panel.$.releaseFile.innerHTML = (state.releaseFiles || []).map(function (name) {
    const selected = state.selectedFile && state.selectedFile.relativePath === name ? ' selected' : '';
    return '<option value="' + escapeHtml(name) + '"' + selected + '>' + escapeHtml(name) + '</option>';
  }).join('');
  const selected = state.selectedRelease;
  panel.$.releaseSummary.textContent = selected
    ? [
      '环境：' + formatEnvironment(selected.environment),
      '发布标识（releaseId）：' + selected.releaseId,
      '发布序号（sequence）：' + selected.releaseSequence,
      'Bundle 数量：' + Object.keys(selected.bundles || {}).length,
      '版本清单：' + selected.releaseFile
    ].join('\n')
    : '尚未选择发布记录。';
  panel.$.releaseJson.value = state.selectedFile && state.selectedFile.text || '';
}

function renderState(panel) {
  const state = currentState || {};
  panel.$.status.textContent = state.status || '就绪';
  panel.$.stop.disabled = !state.busy;
  panel.$.validate.disabled = !!state.busy;
  panel.$.buildResources.disabled = !!state.busy;
  panel.$.buildSelectedBundles.disabled = !!state.busy;
  panel.$.baseApk.disabled = !!state.busy;
  panel.$.resume.disabled = !!state.busy;
  const config = state.config;
  panel.$.buildSummary.textContent = config
    ? [
      '配置：' + config.file,
      '环境：' + formatEnvironment(config.environment),
      '本次发布：' + config.releaseId + ' / ' + config.releaseSequence,
      '版本来源：' + (config.versionManagedByState ? '上次成功记录自动 +1' : '首次/重置手动起点'),
      '真实构建：' + (config.confirmed ? '已允许' : '已锁定')
    ].join('\n')
    : '配置不可用。';
  panel.$.baseSummary.textContent = config
    ? [
      '环境：' + formatEnvironment(config.environment),
      '本次 APK：' + config.versionName + ' (' + config.versionCode + ')' +
        (config.previousVersionCode ? '，上次 ' + config.previousVersionCode : ''),
      'APK 内容：base' + (Object.keys(config.bundles || {}).filter(function (name) {
        return config.bundles[name].includeInApk;
      }).map(function (name) { return ' + ' + name; }).join('')),
      '真实构建：' + (config.confirmed ? '已允许' : '已锁定')
    ].join('\n')
    : '配置不可用。';
  panel.$.resourceSummary.textContent = config
    ? [
      '环境：' + formatEnvironment(config.environment),
      '本次发布：' + config.releaseId + ' / ' + config.releaseSequence +
        (config.previousReleaseSequence ? '，上次 ' + config.previousReleaseSequence : ''),
      '固定包含：base（完整 Creator 构建）',
      '大厅分发：' + (config.environmentConfig && config.environmentConfig.hallBundle || 'hall'),
      '可选大厅：' + (config.componentRelease && (config.componentRelease.hallBundles || []).join(', ') || 'hall'),
      '当前交付：' + (config.pipeline && config.pipeline.hotfixMode === 'full_zip' ? '变化 Bundle 完整 ZIP' : 'Bundle 内逐文件增量')
    ].join('\n')
    : '配置不可用。';
  panel.$.bundleSummary.textContent = config
    ? [
      '环境：' + formatEnvironment(config.environment),
      '本次发布：' + config.releaseId + ' / ' + config.releaseSequence,
      '构建策略：Creator 官方 Bundle-only，不构建 base，不执行 Gradle'
    ].join('\n')
    : '配置不可用。';
  const publish = state.publish;
  panel.$.publishSummary.textContent = publish
    ? ['当前发布：' + publish.releaseId, '完整发布目录：' + publish.publishDirectoryRoot, '本次新增 Bundle：' + ((publish.bundleDirectories || []).join('\n') || '无'), '版本 Manifest：' + publish.manifestFile, '后台 JSON：' + publish.backendFile].join('\n')
    : '还没有可发布的资源结果。';
  panel.$.openPublishDirectory.disabled = !publish || !publish.publishDirectoryRoot || !!state.busy;
  panel.$.copyVersionManifest.disabled = !publish || !publish.manifestFile || !!state.busy;
  panel.$.copyBackendJson.disabled = !publish || !publish.backendJsonText || !!state.busy;
  panel.$.logs.value = formatLogText(state);
  panel.$.logs.scrollTop = panel.$.logs.scrollHeight;
  panel.$.error.textContent = state.error || '';
  panel.$.error.style.display = state.error ? 'block' : 'none';
  const completion = state.completion;
  panel.$.completionResult.style.display = completion ? 'flex' : 'none';
  panel.$.completionTitle.textContent = completion && completion.title || '';
  panel.$.completionPaths.textContent = completion ? [
    completion.apkPath ? '基础 APK：' + completion.apkPath : '',
    completion.nativeUpdateFile ? '后台更新配置：' + completion.nativeUpdateFile : '',
    completion.componentReleaseFile ? '版本清单：' + completion.componentReleaseFile : '',
    completion.changedComponents && completion.changedComponents.length ? '变化 Bundle：' + completion.changedComponents.join(', ') : '',
    completion.componentUploadPaths && completion.componentUploadPaths.length ? '最小上传：\n' + completion.componentUploadPaths.join('\n') : '',
    completion.publishDirectoryRoot ? '本次完整发布目录：' + completion.publishDirectoryRoot : '',
    completion.archiveHotfixDirectory ? '热更归档：' + completion.archiveHotfixDirectory : '',
    completion.archiveApkPath ? 'APK 归档：' + completion.archiveApkPath : ''
  ].filter(Boolean).join('\n') : '';
  panel.$.openApkResult.style.display = completion && completion.apkDirectory ? 'inline-flex' : 'none';
  panel.$.openHotUpdateResult.style.display = completion && completion.hotUpdateRoot ? 'inline-flex' : 'none';
  renderConfig(panel, config);
  renderReleases(panel, state);
}

function readForm(panel) {
  const environment = panel.$.environment.value;
  const currentBundles = currentState && currentState.config && currentState.config.bundles || {};
  const apkBundles = new Set(selectedBundles(panel, 'apkBundleSelection'));
  return {
    environment: environment,
    releaseSequence: Number(panel.$.releaseSequence.value),
    versionCode: Number(panel.$.versionCode.value),
    versionName: panel.$.versionName.value,
    confirmed: panel.$.confirmed.checked,
    environmentConfig: {
      appName: panel.$.appName.value,
      packageName: panel.$.packageName.value,
      baseUrl: panel.$.baseUrl.value,
      outputRoot: panel.$.outputRoot.value,
      apkInstallMode: panel.$.apkInstallMode.value,
      apkDownloadUrl: panel.$.apkDownloadUrl.value,
      apkUpdateDesc: panel.$.apkUpdateDesc.value,
      hotfixUpdateDesc: panel.$.hotfixUpdateDesc.value,
      hallBundle: panel.$.hallBundle.value
    },
    componentRelease: {
      enabled: true,
      hallBundles: panel.$.hallBundles.value
    },
    creator: {
      executable: panel.$.creatorExecutable.value,
      sdkPath: panel.$.sdkPath.value,
      ndkPath: panel.$.ndkPath.value,
      javaHome: panel.$.javaHome.value,
      appABIs: panel.$.appABIs.value
    },
    signing: Object.assign({}, currentState && currentState.config && currentState.config.signing || {}, { required: false }),
    bundles: Object.fromEntries(Object.keys(currentBundles).map(function (name) {
      return [name, {
        requiredAtStartup: !!currentBundles[name].requiredAtStartup,
        includeInApk: apkBundles.has(name)
      }];
    })),
    pipeline: {
      runChecks: panel.$.runChecks.checked,
      stateFile: panel.$.stateFile.value,
      reportRoot: panel.$.reportRoot.value,
      artifactRoot: panel.$.artifactRoot.value,
      archiveRoot: panel.$.archiveRoot.value,
      hotfixMode: panel.$.hotfixMode.value
    }
  };
}

function formatLogText(state) {
  const lines = state.logs && state.logs.length
    ? state.logs.map(function (entry) { return '[' + entry.time + '][' + entry.source + '] ' + entry.message; })
    : [];
  if (state.error) lines.push('[error] ' + state.error);
  return lines.length ? lines.join('\n') : '暂无日志。';
}

async function copyText(value) {
  if (!value || value === '暂无日志。') throw new Error('当前没有可复制的日志');
  if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
    try {
      await navigator.clipboard.writeText(value);
      return;
    } catch (error) {
      // Creator 的 clipboard 权限可能不可用，继续使用 DOM 复制回退。
    }
  }
  const textarea = document.createElement('textarea');
  textarea.value = value;
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.select();
  const copied = document.execCommand('copy');
  textarea.remove();
  if (!copied) throw new Error('系统剪贴板复制失败');
}

async function openPath(panel, target) {
  if (!target) return;
  try {
    currentState = await Editor.Message.request(PACKAGE_NAME, 'open-path', target);
  } catch (error) {
    currentState = await Editor.Message.request(PACKAGE_NAME, 'get-state');
    currentState.error = currentState.error || String(error && (error.message || error));
  }
  renderState(panel);
}

async function saveForm(panel) {
  currentState = await Editor.Message.request(PACKAGE_NAME, 'save-config', readForm(panel));
  formDirty = false;
  formInitialized = false;
  renderState(panel);
}

async function runMode(panel, mode, extra, runOptions) {
  const options = runOptions || {};
  try {
    await saveForm(panel);
    currentState = await Editor.Message.request(PACKAGE_NAME, 'run-pipeline', Object.assign({
      mode: mode,
      environment: panel.$.environment.value,
      skipChecks: options.skipChecks === true,
      skipCreator: options.skipCreator === true
    }, extra || {}));
  } catch (error) {
    currentState = await Editor.Message.request(PACKAGE_NAME, 'get-state');
    currentState.error = currentState.error || String(error && (error.message || error));
  }
  renderState(panel);
}

function switchTab(panel, name) {
  activeTab = name;
  Array.from(panel.$.tabs.querySelectorAll('.tab')).forEach(function (tab) {
    tab.classList.toggle('active', tab.dataset.tab === name);
  });
  Array.from(panel.$.pages.querySelectorAll('.page')).forEach(function (page) {
    page.classList.toggle('active', page.id === name);
  });
}

exports.methods = {
  updateState: function (next) {
    currentState = next;
    renderState(this);
  }
};

exports.ready = async function ready() {
  const panel = this;
  Array.from(this.$.tabs.querySelectorAll('.tab')).forEach(function (tab) {
    tab.addEventListener('click', function () { switchTab(panel, tab.dataset.tab); });
  });
  const configKeys = [
    'releaseSequence', 'versionCode', 'versionName', 'confirmed', 'runChecks',
    'appName', 'packageName', 'baseUrl', 'outputRoot', 'apkInstallMode', 'apkDownloadUrl', 'apkUpdateDesc', 'hotfixUpdateDesc', 'hallBundle', 'hallBundles', 'creatorExecutable', 'sdkPath',
    'ndkPath', 'javaHome', 'appABIs',
    'stateFile', 'reportRoot', 'artifactRoot', 'archiveRoot', 'hotfixMode'
  ];
  configKeys.forEach(function (key) {
    panel.$[key].addEventListener('input', function () { formDirty = true; });
    panel.$[key].addEventListener('change', function () { formDirty = true; });
  });
  this.$.environment.addEventListener('change', function () {
    if (currentState && currentState.config) loadEnvironmentFields(panel, currentState.config, panel.$.environment.value);
    formDirty = true;
  });
  this.$.saveConfig.addEventListener('confirm', function () { void saveForm(panel); });
  this.$.refresh.addEventListener('confirm', async function () {
    currentState = await Editor.Message.request(PACKAGE_NAME, 'refresh-releases');
    formDirty = false;
    formInitialized = false;
    renderState(panel);
  });
  this.$.validate.addEventListener('confirm', function () { void runMode(panel, 'validate', { dryRun: true }); });
  this.$.buildResources.addEventListener('confirm', function () {
    void runMode(panel, 'resources', {
      selectedBundles: ['base'].concat(selectedBundles(panel, 'resourceBundleSelection'))
    }, {
      skipChecks: panel.$.resourceSkipChecks.checked,
      skipCreator: panel.$.resourceSkipCreator.checked
    });
  });
  this.$.buildSelectedBundles.addEventListener('confirm', function () {
    const bundles = selectedBundles(panel, 'bundleSelection');
    if (!bundles.length) {
      if (currentState) currentState.error = '请至少勾选一个 Bundle。';
      renderState(panel);
      return;
    }
    void runMode(panel, 'bundle', { selectedBundles: bundles }, {
      skipChecks: panel.$.bundleSkipChecks.checked,
      skipCreator: panel.$.bundleSkipCreator.checked
    });
  });
  this.$.selectAllBundles.addEventListener('confirm', function () {
    Array.from(panel.$.bundleSelection.querySelectorAll('input[data-bundle]')).forEach(function (input) { input.checked = true; });
  });
  this.$.clearBundles.addEventListener('confirm', function () {
    Array.from(panel.$.bundleSelection.querySelectorAll('input[data-bundle]')).forEach(function (input) { input.checked = false; });
  });
  this.$.selectAllApkBundles.addEventListener('confirm', function () {
    Array.from(panel.$.apkBundleSelection.querySelectorAll('input[data-bundle]')).forEach(function (input) { input.checked = true; });
    formDirty = true;
  });
  this.$.clearApkBundles.addEventListener('confirm', function () {
    Array.from(panel.$.apkBundleSelection.querySelectorAll('input[data-bundle]')).forEach(function (input) { input.checked = false; });
    formDirty = true;
  });
  this.$.selectAllResourceBundles.addEventListener('confirm', function () {
    Array.from(panel.$.resourceBundleSelection.querySelectorAll('input[data-bundle]')).forEach(function (input) { input.checked = true; });
  });
  this.$.clearResourceBundles.addEventListener('confirm', function () {
    Array.from(panel.$.resourceBundleSelection.querySelectorAll('input[data-bundle]')).forEach(function (input) { input.checked = false; });
  });
  this.$.selectAllResourceBundles.addEventListener('confirm', function () {
    Array.from(panel.$.resourceBundleSelection.querySelectorAll('input[data-bundle]')).forEach(function (input) { input.checked = true; });
  });
  this.$.clearResourceBundles.addEventListener('confirm', function () {
    Array.from(panel.$.resourceBundleSelection.querySelectorAll('input[data-bundle]')).forEach(function (input) { input.checked = false; });
  });
  this.$.selectAllApkBundles.addEventListener('confirm', function () {
    Array.from(panel.$.apkBundleSelection.querySelectorAll('input[data-bundle]')).forEach(function (input) { input.checked = true; });
    formDirty = true;
  });
  this.$.clearApkBundles.addEventListener('confirm', function () {
    Array.from(panel.$.apkBundleSelection.querySelectorAll('input[data-bundle]')).forEach(function (input) { input.checked = false; });
    formDirty = true;
  });
  this.$.baseApk.addEventListener('confirm', function () {
    void runMode(panel, 'base-apk', {}, {
      skipChecks: panel.$.baseSkipChecks.checked,
      skipCreator: panel.$.baseSkipCreator.checked
    });
  });
  this.$.resume.addEventListener('confirm', function () {
    void runMode(panel, 'base-apk', { resume: true }, {
      skipChecks: panel.$.baseSkipChecks.checked,
      skipCreator: panel.$.baseSkipCreator.checked
    });
  });
  this.$.stop.addEventListener('confirm', async function () {
    currentState = await Editor.Message.request(PACKAGE_NAME, 'stop-pipeline');
    renderState(panel);
  });
  this.$.clearLogs.addEventListener('confirm', function () {
    if (currentState) currentState.logs = [];
    renderState(panel);
  });
  this.$.copyLogs.addEventListener('confirm', async function () {
    try {
      await copyText(formatLogText(currentState || {}));
      panel.$.status.textContent = '日志已复制';
    } catch (error) {
      if (currentState) currentState.error = String(error && (error.message || error));
      renderState(panel);
    }
  });
  this.$.openApkResult.addEventListener('confirm', function () {
    const target = currentState && currentState.completion && currentState.completion.apkDirectory;
    void openPath(panel, target);
  });
  this.$.openHotUpdateResult.addEventListener('confirm', function () {
    const target = currentState && currentState.completion && currentState.completion.hotUpdateRoot;
    void openPath(panel, target);
  });
  this.$.openPublishDirectory.addEventListener('confirm', function () {
    void openPath(panel, currentState && currentState.publish && currentState.publish.publishDirectoryRoot);
  });
  this.$.copyVersionManifest.addEventListener('confirm', async function () {
    try {
      currentState = await Editor.Message.request(PACKAGE_NAME, 'copy-publish-manifest');
    } catch (error) {
      currentState = await Editor.Message.request(PACKAGE_NAME, 'get-state');
      currentState.error = String(error && (error.message || error));
    }
    renderState(panel);
  });
  this.$.copyBackendJson.addEventListener('confirm', async function () {
    try {
      await copyText(currentState && currentState.publish && currentState.publish.backendJsonText || '');
      panel.$.status.textContent = '后台 JSON 已复制';
    } catch (error) {
      if (currentState) currentState.error = String(error && (error.message || error));
      renderState(panel);
    }
  });
  this.$.reloadReleases.addEventListener('confirm', async function () {
    currentState = await Editor.Message.request(PACKAGE_NAME, 'refresh-releases');
    renderState(panel);
  });
  this.$.releaseSelect.addEventListener('change', async function () {
    if (!panel.$.releaseSelect.value) return;
    currentState = await Editor.Message.request(PACKAGE_NAME, 'select-release', panel.$.releaseSelect.value);
    renderState(panel);
  });
  this.$.releaseFile.addEventListener('change', async function () {
    const releaseDir = currentState && currentState.selectedRelease && currentState.selectedRelease.releaseDir;
    if (!releaseDir) return;
    currentState = await Editor.Message.request(PACKAGE_NAME, 'load-release-file', {
      releaseFile: currentState.selectedRelease.releaseFile,
      relativePath: panel.$.releaseFile.value
    });
    renderState(panel);
  });
  this.$.openRelease.addEventListener('confirm', function () {
    const releaseDir = currentState && currentState.selectedRelease && currentState.selectedRelease.releaseDir;
    void openPath(panel, releaseDir);
  });
  currentState = await Editor.Message.request(PACKAGE_NAME, 'get-state');
  renderState(this);
  await Editor.Message.request(PACKAGE_NAME, 'panel-ready');
};

exports.close = function close() {
  formInitialized = false;
  formDirty = false;
  activeTab = 'common';
};
