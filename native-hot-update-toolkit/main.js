'use strict';

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const {
    ensureLocalConfig,
    readConfig,
    saveConfig,
    summarizeConfig,
} = require('./core/config-service');
const {
    RELEASE_FILES,
    listReleases,
    listReleaseFiles,
    loadReleaseFile,
} = require('./core/release-inspector');

const PACKAGE_NAME = 'native-hot-update-toolkit';
let activeChild = null;
let activeOperation = false;
let panelReady = false;
let state = null;

function projectRoot() {
    return global.Editor && Editor.Project && Editor.Project.path || process.cwd();
}

function initialState() {
    const root = projectRoot();
    try {
        const config = summarizeConfig(root);
        const raw = readConfig(root).value;
        return {
            status: '就绪',
            busy: false,
            projectRoot: root,
            config,
            releases: listReleases(root, raw),
            releaseFiles: RELEASE_FILES,
            selectedRelease: null,
            selectedFile: null,
            completion: null,
            publish: resolvePublishArtifacts(root, raw),
            logs: [],
            error: '',
        };
    } catch (error) {
        return {
            status: '配置不可用',
            busy: false,
            projectRoot: root,
            config: null,
            releases: [],
            releaseFiles: RELEASE_FILES,
            selectedRelease: null,
            selectedFile: null,
            completion: null,
            publish: null,
            logs: [],
            error: errorText(error),
        };
    }
}

function emitState() {
    if (!panelReady || !global.Editor || !Editor.Message) return;
    try {
        Editor.Message.send(PACKAGE_NAME, 'state-updated', state);
    } catch {
        panelReady = false;
    }
}

function setState(values) {
    state = { ...(state || initialState()), ...values, updatedAt: new Date().toISOString() };
    emitState();
    return state;
}

function appendLog(source, chunk) {
    const lines = String(chunk || '').split(/\r?\n/).filter(Boolean);
    if (!lines.length) return;
    const logs = [...(state && state.logs || [])];
    lines.forEach(message => logs.push({ time: new Date().toISOString(), source, message }));
    if (logs.length > 1000) logs.splice(0, logs.length - 1000);
    setState({ logs });
}

function refreshState() {
    const root = projectRoot();
    const config = summarizeConfig(root);
    const raw = readConfig(root).value;
    return setState({
        projectRoot: root,
        config,
        releases: listReleases(root, raw),
        publish: resolvePublishArtifacts(root, raw),
        error: '',
    });
}

function createCliArgs(cliPath, configPath, mode, environment, input, skipCreator) {
    const args = [cliPath, '--config', configPath, '--mode', mode, '--env', environment];
    if (input.dryRun === true || mode === 'validate') args.push('--dry-run');
    if (input.resume === true) args.push('--resume');
    if (input.skipChecks === true) args.push('--skip-checks');
    if (skipCreator) args.push('--skip-creator');
    if ((mode === 'bundle' || mode === 'resources') && Array.isArray(input.selectedBundles) && input.selectedBundles.length) {
        args.push('--bundles', input.selectedBundles.join(','));
    }
    return args;
}

function createEditorBuildPlan(root, configPath, mode, environment, selectedBundles = []) {
    const configModulePath = path.join(root, 'tools', 'android-release', 'lib', 'config.js');
    const creatorModulePath = path.join(root, 'tools', 'android-release', 'lib', 'creator-config.js');
    if (!fs.existsSync(configModulePath) || !fs.existsSync(creatorModulePath)) {
        throw new Error('Android release Creator adapter is incomplete under tools/android-release/lib');
    }
    const { loadPipelineConfig } = require(configModulePath);
    const { createCreatorBuildConfig } = require(creatorModulePath);
    const context = loadPipelineConfig(configPath, { mode, environment, selectedBundles });
    const creatorLogPath = path.join(context.reportDir, 'creator-build.log');
    fs.mkdirSync(context.reportDir, { recursive: true });
    const buildOptions = createCreatorBuildConfig(context);
    buildOptions.logDest = toProjectUrl(root, creatorLogPath);
    return { context, buildOptions, creatorLogPath };
}

function toProjectUrl(root, target) {
    const relative = path.relative(root, target);
    if (!relative.startsWith('..') && !path.isAbsolute(relative)) {
        return `project://${relative.replace(/\\/g, '/')}`;
    }
    return target.replace(/\\/g, '/');
}

function summarizeEditorBuild(plan) {
    const options = plan.buildOptions;
    return {
        buildPath: options.buildPath,
        debug: options.debug,
        packageName: options.packages.android.packageName,
        scenes: options.scenes.map(scene => scene.url),
        sdkPath: options.packages.android.sdkPath,
        ndkPath: options.packages.android.ndkPath,
        javaHome: options.packages.android.javaHome,
        log: plan.creatorLogPath,
    };
}

function setBuildEnvironment(environment) {
    const values = {
        GALA_APP_ENV: environment,
        HOT_UPDATE_ENV: environment,
        GALA_ANDROID_RELEASE_PIPELINE: '1',
    };
    const previous = Object.fromEntries(Object.keys(values).map(key => [key, process.env[key]]));
    Object.assign(process.env, values);
    return () => {
        Object.entries(previous).forEach(([key, value]) => {
            if (value === undefined) delete process.env[key];
            else process.env[key] = value;
        });
    };
}

function assertCreatorBuildSucceeded(result) {
    if (typeof result === 'number' && result !== 0 && result !== 36) {
        throw new Error(`Creator 构建退出码 ${result}`);
    }
    if (!result || typeof result !== 'object') return;
    const code = [result.exitCode, result.code].find(value => Number.isInteger(value));
    if (code !== undefined && code !== 0 && code !== 36) throw new Error(`Creator 构建退出码 ${code}`);
    if (['failure', 'cancel', 'crashed', 'interrupted'].includes(result.state)) {
        throw new Error(`Creator 构建状态 ${result.state}`);
    }
}

function redactLog(text) {
    return String(text || '')
        .replace(/("(?:keystorePassword|keystoreAliasPassword|xxteaKey)"\s*:\s*")[^"]*(")/gi, '$1<redacted>$2')
        .replace(/((?:keystorePassword|keystoreAliasPassword|xxteaKey)\s*=\s*)[^\s,]+/gi, '$1<redacted>');
}

function appendCreatorLogFile(logPath) {
    if (!fs.existsSync(logPath)) {
        appendLog('Creator', `构建日志尚未生成：${logPath}`);
        return;
    }
    const maxBytes = 1024 * 1024;
    const size = fs.statSync(logPath).size;
    const start = Math.max(0, size - maxBytes);
    const descriptor = fs.openSync(logPath, 'r');
    try {
        const buffer = Buffer.alloc(size - start);
        fs.readSync(descriptor, buffer, 0, buffer.length, start);
        let content = buffer.toString('utf8');
        if (start > 0) content = `仅显示 Creator 日志最后 1 MB，完整文件：${logPath}\n${content.replace(/^[^\r\n]*(?:\r?\n)?/, '')}`;
        appendLog('Creator', redactLog(content));
    } finally {
        fs.closeSync(descriptor);
    }
}

async function runCreatorInCurrentEditor(root, configPath, mode, environment, selectedBundles = []) {
    if (!global.Editor || !Editor.Message || typeof Editor.Message.request !== 'function') {
        throw new Error('当前 Creator 消息服务不可用，无法执行编辑器内构建');
    }
    const plan = createEditorBuildPlan(root, configPath, mode, environment, selectedBundles);
    appendLog('Creator', mode === 'bundle'
        ? `使用 Creator 官方 Bundle 构建：${selectedBundles.join(', ')}`
        : (mode === 'base-apk' ? '使用 Creator 官方构建生成基础 APK data' : '使用 Creator 官方构建生成全部资源'));
    appendLog('Creator配置', JSON.stringify(summarizeEditorBuild(plan), null, 2));
    setState({ status: 'Creator 资源构建中' });
    const restoreEnvironment = setBuildEnvironment(environment);
    try {
        const result = await Editor.Message.request('builder', 'add-task', plan.buildOptions, true);
        assertCreatorBuildSucceeded(result);
    } catch (error) {
        appendCreatorLogFile(plan.creatorLogPath);
        throw new Error(`Creator Android 资源构建失败。完整日志：${plan.creatorLogPath}\n${errorText(error)}`);
    } finally {
        restoreEnvironment();
    }
    appendCreatorLogFile(plan.creatorLogPath);
    appendLog('Creator', mode === 'base-apk' ? '基础 APK data 构建完成' : '资源构建完成，继续生成 Bundle 发布文件');
}

function runCli(root, args, environment) {
    appendLog('命令', `node ${args.join(' ')}`);
    return new Promise((resolve, reject) => {
        let stderrTail = '';
        activeChild = spawn(process.env.NODE_BINARY || 'node', args, {
            cwd: root,
            env: { ...process.env, GALA_APP_ENV: environment, HOT_UPDATE_ENV: environment },
            shell: false,
            windowsHide: true,
        });
        activeChild.stdout.on('data', chunk => appendLog('stdout', chunk));
        activeChild.stderr.on('data', chunk => {
            stderrTail = `${stderrTail}${String(chunk || '')}`.slice(-32000);
            appendLog('stderr', chunk);
        });
        activeChild.on('error', error => {
            activeChild = null;
            reject(error);
        });
        activeChild.on('close', code => {
            activeChild = null;
            if (code === 0) {
                resolve();
                return;
            }
            reject(new Error(extractCliFailure(stderrTail, code)));
        });
    });
}

function extractCliFailure(stderr, code) {
    const lines = String(stderr || '').split(/\r?\n/).map(line => line.trim()).filter(Boolean);
    const marked = [...lines].reverse().find(line => line.startsWith('[android-release]'));
    const raw = marked ? marked.replace(/^\[android-release\]\s*/, '') : '';
    return friendlyBuildError(raw || `Android release pipeline exited with code ${code}`);
}

function friendlyBuildError(value) {
    const text = String(value && (value.stack || value.message) || value || '未知错误');
    let match = text.match(/releaseSequence\s+(\d+)\s+must be greater than previous\s+(\d+)/i);
    if (match) return `热更版本号 ${match[1]} 必须大于该环境上一版本 ${match[2]}，请改为至少 ${Number(match[2]) + 1}。`;
    match = text.match(/base APK versionCode\s+(\d+)\s+must be greater than previous\s+(\d+)/i);
    if (match) return `基础 APK versionCode ${match[1]} 必须大于上一基础包 ${match[2]}，请改为至少 ${Number(match[2]) + 1}。`;
    match = text.match(/Immutable release already exists:\s*(.+)/i);
    if (match) return `热更版本目录已经存在，不能覆盖：${match[1]}。请提高当前环境的热更版本号。`;
    if (/signing\.required=true requires signing\.privateKeyPath/i.test(text)) return '已开启发布描述文件签名，请配置 PEM 私钥路径，或关闭“要求发布描述文件签名”。';
    return text.replace(/^Error:\s*/i, '').split(/\r?\n/, 1)[0];
}

function resolveConfiguredPath(root, value) {
    const configured = String(value || '').trim();
    if (configured.startsWith('project://')) return path.resolve(root, configured.slice('project://'.length));
    return path.isAbsolute(configured) ? path.normalize(configured) : path.resolve(root, configured);
}

function readCompletion(root, mode, environment) {
    if (mode === 'validate') {
        return { mode, environment, title: '配置校验已完成' };
    }

    const raw = readConfig(root).value;
    const environmentConfig = raw.environments && raw.environments[environment] || {};
    const hotUpdateRoot = resolveConfiguredPath(root, environmentConfig.outputRoot);
    const stateFile = resolveConfiguredPath(root, raw.pipeline && raw.pipeline.stateFile);
    if (!fs.existsSync(stateFile)) throw new Error(`构建完成，但状态文件不存在：${stateFile}`);
    const releaseState = JSON.parse(fs.readFileSync(stateFile, 'utf8').replace(/^\uFEFF/, ''));
    const completed = releaseState.environments && releaseState.environments[environment];
    if (!completed) throw new Error(`构建完成，但状态文件中没有 ${environment} 环境结果：${stateFile}`);

    const apkPath = mode === 'base-apk' && completed.apk && completed.apk.path || '';
    const archive = completed.archive || {};
    const publishDirectory = completed.publishDirectory || {};
    const componentRelease = mode !== 'base-apk' && completed.componentRelease || null;
    return {
        mode,
        environment,
        title: mode === 'base-apk'
            ? '基础 APK 打包已完成'
            : (mode === 'bundle' ? '选中 Bundle 打包已完成' : '资源包打包已完成'),
        releaseId: completed.releaseId || '',
        apkPath,
        apkDirectory: apkPath ? path.dirname(apkPath) : '',
        hotUpdateRoot,
        nativeUpdateFile: completed.backendConfig && completed.backendConfig.file || '',
        releaseDirectory: componentRelease && path.dirname(componentRelease.releaseFile) || '',
        archiveHotfixDirectory: archive.hotfixDirectory || '',
        archiveApkPath: archive.apkPath || '',
        componentReleaseFile: componentRelease && (archive.componentReleaseFile || componentRelease.releaseFile) || '',
        changedComponents: componentRelease && componentRelease.changedComponents || [],
        componentUploadPaths: componentRelease && publishDirectory.bundleDirectories || [],
        publishDirectoryRoot: publishDirectory.root || '',
    };
}

function resolvePublishArtifacts(root, raw) {
    const environment = ['dev', 'test', 'prod'].includes(raw.environment) ? raw.environment : 'dev';
    const stateFile = resolveConfiguredPath(root, raw.pipeline && raw.pipeline.stateFile);
    if (!fs.existsSync(stateFile)) return null;
    const releaseState = JSON.parse(fs.readFileSync(stateFile, 'utf8').replace(/^\uFEFF/, ''));
    const current = releaseState.environments && releaseState.environments[environment];
    const release = current && current.componentRelease;
    if (!release || !release.releaseFile) return null;
    const archive = current.archive || {};
    const publishDirectory = current.publishDirectory || {};
    const releaseId = path.basename(release.releaseFile, '.manifest');
    const publishDirectoryRoot = publishDirectory.root || '';
    const manifestFile = publishDirectory.root
        ? (publishDirectory.manifestFile || '')
        : (archive.componentReleaseFile || release.archiveReleaseFile || release.releaseFile);
    const backendFile = archive.backendConfigFile || current.backendConfig && current.backendConfig.file || '';
    return {
        environment,
        releaseId,
        publishDirectoryRoot,
        bundleDirectories: publishDirectory.bundleDirectories || [],
        manifestFile,
        backendFile,
        backendJsonText: fs.existsSync(backendFile) ? fs.readFileSync(backendFile, 'utf8') : '',
    };
}

function appendCompletionLogs(completion) {
    appendLog('完成', completion.title);
    if (completion.apkPath) appendLog('完成', `基础 APK：${completion.apkPath}`);
    if (completion.nativeUpdateFile) appendLog('完成', `后台更新配置：${completion.nativeUpdateFile}`);
    if (completion.componentReleaseFile) appendLog('完成', `版本清单：${completion.componentReleaseFile}`);
    if (completion.changedComponents?.length) appendLog('完成', `变化 Bundle：${completion.changedComponents.join(', ')}`);
    completion.componentUploadPaths?.forEach(item => appendLog('上传', item));
    if (completion.archiveHotfixDirectory) appendLog('归档', `热更归档：${completion.archiveHotfixDirectory}`);
    if (completion.archiveApkPath) appendLog('归档', `APK 归档：${completion.archiveApkPath}`);
}

async function runPipeline(input = {}) {
    if (activeOperation) throw new Error('已有热更新任务正在执行');
    const root = projectRoot();
    const configPath = ensureLocalConfig(root);
    const cliPath = path.join(root, 'tools', 'android-release', 'cli.js');
    if (!fs.existsSync(cliPath)) throw new Error(`Android release CLI not found: ${cliPath}`);
    const mode = ['validate', 'base-apk', 'resources', 'bundle'].includes(input.mode) ? input.mode : 'validate';
    const environment = ['dev', 'test', 'prod'].includes(input.environment) ? input.environment : 'dev';
    const runCreatorHere = mode !== 'validate' && input.dryRun !== true
        && input.resume !== true && input.skipCreator !== true;

    activeOperation = true;
    setState({ status: `执行 ${mode}`, busy: true, completion: null, logs: [], error: '' });
    try {
        if (runCreatorHere) await runCreatorInCurrentEditor(root, configPath, mode, environment, input.selectedBundles || []);
        const args = createCliArgs(cliPath, configPath, mode, environment, input, runCreatorHere || input.skipCreator === true);
        setState({ status: runCreatorHere ? '生成发布文件' : `执行 ${mode}` });
        await runCli(root, args, environment);
        refreshState();
        const completion = readCompletion(root, mode, environment);
        appendCompletionLogs(completion);
        return setState({ status: completion.title, busy: false, completion, error: '' });
    } catch (error) {
        setState({ status: '失败', busy: false, error: friendlyBuildError(error) });
        throw error;
    } finally {
        activeOperation = false;
    }
}

function stopPipeline() {
    if (!activeChild) {
        if (activeOperation) {
            appendLog('控制', '当前处于 Creator 内置构建阶段，请在 Creator 构建任务窗口中取消');
            return setState({ status: 'Creator 构建中' });
        }
        return state;
    }
    const child = activeChild;
    appendLog('控制', '正在停止当前任务');
    if (process.platform === 'win32' && child.pid) {
        const killer = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
            windowsHide: true,
            stdio: 'ignore',
        });
        killer.unref();
    } else {
        child.kill('SIGTERM');
    }
    return setState({ status: '正在停止' });
}

function selectRelease(releaseFile) {
    const release = (state && state.releases || []).find(item => item.releaseFile === releaseFile);
    if (!release) throw new Error('请选择列表中的 release');
    const selectedFile = loadReleaseFile(release, 'version.manifest');
    return setState({ selectedRelease: release, releaseFiles: listReleaseFiles(release), selectedFile, error: '' });
}

function resolveOpenDirectory(target) {
    const value = path.resolve(String(target || ''));
    if (!fs.existsSync(value)) throw new Error(`目录不存在：${value}`);
    return fs.statSync(value).isDirectory() ? value : path.dirname(value);
}

function loadElectronShell() {
    try {
        const electron = require('electron');
        return electron && electron.shell || null;
    } catch {
        return null;
    }
}

async function openSystemPath(target, dependencies = {}) {
    const directory = resolveOpenDirectory(target);
    const electronShell = dependencies.electronShell === undefined ? loadElectronShell() : dependencies.electronShell;
    if (electronShell && typeof electronShell.openPath === 'function') {
        const error = await electronShell.openPath(directory);
        if (!error) return directory;
        throw new Error(`系统打开目录失败：${error}`);
    }

    const executable = process.platform === 'win32'
        ? path.join(process.env.WINDIR || 'C:\\Windows', 'explorer.exe')
        : process.platform === 'darwin' ? 'open' : 'xdg-open';
    await new Promise((resolve, reject) => {
        const child = spawn(executable, [directory], {
            detached: true,
            stdio: 'ignore',
            windowsHide: false,
        });
        child.once('error', reject);
        child.once('spawn', () => {
            child.unref();
            resolve();
        });
    });
    return directory;
}

function copyFileToClipboard(target) {
    const file = path.resolve(String(target || ''));
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) throw new Error(`文件不存在：${file}`);
    if (process.platform !== 'win32') throw new Error('复制文件到剪贴板当前只支持 Windows');
    const escaped = file.replace(/'/g, "''");
    const script = [
        'Add-Type -AssemblyName System.Windows.Forms',
        '$files = New-Object System.Collections.Specialized.StringCollection',
        `[void]$files.Add('${escaped}')`,
        '[System.Windows.Forms.Clipboard]::SetFileDropList($files)',
    ].join('; ');
    const encoded = Buffer.from(script, 'utf16le').toString('base64');
    return new Promise((resolve, reject) => {
        const child = spawn('powershell.exe', ['-NoProfile', '-STA', '-EncodedCommand', encoded], {
            windowsHide: true,
            stdio: 'ignore',
        });
        child.once('error', reject);
        child.once('close', code => code === 0 ? resolve(file) : reject(new Error(`复制 Manifest 文件失败，退出码 ${code}`)));
    });
}

async function refreshAsset(url) {
    if (!global.Editor || !Editor.Message) return;
    try {
        await Editor.Message.request('asset-db', 'refresh-asset', url);
    } catch {
        await Editor.Message.request('asset-db', 'refresh');
    }
}

function errorText(error) {
    return String(error && (error.stack || error.message) || error || '');
}

exports.load = function load() {
    state = initialState();
};

exports.unload = function unload() {
    panelReady = false;
    if (activeChild) stopPipeline();
};

exports.methods = {
    async openPanel() {
        await Editor.Panel.open(PACKAGE_NAME);
        return state;
    },
    panelReady() {
        panelReady = true;
        if (!state) state = initialState();
        emitState();
        return state;
    },
    getState() {
        if (!state) state = initialState();
        return state;
    },
    initializeConfig() {
        ensureLocalConfig(projectRoot());
        return refreshState();
    },
    saveConfig(patch) {
        const config = saveConfig(projectRoot(), patch || {});
        return setState({ config, status: '配置已保存', error: '' });
    },
    runPipeline,
    stopPipeline,
    refreshReleases() {
        return refreshState();
    },
    selectRelease,
    loadReleaseFile(input) {
        if (!input || !input.releaseFile) throw new Error('releaseFile is required');
        const release = (state && state.releases || []).find(item => item.releaseFile === input.releaseFile);
        if (!release) throw new Error('请选择列表中的版本清单');
        const selectedFile = loadReleaseFile(release, input.relativePath);
        return setState({ selectedFile, error: '' });
    },
    async openPath(target) {
        try {
            const directory = await openSystemPath(target);
            appendLog('目录', `已打开：${directory}`);
            return setState({ status: '目录已打开', error: '' });
        } catch (error) {
            setState({ status: '打开目录失败', error: errorText(error) });
            throw error;
        }
    },
    async copyPublishManifest() {
        const publish = state && state.publish;
        if (!publish || !publish.manifestFile) throw new Error('当前没有可复制的版本 Manifest');
        const file = await copyFileToClipboard(publish.manifestFile);
        appendLog('发布', `版本 Manifest 已复制到剪贴板：${file}`);
        return setState({ status: '版本 Manifest 已复制', error: '' });
    },
};

exports.__test__ = {
    extractCliFailure,
    friendlyBuildError,
    openSystemPath,
    copyFileToClipboard,
    readCompletion,
    resolveConfiguredPath,
    resolveOpenDirectory,
};
