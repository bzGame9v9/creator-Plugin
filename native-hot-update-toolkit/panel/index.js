'use strict';

const PACKAGE_NAME = 'native-hot-update-toolkit';
let currentState = null;
let activeTab = 'common';
let activeWorkspace = 'android';
let formInitialized = false;
let formDirty = false;
let webFormEnvironment = '';
let webFormDirty = false;
let completionDismissed = false;

exports.template = [
  '<div class="shell">',
  '  <header class="topbar">',
  '    <div class="identity"><h1>项目发布中心</h1><span id="status" class="status">就绪</span></div>',
  '    <label class="environment">运行环境<select id="environment"><option value="dev">开发（dev）</option><option value="test">测试（test）</option><option value="prod">正式（prod）</option></select></label>',
  '    <div class="top-actions"><ui-button id="saveConfig" class="primary">保存配置</ui-button><ui-button id="refresh">刷新</ui-button><ui-button id="stop" disabled>停止</ui-button></div>',
  '  </header>',
  '  <nav id="workspaceTabs" class="workspace-tabs">',
  '    <button class="workspace-tab active" data-workspace="android">Android Bundle 发布中心</button>',
  '    <button class="workspace-tab" data-workspace="web">Web 打包</button>',
  '  </nav>',
  '  <div id="androidWorkspace" class="workspace android-workspace active">',
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
  '        <label>资源热更版本（1001～9999）<input id="releaseSequence" type="number" min="1001" max="9999" step="1"></label>',
  '        <div class="version-confirm"><ui-button id="confirmReleaseSequence" class="primary">确定热更序号</ui-button><span id="releaseSequenceStatus">修改后请点确定</span></div>',
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
  '      <div class="section-title">Android APK 签名</div>',
  '      <div class="summary">Debug 密钥只适合本地测试；准备发布或升级同一个线上 App 时，必须始终使用同一份正式密钥库、别名和密码。</div>',
  '      <div class="toggle-row"><label><input id="useDebugKeystore" type="checkbox">使用 Creator Debug 密钥（仅本地测试）</label></div>',
  '      <div class="form-grid">',
  '        <label class="span-2">密钥库文件（Keystore）<input id="keystorePath" type="text" autocomplete="off"></label>',
  '        <label>密钥库密码<input id="keystorePassword" type="password" autocomplete="new-password"></label>',
  '        <label>密钥别名（Alias）<input id="keystoreAlias" type="text" autocomplete="off"></label>',
  '        <label>别名密码<input id="keystoreAliasPassword" type="password" autocomplete="new-password"></label>',
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
  '        <label>APK versionCode（同时作为 Android 显示版本）<input id="versionCode" type="number" min="1" step="1"></label>',
  '      </div>',
  '      <div class="version-confirm"><ui-button id="confirmApkVersion" class="primary">确定 APK 版本</ui-button><span id="apkVersionStatus">修改后请点确定</span></div>',
  '      <div class="section-title">渠道包</div>',
  '      <div class="summary">一次构建共用当前 versionCode；Creator 资源只构建一次，再为每个选中渠道分别生成 APK。</div>',
  '      <div class="action-row compact"><ui-button id="selectAllChannels">全选渠道</ui-button><ui-button id="clearChannels">清空</ui-button></div>',
  '      <div id="channelSelection" class="bundle-selection channel-selection"></div>',
  '      <div id="channelConfigPath" class="path-line"></div>',
  '      <div class="section-title">后台 APK 强更配置</div>',
  '      <div class="form-grid">',
  '        <label>安装方式<select id="apkInstallMode"><option value="direct_apk">直接下载 APK</option><option value="google_play">Google Play</option></select></label>',
  '        <label class="span-2">APK 根地址（客户端拼接 渠道/versionCode.apk）<input id="apkDownloadUrl" type="url"></label>',
  '        <label class="span-2">APK 更新提示<input id="apkUpdateDesc" type="text"></label>',
  '      </div>',
  '      <div class="section-title">打入 APK 的 Bundle</div>',
  '      <div class="action-row compact"><ui-button id="selectAllApkBundles">全选完整包</ui-button><ui-button id="clearApkBundles">只保留 base</ui-button></div>',
  '      <div id="apkBundleSelection" class="bundle-selection"></div>',
  '      <div class="summary">base 固定内置；勾选的 Bundle 直接打入 APK。只要仍有远程 Bundle，本页会强制用同一次 Creator 输出同步生成下一资源版本、变化 Bundle 和 Manifest，避免 APK base 与 CDN 不一致。</div>',
  '      <div class="toggle-row"><label><input type="checkbox" checked disabled>空包 APK 强制同步生成资源包与最新 Manifest</label></div>',
  '      <div class="section-title">基础包执行选项</div>',
  '      <div class="run-options"><label class="option-with-help"><input id="baseSkipChecks" type="checkbox"><span>跳过发布前检查</span><span class="help-tip" tabindex="0" data-tooltip="跳过配置中 checks 列出的代码、Bundle 边界、类型和热更测试，仅节省检查时间，不会跳过 Creator 构建或 Gradle。只适合本轮检查已通过且检查后代码与资源没有变化的情况；正式出包不建议勾选。">i</span></label><label class="option-with-help"><input id="baseSkipCreator" type="checkbox"><span>复用已有 Creator data</span><span class="help-tip" tabindex="0" data-tooltip="不再调用 Creator 构建资源，直接使用 build/android/data 和现有 Android 工程继续生成 APK。只适合刚完成一次成功 Creator 构建，且源码、资源、Bundle 配置、包名和构建选项都未变化的情况；目录被删除、构建中断或内容陈旧时严禁勾选。">i</span></label></div>',
  '      <div class="action-row"><ui-button id="baseApk" class="danger">生成渠道 APK + 同步资源</ui-button><ui-button id="resume">恢复渠道包</ui-button></div>',
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
  '  </div>',
  '  <section id="webWorkspace" class="workspace web-workspace">',
  '    <div class="section-title">关键 SDK 配置</div>',
  '    <div id="webSummary" class="summary"></div>',
  '    <div class="form-grid web-key-config">',
  '      <label class="span-2">Google 登录 Client ID<input id="webGoogleClientId" type="text"></label>',
  '      <label>LiveChat ID<input id="webLiveChatId" type="text" inputmode="numeric"></label>',
  '      <label>Facebook App ID<input id="webFacebookAppId" type="text" inputmode="numeric"></label>',
  '      <label class="span-2">当前环境 ThinkingData AppId<input id="webThinkingDataAppId" type="text"></label>',
  '    </div>',
  '    <div class="section-title">HTML Meta 配置</div>',
  '    <div class="web-meta-scroll">',
  '      <div class="form-grid">',
  '        <label class="span-2">页面标题（title）<input id="webTitle" type="text"></label>',
  '        <label class="span-2">页面描述（description）<textarea id="webDescription" rows="3"></textarea></label>',
  '        <label class="span-2">分享标题（og:title）<input id="webOgTitle" type="text"></label>',
  '        <label class="span-2">分享描述（og:description）<textarea id="webOgDescription" rows="3"></textarea></label>',
  '        <label class="span-2">分享图片路径或 URL（og:image）<input id="webOgImage" type="text"></label>',
  '        <div class="web-share-image span-2">',
  '          <div id="webShareImageDrop" class="web-share-image-drop" tabindex="0">',
  '            <img id="webShareImagePreview" alt="分享卡片图片预览">',
  '            <div class="web-share-image-hint"><strong>分享卡片图片</strong><span id="webShareImageInfo">拖入图片或点击替换</span></div>',
  '            <input id="webShareImageFile" type="file" accept="image/jpeg,image/png,image/webp,image/gif" hidden>',
  '          </div>',
  '        </div>',
  '        <label class="span-2">Twitter 标题<input id="webTwitterTitle" type="text"></label>',
  '        <label class="span-2">Twitter 描述<textarea id="webTwitterDescription" rows="3"></textarea></label>',
  '        <label class="span-2">Twitter 图片路径或 URL<input id="webTwitterImage" type="text"></label>',
  '      </div>',
  '    </div>',
  '  </section>',
  '  <section id="completionResult" class="completion-result">',
  '    <button id="closeCompletion" class="completion-close" type="button" title="关闭完成提示" aria-label="关闭完成提示">×</button>',
  '    <div class="completion-content"><strong id="completionTitle"></strong><pre id="completionPaths"></pre></div>',
  '    <div class="completion-actions"><ui-button id="openApkResult">打开 APK 目录</ui-button><ui-button id="openHotUpdateResult">打开热更目录</ui-button><ui-button id="openWebResult">打开 Web 目录</ui-button></div>',
  '  </section>',
  '  <pre id="error" class="error"></pre>',
  '  <div id="webActionBar" class="web-action-bar"><ui-button id="webSave">保存 Web 配置</ui-button><ui-button id="webBuild" class="primary">生成当前环境 Web 包</ui-button></div>',
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
  '.workspace-tabs{display:flex;gap:4px;padding:8px 12px 0;border-bottom:1px solid rgba(255,255,255,.1)}.workspace-tab{padding:10px 16px;border:1px solid rgba(255,255,255,.12);border-bottom:0;color:rgba(255,255,255,.68);background:rgba(255,255,255,.035);cursor:pointer}.workspace-tab.active{color:#fff;background:rgba(85,169,209,.2);border-color:rgba(85,169,209,.55)}',
  '.workspace{display:none;min-width:0;min-height:0;flex:1}.workspace.active{display:flex}.android-workspace{flex-direction:column}.web-workspace{box-sizing:border-box;flex-direction:column;overflow:auto;padding:16px}.web-key-config{margin-top:12px}.web-meta-scroll{padding:2px 10px 10px 2px}.web-meta-scroll textarea{min-height:64px;padding:8px;resize:vertical}.web-action-bar{display:none;flex:0 0 auto;align-items:center;gap:8px;padding:10px 16px;border-top:1px solid rgba(255,255,255,.1);background:var(--color-normal-fill)}.web-action-bar.active{display:flex}',
  '.web-share-image-drop{display:grid;grid-template-columns:minmax(220px,420px) minmax(180px,1fr);min-height:150px;align-items:center;gap:14px;padding:10px;border:1px dashed rgba(85,169,209,.55);background:rgba(255,255,255,.025);cursor:pointer}.web-share-image-drop.dragging{border-color:#8ed3f3;background:rgba(85,169,209,.1)}.web-share-image-drop img{display:block;width:100%;height:150px;object-fit:contain;background:rgba(0,0,0,.22)}.web-share-image-hint{display:flex;min-width:0;flex-direction:column;gap:6px}.web-share-image-hint span{color:rgba(255,255,255,.6);overflow-wrap:anywhere}',
  '.tabs{display:flex;gap:2px;padding:0 12px;border-bottom:1px solid rgba(255,255,255,.1);flex-wrap:wrap}',
  '.tab{padding:10px 13px;border:0;border-bottom:2px solid transparent;color:rgba(255,255,255,.65);background:transparent;cursor:pointer}.tab.active{color:#fff;border-bottom-color:#55a9d1}',
  'main{min-width:0;min-height:0;flex:1;overflow:hidden}.page{display:none;height:100%;box-sizing:border-box;overflow:auto;padding:16px}.page.active{display:block}',
  'input,select,textarea{box-sizing:border-box;border:1px solid rgba(255,255,255,.16);border-radius:3px;outline:0;color:inherit;background:rgba(0,0,0,.18)}',
  'select option{color:#202124;background:#fff}select option:disabled{color:#777}',
  'input,select{height:30px;padding:0 8px}input:focus,select:focus,textarea:focus{border-color:#55a9d1}',
  '.run-options,.toggle-row{margin-top:12px}.run-options label,.toggle-row label{display:flex;align-items:center;gap:5px;color:rgba(255,255,255,.72)}.action-row{margin-top:18px;padding-top:12px;border-top:1px solid rgba(255,255,255,.1)}',
  '.summary{margin-top:12px;padding:9px 11px;line-height:1.65;background:rgba(255,255,255,.05);white-space:pre-wrap;overflow-wrap:anywhere}',
  '.completion-result{position:relative;display:none;align-items:center;gap:16px;padding:10px 46px 10px 16px;border-top:1px solid rgba(90,190,125,.35);background:rgba(45,130,75,.14)}.completion-close{position:absolute;top:8px;right:10px;width:28px;height:28px;padding:0;border:0;color:rgba(255,255,255,.72);background:transparent;font:22px/1 sans-serif;cursor:pointer}.completion-close:hover,.completion-close:focus{color:#fff;background:rgba(255,255,255,.1)}.completion-content{min-width:0;flex:1}.completion-content strong{color:#9fe2b4}.completion-content pre{margin:4px 0 0;color:rgba(255,255,255,.72);font:12px/1.5 Consolas,"Courier New",monospace;white-space:pre-wrap;overflow-wrap:anywhere}.completion-actions{display:flex;gap:8px;flex-wrap:wrap}',
  '.execution-log{flex:0 0 220px;min-height:0;box-sizing:border-box;padding:9px 16px 12px;border-top:1px solid rgba(255,255,255,.1)}.log-head strong{margin-right:auto}.logs{width:100%;height:168px;box-sizing:border-box;overflow:auto;margin:7px 0 0;padding:10px;resize:none;color:#d6e4eb;background:rgba(0,0,0,.22);white-space:pre;user-select:text;cursor:text}',
  '.section-title{margin:18px 0 10px;padding-bottom:6px;border-bottom:1px solid rgba(255,255,255,.1);font-weight:600}.section-title:first-child{margin-top:0}',
  '.form-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px 14px}.form-grid label{display:flex;min-width:0;flex-direction:column;gap:5px;color:rgba(255,255,255,.72)}.span-2{grid-column:span 2}',
  '.bundle-table{display:grid;grid-template-columns:70px 130px 100px minmax(220px,1fr) 80px;gap:7px;align-items:center}.bundle-policy{display:grid;grid-template-columns:120px 120px;gap:8px;align-items:center}.bundle-table input[type=checkbox],.bundle-policy input[type=checkbox]{justify-self:center}.bundle-head{font-weight:600;color:rgba(255,255,255,.7)}',
  '.bundle-selection{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:8px 12px;margin:8px 0 12px}.bundle-choice{display:flex;align-items:center;gap:8px;padding:8px 10px;border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.035)}',
  '.channel-selection{grid-template-columns:minmax(0,1fr);max-height:280px;overflow:auto;padding-right:6px}.channel-selection .bundle-choice{min-height:20px}.channel-selection .bundle-choice span{min-width:0;overflow-wrap:anywhere}',
  '.version-confirm{display:flex;align-items:center;gap:10px;min-height:32px;margin:8px 0 12px}.version-confirm span{color:rgba(255,255,255,.62);font-size:12px}.version-confirm span.pending{color:#f0c86a}.version-confirm span.applied{color:#78d59b}',
  '.option-with-help{position:relative}.help-tip{position:relative;display:inline-flex;width:16px;height:16px;flex:0 0 16px;align-items:center;justify-content:center;border:1px solid rgba(255,255,255,.35);border-radius:50%;font:600 11px/1 sans-serif;color:#b9dceb;cursor:help}.help-tip::after{position:absolute;z-index:20;left:50%;bottom:calc(100% + 8px);width:340px;max-width:70vw;padding:9px 11px;border:1px solid rgba(85,169,209,.55);border-radius:3px;color:#eef7fb;background:#20272c;box-shadow:0 5px 18px rgba(0,0,0,.35);font:12px/1.55 sans-serif;white-space:normal;content:attr(data-tooltip);opacity:0;pointer-events:none;transform:translateX(-50%);transition:opacity .12s}.help-tip:hover::after,.help-tip:focus::after{opacity:1}',
  '.action-row.compact{margin-top:6px;padding-top:0;border-top:0}.publish-step{display:grid;grid-template-columns:minmax(220px,1fr) minmax(320px,2fr) auto;align-items:center;gap:12px;padding:12px 10px;border-bottom:1px solid rgba(255,255,255,.1)}.publish-step span{color:rgba(255,255,255,.7)}',
  '.path-line{margin-top:12px;color:rgba(255,255,255,.55);font:12px/1.5 Consolas,"Courier New",monospace;overflow-wrap:anywhere}',
  '.release-toolbar select:first-child{min-width:330px}.release-toolbar select:nth-child(2){min-width:220px}.json{width:100%;min-height:390px;margin-top:12px;padding:11px;resize:vertical;font:12px/1.55 Consolas,"Courier New",monospace}.json[readonly]{color:#c8d5dc}.editable{border-color:rgba(224,177,76,.45)}',
  '.error{display:none;max-height:130px;overflow:auto;margin:0;padding:10px 16px;color:#ffabab;background:rgba(165,45,45,.18);white-space:pre-wrap}',
  '@media(max-width:900px){.topbar{grid-template-columns:1fr}.form-grid{grid-template-columns:1fr}.span-2{grid-column:span 1}.bundle-table{grid-template-columns:65px 100px 85px minmax(180px,1fr) 65px}.completion-result{align-items:flex-start;flex-direction:column}.execution-log{flex-basis:190px}.logs{height:138px}}'
].join('\n');

exports.$ = {
  status: '#status', environment: '#environment', saveConfig: '#saveConfig', refresh: '#refresh',
  confirmReleaseSequence: '#confirmReleaseSequence', releaseSequenceStatus: '#releaseSequenceStatus', confirmApkVersion: '#confirmApkVersion', apkVersionStatus: '#apkVersionStatus',
  workspaceTabs: '#workspaceTabs', androidWorkspace: '#androidWorkspace', webWorkspace: '#webWorkspace', webActionBar: '#webActionBar',
  tabs: '#tabs', pages: '#pages', validate: '#validate', buildResources: '#buildResources', buildSelectedBundles: '#buildSelectedBundles', baseApk: '#baseApk', resume: '#resume', stop: '#stop',
  selectAllApkBundles: '#selectAllApkBundles', clearApkBundles: '#clearApkBundles', selectAllResourceBundles: '#selectAllResourceBundles', clearResourceBundles: '#clearResourceBundles', selectAllBundles: '#selectAllBundles', clearBundles: '#clearBundles',
  selectAllChannels: '#selectAllChannels', clearChannels: '#clearChannels', channelSelection: '#channelSelection', channelConfigPath: '#channelConfigPath',
  baseSkipChecks: '#baseSkipChecks', baseSkipCreator: '#baseSkipCreator', resourceSkipChecks: '#resourceSkipChecks', resourceSkipCreator: '#resourceSkipCreator', bundleSkipChecks: '#bundleSkipChecks', bundleSkipCreator: '#bundleSkipCreator',
  buildSummary: '#buildSummary', baseSummary: '#baseSummary', resourceSummary: '#resourceSummary', bundleSummary: '#bundleSummary', publishSummary: '#publishSummary', copyLogs: '#copyLogs', clearLogs: '#clearLogs', logs: '#logs',
  releaseSequence: '#releaseSequence', versionCode: '#versionCode',
  confirmed: '#confirmed', runChecks: '#runChecks', appName: '#appName', packageName: '#packageName',
  baseUrl: '#baseUrl', outputRoot: '#outputRoot', creatorExecutable: '#creatorExecutable', sdkPath: '#sdkPath',
  apkInstallMode: '#apkInstallMode', apkDownloadUrl: '#apkDownloadUrl', apkUpdateDesc: '#apkUpdateDesc', hotfixUpdateDesc: '#hotfixUpdateDesc',
  hallBundle: '#hallBundle', hallBundles: '#hallBundles', apkBundleSelection: '#apkBundleSelection', resourceBundleSelection: '#resourceBundleSelection', bundleSelection: '#bundleSelection',
  ndkPath: '#ndkPath', javaHome: '#javaHome', appABIs: '#appABIs',
  useDebugKeystore: '#useDebugKeystore', keystorePath: '#keystorePath', keystorePassword: '#keystorePassword', keystoreAlias: '#keystoreAlias', keystoreAliasPassword: '#keystoreAliasPassword',
  stateFile: '#stateFile', reportRoot: '#reportRoot',
  artifactRoot: '#artifactRoot', archiveRoot: '#archiveRoot', hotfixMode: '#hotfixMode', configPath: '#configPath', releaseSelect: '#releaseSelect', releaseFile: '#releaseFile',
  reloadReleases: '#reloadReleases', openRelease: '#openRelease', releaseSummary: '#releaseSummary', releaseJson: '#releaseJson', error: '#error',
  openPublishDirectory: '#openPublishDirectory', copyVersionManifest: '#copyVersionManifest', copyBackendJson: '#copyBackendJson',
  webSummary: '#webSummary', webSave: '#webSave', webBuild: '#webBuild',
  webGoogleClientId: '#webGoogleClientId', webLiveChatId: '#webLiveChatId', webFacebookAppId: '#webFacebookAppId', webThinkingDataAppId: '#webThinkingDataAppId',
  webTitle: '#webTitle', webDescription: '#webDescription', webOgTitle: '#webOgTitle', webOgDescription: '#webOgDescription', webOgImage: '#webOgImage',
  webTwitterTitle: '#webTwitterTitle', webTwitterDescription: '#webTwitterDescription', webTwitterImage: '#webTwitterImage',
  webShareImageDrop: '#webShareImageDrop', webShareImagePreview: '#webShareImagePreview', webShareImageInfo: '#webShareImageInfo', webShareImageFile: '#webShareImageFile',
  completionResult: '#completionResult', closeCompletion: '#closeCompletion', completionTitle: '#completionTitle', completionPaths: '#completionPaths',
  openApkResult: '#openApkResult', openHotUpdateResult: '#openHotUpdateResult', openWebResult: '#openWebResult'
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

function syncAndroidSigningControls(panel) {
  const useDebugKeystore = panel.$.useDebugKeystore.checked;
  ['keystorePath', 'keystorePassword', 'keystoreAlias', 'keystoreAliasPassword'].forEach(function (key) {
    panel.$[key].disabled = useDebugKeystore;
  });
}

function loadEnvironmentFields(panel, config, environment) {
  const item = config && config.environments && config.environments[environment] || {};
  setValue(panel, 'releaseSequence', item.releaseSequence);
  setValue(panel, 'versionCode', item.versionCode || config.versionCode);
  setVersionFieldsManaged(panel, environment, item.hasPreviousRelease === true);
  panel.$.releaseSequenceStatus.className = item.releaseSequenceConfirmed ? 'applied' : '';
  panel.$.releaseSequenceStatus.textContent = environment === 'prod'
    ? '正式服自动管理'
    : (item.releaseSequenceConfirmed ? '已生效：' + environment + '_' + item.releaseSequence : '当前为建议值，修改后请点确定');
  panel.$.apkVersionStatus.className = item.versionCodeConfirmed ? 'applied' : '';
  panel.$.apkVersionStatus.textContent = item.versionCodeConfirmed
    ? '已生效：versionCode ' + item.versionCode
    : '当前为建议值，修改后请点确定';
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

function setVersionFieldsManaged(panel, environment, managed) {
  const productionManaged = environment === 'prod';
  panel.$.releaseSequence.disabled = productionManaged;
  panel.$.confirmReleaseSequence.disabled = productionManaged;
  panel.$.releaseSequence.title = productionManaged
    ? (managed ? '正式服根据上次成功发布自动加 1' : '正式服首次固定从 1001 开始')
    : (managed ? '建议值为上次成功发布 +1，可自由修改' : '可自由指定热更序号');
  panel.$.versionCode.disabled = false;
  panel.$.versionCode.title = managed ? '建议值为上次成功版本 +1，可自由修改并按填写值构建' : '可自由指定 APK versionCode';
}

function renderConfig(panel, config) {
  if (!config || formDirty) return;
  setValue(panel, 'environment', config.environment);
  setValue(panel, 'versionCode', config.versionCode);
  setChecked(panel, 'confirmed', config.confirmed);
  setChecked(panel, 'runChecks', config.pipeline && config.pipeline.runChecks);
  loadEnvironmentFields(panel, config, config.environment);
  setValue(panel, 'creatorExecutable', config.creator && config.creator.executable);
  setValue(panel, 'sdkPath', config.creator && config.creator.sdkPath);
  setValue(panel, 'ndkPath', config.creator && config.creator.ndkPath);
  setValue(panel, 'javaHome', config.creator && config.creator.javaHome);
  setValue(panel, 'appABIs', config.creator && (config.creator.appABIs || []).join(','));
  setChecked(panel, 'useDebugKeystore', config.creator && config.creator.useDebugKeystore);
  setValue(panel, 'keystorePath', config.creator && config.creator.keystorePath);
  setValue(panel, 'keystorePassword', config.creator && config.creator.keystorePassword);
  setValue(panel, 'keystoreAlias', config.creator && config.creator.keystoreAlias);
  setValue(panel, 'keystoreAliasPassword', config.creator && config.creator.keystoreAliasPassword);
  syncAndroidSigningControls(panel);
  renderConfiguredBundleChoices(panel, 'apkBundleSelection', config, function (bundle) { return bundle.includeInApk === true; });
  renderConfiguredBundleChoices(panel, 'resourceBundleSelection', config, function () { return false; });
  renderConfiguredBundleChoices(panel, 'bundleSelection', config, function () { return false; });
  renderChannelChoices(panel, config.channelConfig);
  setValue(panel, 'stateFile', config.pipeline && config.pipeline.stateFile);
  setValue(panel, 'reportRoot', config.pipeline && config.pipeline.reportRoot);
  setValue(panel, 'artifactRoot', config.pipeline && config.pipeline.artifactRoot);
  setValue(panel, 'archiveRoot', config.pipeline && config.pipeline.archiveRoot);
  setValue(panel, 'hotfixMode', config.pipeline && config.pipeline.hotfixMode || 'incremental');
  setValue(panel, 'hallBundles', config.componentRelease && (config.componentRelease.hallBundles || []).join(',') || 'hall');
  panel.$.configPath.textContent = config.file || '';
  formInitialized = true;
}

function renderChannelChoices(panel, channelConfig) {
  const config = channelConfig || { channels: [], defaultChannels: [] };
  const defaults = new Set(config.defaultChannels || []);
  panel.$.channelSelection.innerHTML = (config.channels || []).map(function (channel) {
    const disabled = channel.enabled ? '' : ' disabled';
    const checked = channel.enabled && defaults.has(channel.id) ? ' checked' : '';
    return '<label class="bundle-choice"><input type="checkbox" data-channel="' + escapeHtml(channel.id) + '"' + checked + disabled + '>' +
      '<span>' + escapeHtml(channel.name) + '（' + escapeHtml(channel.id) + '）</span></label>';
  }).join('') || '<div class="summary">没有可用渠道，请先配置 channels.json。</div>';
  panel.$.channelConfigPath.textContent = config.file ? '渠道配置：' + config.file : '';
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

function selectedChannels(panel) {
  return Array.from(panel.$.channelSelection.querySelectorAll('input[data-channel]'))
    .filter(function (input) { return input.checked && !input.disabled; })
    .map(function (input) { return input.dataset.channel; });
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

function renderWebRelease(panel, web) {
  if (!web) {
    panel.$.webSummary.textContent = 'Web 配置尚未读取。';
    return;
  }
  if (!webFormDirty || webFormEnvironment !== web.environment) {
    const settings = web.settings || {};
    setValue(panel, 'webGoogleClientId', settings.googleClientId);
    setValue(panel, 'webLiveChatId', settings.liveChatId);
    setValue(panel, 'webFacebookAppId', settings.facebookAppId);
    setValue(panel, 'webThinkingDataAppId', settings.thinkingDataAppId);
    setValue(panel, 'webTitle', settings.title);
    setValue(panel, 'webDescription', settings.description);
    setValue(panel, 'webOgTitle', settings.ogTitle);
    setValue(panel, 'webOgDescription', settings.ogDescription);
    setValue(panel, 'webOgImage', settings.ogImage);
    setValue(panel, 'webTwitterTitle', settings.twitterTitle);
    setValue(panel, 'webTwitterDescription', settings.twitterDescription);
    setValue(panel, 'webTwitterImage', settings.twitterImage);
    webFormEnvironment = web.environment;
    webFormDirty = false;
  }
  const shareImage = web.shareImage || {};
  if (shareImage.dataUrl) panel.$.webShareImagePreview.src = shareImage.dataUrl;
  else panel.$.webShareImagePreview.removeAttribute('src');
  panel.$.webShareImageInfo.textContent = shareImage.file
    ? `${shareImage.file}（${formatBytes(shareImage.size)}）`
    : '拖入图片或点击替换';
  const firstError = web.errors && web.errors[0];
  panel.$.webSummary.textContent = [
    '当前环境：' + web.label,
    '打包命令：' + web.command,
    firstError ? '需要处理：' + firstError : '配置状态：可打包'
  ].join('\n');
}

function formatBytes(value) {
  const bytes = Number(value) || 0;
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1024 / 1024).toFixed(2) + ' MB';
}

function readWebForm(panel) {
  return {
    googleClientId: panel.$.webGoogleClientId.value.trim(),
    liveChatId: panel.$.webLiveChatId.value.trim(),
    facebookAppId: panel.$.webFacebookAppId.value.trim(),
    thinkingDataAppId: panel.$.webThinkingDataAppId.value.trim(),
    title: panel.$.webTitle.value.trim(),
    description: panel.$.webDescription.value.trim(),
    ogTitle: panel.$.webOgTitle.value.trim(),
    ogDescription: panel.$.webOgDescription.value.trim(),
    ogImage: panel.$.webOgImage.value.trim(),
    twitterTitle: panel.$.webTwitterTitle.value.trim(),
    twitterDescription: panel.$.webTwitterDescription.value.trim(),
    twitterImage: panel.$.webTwitterImage.value.trim()
  };
}

async function replaceShareImage(panel, file) {
  if (!file) return;
  try {
    if (file.size > 20 * 1024 * 1024) throw new Error('图片不能超过 20 MB');
    if (file.type && !/^image\//i.test(file.type)) throw new Error('请选择图片文件');
    panel.$.webShareImageInfo.textContent = '正在处理图片...';
    const source = await readFileDataUrl(file);
    const dataUrl = /^data:image\/jpeg;/i.test(source) ? source : await convertToJpeg(source);
    currentState = await Editor.Message.request(PACKAGE_NAME, 'replace-web-share-image', {
      environment: panel.$.environment.value,
      dataUrl: dataUrl
    });
    setValue(panel, 'webOgImage', './invite.jpg');
    setValue(panel, 'webTwitterImage', './invite.jpg');
  } catch (error) {
    if (currentState) currentState.error = String(error && (error.message || error));
  }
  panel.$.webShareImageFile.value = '';
  renderState(panel);
}

function readFileDataUrl(file) {
  return new Promise(function (resolve, reject) {
    const reader = new FileReader();
    reader.onload = function () { resolve(String(reader.result || '')); };
    reader.onerror = function () { reject(reader.error || new Error('图片读取失败')); };
    reader.readAsDataURL(file);
  });
}

function convertToJpeg(source) {
  return new Promise(function (resolve, reject) {
    const image = new Image();
    image.onload = function () {
      const canvas = document.createElement('canvas');
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const context = canvas.getContext('2d');
      if (!context || !canvas.width || !canvas.height) {
        reject(new Error('图片尺寸无效'));
        return;
      }
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0);
      resolve(canvas.toDataURL('image/jpeg', 0.92));
    };
    image.onerror = function () { reject(new Error('图片格式无法识别')); };
    image.src = source;
  });
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
  panel.$.webSave.disabled = !!state.busy;
  panel.$.webBuild.disabled = !!state.busy;
  const config = state.config;
  panel.$.buildSummary.textContent = config
    ? [
      '配置：' + config.file,
      '环境：' + formatEnvironment(config.environment),
      '业务通信版本：' + config.appVersion + '（与 APK、热更版本独立）',
      '本次发布：' + config.releaseId + ' / ' + config.releaseSequence,
      '热更序号：' + (config.environment === 'prod' ? '正式服自动管理' : '建议上次 +1，实际按填写值'),
      '真实构建：' + (config.confirmed ? '已允许' : '已锁定')
    ].join('\n')
    : '配置不可用。';
  panel.$.baseSummary.textContent = config
    ? [
      '环境：' + formatEnvironment(config.environment),
      '业务通信版本：' + config.appVersion,
      '本次 APK：versionCode ' + config.versionCode + '（Android 显示版本 ' + config.versionCode + '）' +
        (config.previousVersionCode ? '，上次 ' + config.previousVersionCode : ''),
      '同步资源版本：' + config.releaseId + '（空包 APK 强制生成）',
      '默认渠道：' + ((config.channelConfig && config.channelConfig.defaultChannels || []).join(', ') || '未配置'),
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
  panel.$.completionResult.style.display = completion && !completionDismissed ? 'flex' : 'none';
  panel.$.completionTitle.textContent = completion && completion.title || '';
  panel.$.completionPaths.textContent = completion ? [
    completion.apkPath ? '基础 APK：' + completion.apkPath : '',
    completion.nativeUpdateFile ? '后台更新配置：' + completion.nativeUpdateFile : '',
    completion.nativeUpdateFiles && Object.keys(completion.nativeUpdateFiles).length
      ? '渠道后台配置：\n' + Object.keys(completion.nativeUpdateFiles).map(function (channelId) { return channelId + '：' + completion.nativeUpdateFiles[channelId]; }).join('\n')
      : '',
    completion.componentReleaseFile ? '版本清单：' + completion.componentReleaseFile : '',
    completion.changedComponents && completion.changedComponents.length ? '变化 Bundle：' + completion.changedComponents.join(', ') : '',
    completion.componentUploadPaths && completion.componentUploadPaths.length ? '最小上传：\n' + completion.componentUploadPaths.join('\n') : '',
    completion.publishDirectoryRoot ? '本次完整发布目录：' + completion.publishDirectoryRoot : '',
    completion.archiveHotfixDirectory ? '热更归档：' + completion.archiveHotfixDirectory : '',
    completion.archiveApkPaths && completion.archiveApkPaths.length
      ? '渠道 APK：\n' + completion.archiveApkPaths.map(function (item) { return item.channelId + '：' + item.path; }).join('\n')
      : (completion.archiveApkPath ? 'APK 归档：' + completion.archiveApkPath : '')
  ].filter(Boolean).join('\n') : '';
  panel.$.openApkResult.style.display = completion && completion.apkDirectory ? 'inline-flex' : 'none';
  panel.$.openHotUpdateResult.style.display = completion && completion.hotUpdateRoot ? 'inline-flex' : 'none';
  panel.$.openWebResult.style.display = completion && completion.webBuildDirectory ? 'inline-flex' : 'none';
  if (completion && completion.webBuildDirectory) {
    panel.$.completionPaths.textContent = [
      'Web 目录：' + completion.webBuildDirectory,
      'Web ZIP：' + completion.webZipPath
    ].join('\n');
  }
  renderWebRelease(panel, state.web);
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
    versionName: String(Number(panel.$.versionCode.value) || ''),
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
      appABIs: panel.$.appABIs.value,
      useDebugKeystore: panel.$.useDebugKeystore.checked,
      keystorePath: panel.$.keystorePath.value,
      keystorePassword: panel.$.keystorePassword.value,
      keystoreAlias: panel.$.keystoreAlias.value,
      keystoreAliasPassword: panel.$.keystoreAliasPassword.value
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

async function saveForm(panel, versionConfirmation) {
  const form = readForm(panel);
  if (versionConfirmation) form.versionConfirmation = versionConfirmation;
  currentState = await Editor.Message.request(PACKAGE_NAME, 'save-config', form);
  formDirty = false;
  formInitialized = false;
  renderState(panel);
}

async function confirmVersionSettings(panel, versionConfirmation) {
  try {
    await saveForm(panel, versionConfirmation);
    if (versionConfirmation.releaseSequence) {
      panel.$.releaseSequenceStatus.className = 'applied';
      panel.$.releaseSequenceStatus.textContent = '已生效：' + panel.$.environment.value + '_' + panel.$.releaseSequence.value;
    }
    if (versionConfirmation.versionCode) {
      panel.$.apkVersionStatus.className = 'applied';
      panel.$.apkVersionStatus.textContent = '已生效：versionCode ' + panel.$.versionCode.value;
    }
  } catch (error) {
    currentState = await Editor.Message.request(PACKAGE_NAME, 'get-state');
    currentState.error = currentState.error || String(error && (error.message || error));
    renderState(panel);
  }
}

async function runMode(panel, mode, extra, runOptions) {
  const options = runOptions || {};
  try {
    completionDismissed = false;
    await saveForm(panel, mode === 'base-apk'
      ? { versionCode: true }
      : (mode === 'resources' || mode === 'bundle' ? { releaseSequence: true } : null));
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

async function refreshWebRelease(panel) {
  try {
    currentState = await Editor.Message.request(
      PACKAGE_NAME,
      'inspect-web-release',
      panel.$.environment.value
    );
  } catch (error) {
    currentState = await Editor.Message.request(PACKAGE_NAME, 'get-state');
    currentState.error = currentState.error || String(error && (error.message || error));
  }
  renderState(panel);
}

async function saveWebRelease(panel) {
  try {
    currentState = await Editor.Message.request(PACKAGE_NAME, 'save-web-release-config', {
      environment: panel.$.environment.value,
      settings: readWebForm(panel)
    });
    webFormDirty = false;
    webFormEnvironment = panel.$.environment.value;
    renderState(panel);
    return true;
  } catch (error) {
    currentState = await Editor.Message.request(PACKAGE_NAME, 'get-state');
    currentState.error = currentState.error || String(error && (error.message || error));
    renderState(panel);
    return false;
  }
}

async function runWebRelease(panel) {
  if (!await saveWebRelease(panel)) return;
  try {
    completionDismissed = false;
    currentState = await Editor.Message.request(PACKAGE_NAME, 'run-web-release', {
      environment: panel.$.environment.value
    });
  } catch (error) {
    currentState = await Editor.Message.request(PACKAGE_NAME, 'get-state');
    currentState.error = currentState.error || String(error && (error.message || error));
  }
  renderState(panel);
}

function switchWorkspace(panel, name) {
  activeWorkspace = name === 'web' ? 'web' : 'android';
  Array.from(panel.$.workspaceTabs.querySelectorAll('.workspace-tab')).forEach(function (tab) {
    tab.classList.toggle('active', tab.dataset.workspace === activeWorkspace);
  });
  panel.$.androidWorkspace.classList.toggle('active', activeWorkspace === 'android');
  panel.$.webWorkspace.classList.toggle('active', activeWorkspace === 'web');
  panel.$.webActionBar.classList.toggle('active', activeWorkspace === 'web');
  panel.$.saveConfig.style.display = activeWorkspace === 'android' ? 'inline-flex' : 'none';
  if (activeWorkspace === 'web') void refreshWebRelease(panel);
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
  Array.from(this.$.workspaceTabs.querySelectorAll('.workspace-tab')).forEach(function (tab) {
    tab.addEventListener('click', function () { switchWorkspace(panel, tab.dataset.workspace); });
  });
  Array.from(this.$.tabs.querySelectorAll('.tab')).forEach(function (tab) {
    tab.addEventListener('click', function () { switchTab(panel, tab.dataset.tab); });
  });
  const configKeys = [
    'releaseSequence', 'versionCode', 'confirmed', 'runChecks',
    'appName', 'packageName', 'baseUrl', 'outputRoot', 'apkInstallMode', 'apkDownloadUrl', 'apkUpdateDesc', 'hotfixUpdateDesc', 'hallBundle', 'hallBundles', 'creatorExecutable', 'sdkPath',
    'ndkPath', 'javaHome', 'appABIs', 'useDebugKeystore', 'keystorePath', 'keystorePassword', 'keystoreAlias', 'keystoreAliasPassword',
    'stateFile', 'reportRoot', 'artifactRoot', 'archiveRoot', 'hotfixMode'
  ];
  configKeys.forEach(function (key) {
    panel.$[key].addEventListener('input', function () {
      formDirty = true;
      if (key === 'releaseSequence') {
        panel.$.releaseSequenceStatus.className = 'pending';
        panel.$.releaseSequenceStatus.textContent = '有修改，尚未确定';
      }
      if (key === 'versionCode') {
        panel.$.apkVersionStatus.className = 'pending';
        panel.$.apkVersionStatus.textContent = '有修改，尚未确定';
      }
    });
    panel.$[key].addEventListener('change', function () { formDirty = true; });
  });
  const webConfigKeys = [
    'webGoogleClientId', 'webLiveChatId', 'webFacebookAppId', 'webThinkingDataAppId',
    'webTitle', 'webDescription', 'webOgTitle', 'webOgDescription', 'webOgImage',
    'webTwitterTitle', 'webTwitterDescription', 'webTwitterImage'
  ];
  webConfigKeys.forEach(function (key) {
    panel.$[key].addEventListener('input', function () { webFormDirty = true; });
    panel.$[key].addEventListener('change', function () { webFormDirty = true; });
  });
  this.$.webShareImageDrop.addEventListener('click', function () { panel.$.webShareImageFile.click(); });
  this.$.webShareImageDrop.addEventListener('keydown', function (event) {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      panel.$.webShareImageFile.click();
    }
  });
  this.$.webShareImageDrop.addEventListener('dragover', function (event) {
    event.preventDefault();
    panel.$.webShareImageDrop.classList.add('dragging');
  });
  this.$.webShareImageDrop.addEventListener('dragleave', function () {
    panel.$.webShareImageDrop.classList.remove('dragging');
  });
  this.$.webShareImageDrop.addEventListener('drop', function (event) {
    event.preventDefault();
    panel.$.webShareImageDrop.classList.remove('dragging');
    void replaceShareImage(panel, event.dataTransfer && event.dataTransfer.files && event.dataTransfer.files[0]);
  });
  this.$.webShareImageFile.addEventListener('change', function () {
    void replaceShareImage(panel, panel.$.webShareImageFile.files && panel.$.webShareImageFile.files[0]);
  });
  this.$.environment.addEventListener('change', function () {
    if (currentState && currentState.config) loadEnvironmentFields(panel, currentState.config, panel.$.environment.value);
    formDirty = true;
    if (activeWorkspace === 'web') {
      webFormDirty = false;
      webFormEnvironment = '';
      void refreshWebRelease(panel);
    }
  });
  this.$.saveConfig.addEventListener('confirm', function () { void saveForm(panel); });
  this.$.confirmReleaseSequence.addEventListener('confirm', function () {
    void confirmVersionSettings(panel, { releaseSequence: true });
  });
  this.$.confirmApkVersion.addEventListener('confirm', function () {
    void confirmVersionSettings(panel, { versionCode: true });
  });
  this.$.refresh.addEventListener('confirm', async function () {
    currentState = await Editor.Message.request(PACKAGE_NAME, 'refresh-releases');
    formDirty = false;
    formInitialized = false;
    renderState(panel);
  });
  this.$.validate.addEventListener('confirm', function () { void runMode(panel, 'validate', { dryRun: true }); });
  this.$.webSave.addEventListener('confirm', function () { void saveWebRelease(panel); });
  this.$.webBuild.addEventListener('confirm', function () { void runWebRelease(panel); });
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
  this.$.useDebugKeystore.addEventListener('change', function () { syncAndroidSigningControls(panel); });
  this.$.selectAllChannels.addEventListener('confirm', function () {
    Array.from(panel.$.channelSelection.querySelectorAll('input[data-channel]')).forEach(function (input) {
      if (!input.disabled) input.checked = true;
    });
  });
  this.$.clearChannels.addEventListener('confirm', function () {
    Array.from(panel.$.channelSelection.querySelectorAll('input[data-channel]')).forEach(function (input) { input.checked = false; });
  });
  this.$.baseApk.addEventListener('confirm', function () {
    const channels = selectedChannels(panel);
    if (!channels.length) {
      if (currentState) currentState.error = '请至少勾选一个渠道。';
      renderState(panel);
      return;
    }
    void runMode(panel, 'base-apk', { channels: channels }, {
      skipChecks: panel.$.baseSkipChecks.checked,
      skipCreator: panel.$.baseSkipCreator.checked
    });
  });
  this.$.resume.addEventListener('confirm', function () {
    const channels = selectedChannels(panel);
    if (!channels.length) {
      if (currentState) currentState.error = '请至少勾选一个渠道。';
      renderState(panel);
      return;
    }
    void runMode(panel, 'base-apk', { resume: true, channels: channels }, {
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
  this.$.closeCompletion.addEventListener('click', function () {
    completionDismissed = true;
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
  this.$.openWebResult.addEventListener('confirm', function () {
    const target = currentState && currentState.completion && currentState.completion.webBuildDirectory;
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
  webFormEnvironment = '';
  webFormDirty = false;
  completionDismissed = false;
  activeTab = 'common';
  activeWorkspace = 'android';
};
