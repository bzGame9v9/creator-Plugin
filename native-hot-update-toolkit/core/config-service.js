'use strict';

const fs = require('fs');
const path = require('path');

const ENVIRONMENTS = new Set(['dev', 'test', 'prod']);

function configPaths(projectRoot) {
    const root = path.join(projectRoot, 'tools', 'android-release');
    return {
        local: path.join(root, 'config.local.json'),
        example: path.join(root, 'config.example.json'),
    };
}

function ensureLocalConfig(projectRoot) {
    const paths = configPaths(projectRoot);
    if (fs.existsSync(paths.local)) return paths.local;
    if (!fs.existsSync(paths.example)) throw new Error(`Android release config template not found: ${paths.example}`);
    fs.copyFileSync(paths.example, paths.local);
    return paths.local;
}

function readConfig(projectRoot) {
    const file = ensureLocalConfig(projectRoot);
    return {
        file,
        value: JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')),
    };
}

function summarizeConfig(projectRoot) {
    const { file, value } = readConfig(projectRoot);
    const environment = ENVIRONMENTS.has(value.environment) ? value.environment : 'dev';
    const configuredVersionCode = positiveIntegerOrDefault(value.gradle && value.gradle.versionCode, 1);
    const stateFile = resolveConfiguredPath(projectRoot, value.pipeline && value.pipeline.stateFile);
    const releaseState = readReleaseState(stateFile);
    const versionOverrides = value.versionOverrides || {};
    const environments = Object.fromEntries(Object.entries(value.environments || {}).map(([name, item]) => [name, {
        releaseSequence: name === 'prod'
            ? nextReleaseSequence(releaseState.environments && releaseState.environments[name], 1001)
            : hotfixSequenceOrDefault(
                versionOverrides[name] && versionOverrides[name].releaseSequence,
                nextReleaseSequence(releaseState.environments && releaseState.environments[name], item.releaseSequence || value.releaseSequence),
            ),
        versionCode: positiveIntegerOrDefault(
            versionOverrides[name] && versionOverrides[name].versionCode,
            nextVersionCode(releaseState.environments && releaseState.environments[name], configuredVersionCode),
        ),
        previousReleaseSequence: validHotfixSequence(releaseState.environments && releaseState.environments[name]?.releaseSequence),
        previousVersionCode: Number(releaseState.environments && releaseState.environments[name]?.apk?.versionCode) || 0,
        hasPreviousRelease: validHotfixSequence(releaseState.environments && releaseState.environments[name]?.releaseSequence) > 0,
        releaseSequenceConfirmed: name !== 'prod' && Number(versionOverrides[name] && versionOverrides[name].releaseSequence) > 0,
        versionCodeConfirmed: Number(versionOverrides[name] && versionOverrides[name].versionCode) > 0,
        appName: item.appName || '',
        packageName: item.packageName || '',
        baseUrl: item.baseUrl || '',
        outputRoot: item.outputRoot || '',
        apkInstallMode: item.apkInstallMode || (name === 'prod' ? 'google_play' : 'direct_apk'),
        apkDownloadUrl: item.apkDownloadUrl || '',
        apkUpdateDesc: item.apkUpdateDesc || '',
        hotfixUpdateDesc: item.hotfixUpdateDesc || '',
        hallBundle: item.hallBundle || value.componentRelease?.defaultHallBundle || 'hall',
    }]));
    const environmentConfig = environments[environment] || {};
    const bundles = Object.fromEntries((value.bundles || []).map(bundle => [bundle.bundleName, {
        bundleName: bundle.bundleName,
        assetRoot: bundle.assetRoot || '',
        requiredAtStartup: bundle.requiredAtStartup === true,
        includeInApk: bundle.includeInApk === true,
    }]));
    const channelConfig = readChannelConfig(projectRoot, value.channelConfig);
    return {
        file,
        environment,
        releaseId: `${environment}_${environmentConfig.releaseSequence || value.releaseSequence || 0}`,
        releaseSequence: environmentConfig.releaseSequence || value.releaseSequence || 0,
        previousReleaseSequence: environmentConfig.previousReleaseSequence || 0,
        previousVersionCode: environmentConfig.previousVersionCode || 0,
        versionManagedByState: environmentConfig.hasPreviousRelease === true,
        confirmed: value.pipeline && value.pipeline.confirmed === true,
        versionCode: environmentConfig.versionCode || configuredVersionCode,
        versionName: String(environmentConfig.versionCode || configuredVersionCode),
        environmentConfig: {
            appName: environmentConfig.appName || '',
            packageName: environmentConfig.packageName || '',
            baseUrl: environmentConfig.baseUrl || '',
            outputRoot: environmentConfig.outputRoot || '',
            apkInstallMode: environmentConfig.apkInstallMode || (environment === 'prod' ? 'google_play' : 'direct_apk'),
            apkDownloadUrl: environmentConfig.apkDownloadUrl || '',
            apkUpdateDesc: environmentConfig.apkUpdateDesc || '',
            hotfixUpdateDesc: environmentConfig.hotfixUpdateDesc || '',
            hallBundle: environmentConfig.hallBundle || value.componentRelease?.defaultHallBundle || 'hall',
        },
        environments,
        creator: {
            executable: value.creator && value.creator.executable || '',
            sdkPath: value.creator && value.creator.android && value.creator.android.sdkPath || '',
            ndkPath: value.creator && value.creator.android && value.creator.android.ndkPath || '',
            javaHome: value.creator && value.creator.android && value.creator.android.javaHome || '',
            appABIs: value.creator && value.creator.android && value.creator.android.appABIs || [],
            useDebugKeystore: value.creator && value.creator.android && value.creator.android.useDebugKeystore === true,
            keystorePath: value.creator && value.creator.android && value.creator.android.keystorePath || '',
            keystorePassword: value.creator && value.creator.android && value.creator.android.keystorePassword || '',
            keystoreAlias: value.creator && value.creator.android && value.creator.android.keystoreAlias || '',
            keystoreAliasPassword: value.creator && value.creator.android && value.creator.android.keystoreAliasPassword || '',
        },
        signing: {
            required: value.signing && value.signing.required === true,
            keyId: value.signing && value.signing.keyId || '',
            privateKeyPath: value.signing && value.signing.privateKeyPath || '',
        },
        bundles,
        channelConfig,
        componentRelease: {
            enabled: !value.componentRelease || value.componentRelease.enabled !== false,
            hallBundles: value.componentRelease?.hallBundles || ['hall'],
            defaultHallBundle: value.componentRelease?.defaultHallBundle || 'hall',
        },
        pipeline: {
            stateFile: value.pipeline && value.pipeline.stateFile || '',
            reportRoot: value.pipeline && value.pipeline.reportRoot || '',
            artifactRoot: value.pipeline && value.pipeline.artifactRoot || '',
            archiveRoot: value.pipeline && value.pipeline.archiveRoot || '',
            hotfixMode: value.pipeline && value.pipeline.hotfixMode === 'full_zip' ? 'full_zip' : 'incremental',
            runChecks: !value.pipeline || value.pipeline.runChecks !== false,
        },
    };
}

function readChannelConfig(projectRoot, configuredPath) {
    const file = resolveConfiguredPath(
        projectRoot,
        configuredPath || 'project://tools/android-release/channels.json',
    );
    if (!fs.existsSync(file)) return { file, defaultChannels: [], channels: [] };
    const value = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
    const channels = Array.isArray(value.channels) ? value.channels.map(item => ({
        id: String(item && item.id || '').trim(),
        name: String(item && item.name || '').trim(),
        enabled: !item || item.enabled !== false,
    })).filter(item => item.id && item.name) : [];
    const enabled = new Set(channels.filter(item => item.enabled).map(item => item.id));
    const defaultChannels = (Array.isArray(value.defaultChannels) ? value.defaultChannels : [])
        .map(String).map(item => item.trim()).filter(item => enabled.has(item));
    return { file, defaultChannels, channels };
}

function saveConfig(projectRoot, patch) {
    const { file, value } = readConfig(projectRoot);
    const environment = String(patch.environment || '').trim();
    if (!ENVIRONMENTS.has(environment)) throw new Error(`Unsupported environment: ${environment}`);
    const sequence = hotfixSequence(patch.releaseSequence, 'releaseSequence');
    const versionCode = positiveInteger(patch.versionCode, 'versionCode');
    const baseUrl = normalizeEnvironmentBaseUrl(
        projectRoot,
        requiredText(patch.environmentConfig && patch.environmentConfig.baseUrl, 'baseUrl'),
        environment,
    );

    value.environment = environment;
    delete value.releaseId;
    delete value.releaseSequence;
    value.environments = value.environments || {};
    const currentEnvironment = value.environments[environment] || {};
    const appName = requiredText(patch.environmentConfig.appName, 'appName');
    const packageName = requiredText(patch.environmentConfig.packageName, 'packageName');
    const apkInstallMode = patch.environmentConfig.apkInstallMode === 'google_play'
        ? 'google_play'
        : (patch.environmentConfig.apkInstallMode === 'direct_apk'
            ? 'direct_apk'
            : (environment === 'prod' ? 'google_play' : 'direct_apk'));
    const hallBundles = String(patch.componentRelease?.hallBundles || 'hall')
        .split(',').map(item => item.trim()).filter(Boolean);
    if (hallBundles.length === 0 || new Set(hallBundles).size !== hallBundles.length
        || hallBundles.some(item => !/^[a-z][a-z0-9_-]*$/.test(item))) {
        throw new Error('hallBundles must contain unique Bundle names');
    }
    const configuredBundles = new Set((value.bundles || []).map(bundle => bundle.bundleName));
    const unknownHallBundle = hallBundles.find(item => !configuredBundles.has(item));
    if (unknownHallBundle) throw new Error(`hall Bundle is not configured: ${unknownHallBundle}`);
    const hallBundle = requiredText(patch.environmentConfig.hallBundle || hallBundles[0], 'hallBundle');
    if (!hallBundles.includes(hallBundle)) throw new Error('hallBundle must be declared in hallBundles');
    value.environments[environment] = {
        ...currentEnvironment,
        releaseSequence: sequence,
        appName,
        packageName,
        baseUrl,
        outputRoot: requiredText(patch.environmentConfig.outputRoot, 'outputRoot'),
        apkInstallMode,
        apkDownloadUrl: requiredText(
            patch.environmentConfig.apkDownloadUrl || currentEnvironment.apkDownloadUrl || (environment === 'prod'
                ? `https://play.google.com/store/apps/details?id=${packageName}`
                : `${baseUrl}apks/`),
            'apkDownloadUrl',
        ),
        apkUpdateDesc: requiredText(
            patch.environmentConfig.apkUpdateDesc || currentEnvironment.apkUpdateDesc || 'A new application version is required. Please update to continue.',
            'apkUpdateDesc',
        ),
        hotfixUpdateDesc: requiredText(
            patch.environmentConfig.hotfixUpdateDesc || currentEnvironment.hotfixUpdateDesc || 'Resources must be updated before continuing.',
            'hotfixUpdateDesc',
        ),
        hallBundle,
    };
    value.componentRelease = {
        enabled: patch.componentRelease?.enabled !== false,
        hallBundles,
        defaultHallBundle: hallBundle,
    };
    value.gradle = {
        ...(value.gradle || {}),
        versionCode,
    };
    delete value.gradle.versionName;
    value.versionOverrides = value.versionOverrides || {};
    value.versionOverrides[environment] = value.versionOverrides[environment] || {};
    if (environment !== 'prod' && patch.versionConfirmation && patch.versionConfirmation.releaseSequence === true) {
        value.versionOverrides[environment].releaseSequence = sequence;
    }
    if (patch.versionConfirmation && patch.versionConfirmation.versionCode === true) {
        value.versionOverrides[environment].versionCode = versionCode;
    }
    if (Object.keys(value.versionOverrides[environment]).length === 0) delete value.versionOverrides[environment];
    Object.values(value.environments).forEach(item => delete item.releaseIdPrefix);
    value.creator = value.creator || {};
    value.creator.executable = requiredText(patch.creator.executable, 'Creator executable');
    const useDebugKeystore = patch.creator.useDebugKeystore === true;
    value.creator.android = {
        ...(value.creator.android || {}),
        sdkPath: requiredText(patch.creator.sdkPath, 'Android SDK path'),
        ndkPath: requiredText(patch.creator.ndkPath, 'Android NDK path'),
        javaHome: requiredText(patch.creator.javaHome, 'Java home'),
        appABIs: String(patch.creator.appABIs || '').split(',').map(item => item.trim()).filter(Boolean),
        useDebugKeystore,
        keystorePath: useDebugKeystore
            ? String(patch.creator.keystorePath || '').trim()
            : requiredText(patch.creator.keystorePath, 'Android keystore path'),
        keystorePassword: useDebugKeystore
            ? String(patch.creator.keystorePassword || '')
            : requiredText(patch.creator.keystorePassword, 'Android keystore password'),
        keystoreAlias: useDebugKeystore
            ? String(patch.creator.keystoreAlias || '').trim()
            : requiredText(patch.creator.keystoreAlias, 'Android keystore alias'),
        keystoreAliasPassword: useDebugKeystore
            ? String(patch.creator.keystoreAliasPassword || '')
            : requiredText(patch.creator.keystoreAliasPassword, 'Android keystore alias password'),
    };
    value.signing = {
        ...(value.signing || {}),
        required: patch.signing && patch.signing.required === true,
        keyId: String(patch.signing && patch.signing.keyId || '').trim(),
        privateKeyPath: String(patch.signing && patch.signing.privateKeyPath || '').trim(),
    };
    value.pipeline = {
        ...(value.pipeline || {}),
        confirmed: patch.confirmed === true,
        runChecks: !patch.pipeline || patch.pipeline.runChecks !== false,
        stateFile: requiredText(patch.pipeline.stateFile, 'stateFile'),
        reportRoot: requiredText(patch.pipeline.reportRoot, 'reportRoot'),
        artifactRoot: requiredText(patch.pipeline.artifactRoot, 'artifactRoot'),
        archiveRoot: requiredText(patch.pipeline.archiveRoot, 'archiveRoot'),
        hotfixMode: patch.pipeline.hotfixMode === 'full_zip' ? 'full_zip' : 'incremental',
    };
    for (const bundle of value.bundles || []) {
        const next = patch.bundles && patch.bundles[bundle.bundleName];
        if (!next) continue;
        bundle.requiredAtStartup = next.requiredAtStartup === true;
        bundle.includeInApk = next.includeInApk === true;
        delete bundle.version;
        delete bundle.incrementalZipThreshold;
        delete bundle.restartPolicy;
        delete bundle.previousProjectManifest;
    }
    fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
    return summarizeConfig(projectRoot);
}

function clearVersionOverrides(projectRoot, environment, fields = {}) {
    const { file, value } = readConfig(projectRoot);
    const overrides = value.versionOverrides && value.versionOverrides[environment];
    if (!overrides) return summarizeConfig(projectRoot);
    if (fields.releaseSequence) delete overrides.releaseSequence;
    if (fields.versionCode) delete overrides.versionCode;
    if (Object.keys(overrides).length === 0) delete value.versionOverrides[environment];
    if (value.versionOverrides && Object.keys(value.versionOverrides).length === 0) delete value.versionOverrides;
    fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
    return summarizeConfig(projectRoot);
}

function positiveInteger(value, label) {
    const number = Number(value);
    if (!Number.isSafeInteger(number) || number <= 0) throw new Error(`${label} must be a positive integer`);
    return number;
}

function positiveIntegerOrDefault(value, fallback) {
    const number = Number(value);
    return Number.isSafeInteger(number) && number > 0 ? number : fallback;
}

function nextReleaseSequence(previous, configured) {
    const previousSequence = Number(previous && previous.releaseSequence);
    return Number.isSafeInteger(previousSequence) && previousSequence >= 1001 && previousSequence <= 9999
        ? previousSequence + 1
        : hotfixSequenceOrDefault(configured, 1001);
}

function hotfixSequence(value, label) {
    const number = Number(value);
    if (!Number.isSafeInteger(number) || number < 1001 || number > 9999) {
        throw new Error(`${label} must be a four-digit integer from 1001 to 9999`);
    }
    return number;
}

function hotfixSequenceOrDefault(value, fallback) {
    const number = Number(value);
    return Number.isSafeInteger(number) && number >= 1001 && number <= 9999 ? number : fallback;
}

function validHotfixSequence(value) {
    const number = Number(value);
    return Number.isSafeInteger(number) && number >= 1001 && number <= 9999 ? number : 0;
}

function nextVersionCode(previous, configured) {
    const previousVersionCode = Number(previous && previous.apk && previous.apk.versionCode);
    return Number.isSafeInteger(previousVersionCode) && previousVersionCode > 0
        ? previousVersionCode + 1
        : positiveIntegerOrDefault(configured, 1);
}

function resolveConfiguredPath(projectRoot, value) {
    const configured = String(value || '').trim();
    if (!configured) return '';
    if (configured.startsWith('project://')) return path.resolve(projectRoot, configured.slice('project://'.length));
    return path.isAbsolute(configured) ? path.normalize(configured) : path.resolve(projectRoot, configured);
}

function readReleaseState(file) {
    if (!file || !fs.existsSync(file)) return { schemaVersion: 1, environments: {} };
    const value = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
    value.environments = value.environments || {};
    return value;
}

function requiredText(value, label) {
    const text = String(value || '').trim();
    if (!text) throw new Error(`${label} is required`);
    return text;
}

function normalizeEnvironmentBaseUrl(projectRoot, value, environment) {
    const projectModule = path.join(projectRoot, 'tools', 'native-hot-update-toolkit', 'lib', 'paths.js');
    if (!fs.existsSync(projectModule)) {
        throw new Error(`Native hot-update toolkit core not found: ${projectModule}`);
    }
    const { normalizeBaseUrl } = require(projectModule);
    return normalizeBaseUrl(value, { allowHttp: environment !== 'prod' });
}

module.exports = {
    configPaths,
    ensureLocalConfig,
    readConfig,
    saveConfig,
    clearVersionOverrides,
    summarizeConfig,
};
