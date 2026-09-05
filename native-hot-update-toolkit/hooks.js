'use strict';

const fs = require('fs');
const path = require('path');

const PACKAGE_NAME = 'native-hot-update-toolkit';

exports.throwError = true;

let lastPipelineReport = null;

/**
 * Creator 资源构建完成、Gradle 组包前钩子。
 * 先生成并验证远端 release，再剥离 login/hall，最后验证主包白名单。
 */
exports.onAfterBuildAssets = async function onAfterBuildAssets(options, result) {
    if (process.env.GALA_ANDROID_RELEASE_PIPELINE === '1') {
        console.log(`[${PACKAGE_NAME}] skipped: Android release pipeline owns release generation and Bundle stripping`);
        return;
    }
    const packageOptions = normalizePackageOptions(options);
    if (!isEnabled(packageOptions.enabled)) {
        console.log(`[${PACKAGE_NAME}] disabled for this Android build`);
        return;
    }
    const projectRoot = getProjectRoot();
    const toolkitRoot = path.join(projectRoot, 'tools', 'native-hot-update-toolkit');
    const configPath = path.resolve(projectRoot, packageOptions.configPath || 'tools/native-hot-update-toolkit/config.local.json');
    const buildRoot = inferBuildRoot(projectRoot, options, result);
    const { loadConfig, buildRelease, stripRemoteBundles } = require(path.join(toolkitRoot, 'lib'));
    const config = loadConfig(configPath, {
        projectRoot,
        environment: process.env.GALA_APP_ENV || process.env.HOT_UPDATE_ENV,
        buildRoot,
    });
    const report = buildRelease(config);
    const stripReport = stripRemoteBundles(config);
    lastPipelineReport = { releaseId: report.releaseId, buildRoot, stripReport };
    const hashes = report.bundles.map(bundle => `${bundle.bundle}:${bundle.contentHash}`).join(', ');
    console.log(`[${PACKAGE_NAME}] generated ${report.releaseId}: ${hashes}`);
    console.log(`[${PACKAGE_NAME}] stripped ${stripReport.removed.length} remote Bundle roots before Gradle packaging`);
};

/** Gradle 完成后只确认本次资源阶段实际执行过，不在 APK 已生成后再删除目录。 */
exports.onAfterBuild = async function onAfterBuild(options) {
    if (process.env.GALA_ANDROID_RELEASE_PIPELINE === '1') return;
    const packageOptions = normalizePackageOptions(options);
    if (!isEnabled(packageOptions.enabled)) return;
    if (!lastPipelineReport) {
        throw new Error(`[${PACKAGE_NAME}] onAfterBuildAssets did not produce a release/strip report`);
    }
    console.log(`[${PACKAGE_NAME}] Android build completed for ${lastPipelineReport.releaseId}`);
};

/** 兼容 Creator 将 package options 以对象或 JSON 字符串传入。 */
function normalizePackageOptions(options) {
    const packages = options && options.packages || {};
    const raw = packages[PACKAGE_NAME] || packages.nativeHotUpdateToolkit || {};
    if (typeof raw === 'string') {
        try { return JSON.parse(raw); } catch (error) { return {}; }
    }
    return raw || {};
}

function isEnabled(value) {
    const normalized = value && typeof value === 'object' && 'value' in value ? value.value : value;
    return normalized === true || normalized === 1 || normalized === '1' || normalized === 'true';
}

/** 从 Creator result.dest 和标准 build/<outputName>/data 中定位 Native 数据目录。 */
function inferBuildRoot(projectRoot, options, result) {
    const outputName = options && options.outputName || 'android';
    const candidates = [
        result && result.dest && path.join(result.dest, 'data'),
        result && result.dest,
        path.join(projectRoot, 'build', outputName, 'data'),
    ].filter(Boolean);
    const found = candidates.find((candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isDirectory());
    if (!found) throw new Error(`[${PACKAGE_NAME}] unable to locate the Cocos build data directory`);
    return found;
}

/** Creator 内使用 Editor.Project.path，命令行测试时回退 cwd。 */
function getProjectRoot() {
    return global.Editor && Editor.Project && Editor.Project.path || process.cwd();
}
