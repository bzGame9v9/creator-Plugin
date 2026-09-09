'use strict';

const fs = require('fs');
const path = require('path');

const WEB_RELEASES = {
    dev: { releaseEnvironment: 'development', script: 'release:web:development', outputName: 'web-mobile-development', label: '开发服' },
    test: { releaseEnvironment: 'test', script: 'release:web:test', outputName: 'web-mobile-test', label: '测试服' },
    prod: { releaseEnvironment: 'production', script: 'release:web:production', outputName: 'web-mobile-production', label: '正式服' },
};

const REQUIRED_META = [
    ['title', /<title>[^<]+<\/title>/i],
    ['charset', /<meta\s+charset=["']utf-8["']/i],
    ['viewport', /<meta\s+name=["']viewport["']/i],
    ['description', /<meta\s+name=["']description["']/i],
    ['og:title', /<meta\s+property=["']og:title["']/i],
    ['og:description', /<meta\s+property=["']og:description["']/i],
    ['og:image', /<meta\s+property=["']og:image["']/i],
    ['twitter:card', /<meta\s+name=["']twitter:card["']/i],
    ['twitter:title', /<meta\s+name=["']twitter:title["']/i],
    ['twitter:description', /<meta\s+name=["']twitter:description["']/i],
    ['twitter:image', /<meta\s+name=["']twitter:image["']/i],
    ['apple-mobile-web-app-capable', /<meta\s+name=["']apple-mobile-web-app-capable["']/i],
    ['mobile-web-app-capable', /<meta\s+name=["']mobile-web-app-capable["']/i],
    ['robots', /<meta\s+name=["']robots["']/i],
];

function inspectWebRelease(projectRoot, environment) {
    const release = WEB_RELEASES[environment] || WEB_RELEASES.dev;
    const errors = [];
    const warnings = [];
    const packageFile = path.join(projectRoot, 'package.json');
    const profileFile = path.join(projectRoot, 'profiles', 'v2', 'packages', 'web-mobile.json');
    const templateFile = path.join(projectRoot, 'build-templates', 'web-mobile', 'index.ejs');
    const releaseToolFile = path.join(projectRoot, 'tools', 'release-web.js');
    const releaseConfigFile = path.resolve(__dirname, '..', '..', 'release-pipeline', 'config', 'default-config.json');
    const shareImageFile = path.join(projectRoot, 'build-templates', 'web-mobile', 'invite.jpg');

    const packageJson = readJson(packageFile, 'package.json', errors);
    const profile = readJson(profileFile, 'Web profile', errors);
    const releaseConfig = readJson(releaseConfigFile, 'release pipeline config', errors);
    const template = readText(templateFile, 'Web index.ejs', errors);

    if (!fs.existsSync(releaseToolFile)) errors.push(`缺少 Web 发布脚本：${releaseToolFile}`);
    if (!packageJson.scripts || !packageJson.scripts[release.script]) {
        errors.push(`缺少 npm 命令：${release.script}`);
    }
    for (const dependency of ['javascript-obfuscator', 'adm-zip']) {
        if (!fs.existsSync(path.join(projectRoot, 'node_modules', dependency))) {
            errors.push(`当前项目缺少依赖：${dependency}，请先执行 npm.cmd ci --include=dev`);
        }
    }

    const common = profile.builder && profile.builder.common || {};
    if (common.platform !== 'web-mobile') errors.push('Web profile 的 platform 必须是 web-mobile');
    for (const key of ['buildPath', 'outputName', 'startScene', 'name']) {
        if (common[key] === undefined || common[key] === null || common[key] === '') {
            errors.push(`Web profile 缺少 builder.common.${key}`);
        }
    }
    const taskEntries = Object.entries(profile.builder && profile.builder.taskOptionsMap || {});
    if (taskEntries.length === 0) errors.push('Web profile 缺少 taskOptionsMap');
    if (taskEntries.length > 1) warnings.push(`Web profile 存在 ${taskEntries.length} 个 task，建议确认当前使用项`);

    const activeTemplate = template.replace(/<!--[\s\S]*?-->/g, '');
    const meta = REQUIRED_META.map(([name, pattern]) => ({
        name,
        present: pattern.test(activeTemplate),
        value: extractMetaValue(activeTemplate, name),
    }));
    meta.filter(item => !item.present).forEach(item => errors.push(`index.ejs 缺少 head meta：${item.name}`));
    if (!/__GALA_ANALYTICS_ENVIRONMENT__/.test(template)) {
        errors.push('index.ejs 缺少 __GALA_ANALYTICS_ENVIRONMENT__ 环境注入标记');
    }

    const sdk = extractScripts(activeTemplate, path.dirname(templateFile));
    sdk.local.filter(item => !item.exists).forEach(item => errors.push(`index.ejs 引用的本地 SDK 文件不存在：${item.src}`));
    const sdkConfig = inspectSdkConfig(projectRoot, release.releaseEnvironment, activeTemplate, errors, warnings);
    const googleConfig = inspectGoogleLogin(projectRoot, warnings);
    for (const asset of ['manifest.json', 'favicon.ico', 'invite.jpg', 'firebase-messaging-sw.js']) {
        if (!fs.existsSync(path.join(path.dirname(templateFile), asset))) {
            errors.push(`Web 模板缺少文件：${asset}`);
        }
    }
    const taskNames = (releaseConfig.tasks || []).filter(item => item && item.enabled !== false).map(item => item.name);
    for (const requiredTask of ['obfuscateJs', 'fingerprintBuild', 'zipBuild', 'writeReport']) {
        if (!taskNames.includes(requiredTask)) warnings.push(`release pipeline 默认任务未启用：${requiredTask}`);
    }

    return {
        environment,
        releaseEnvironment: release.releaseEnvironment,
        label: release.label,
        script: release.script,
        outputName: release.outputName,
        command: `npm.cmd run ${release.script}`,
        valid: errors.length === 0,
        errors,
        warnings,
        files: { packageFile, profileFile, templateFile, releaseToolFile, releaseConfigFile },
        profile: {
            buildPath: common.buildPath || '',
            defaultOutputName: common.outputName || '',
            platform: common.platform || '',
            startScene: common.startScene || '',
            projectName: common.name || '',
            md5Cache: common.md5Cache === true,
            taskId: taskEntries[0] && taskEntries[0][0] || '',
            taskOptions: taskEntries[0] && taskEntries[0][1] || {},
        },
        pipelineTasks: taskNames,
        sdk,
        sdkConfig,
        meta,
        settings: {
            googleClientId: googleConfig.clientId,
            liveChatId: quotedValue(template, /window\.__lc\.license\s*=\s*([0-9]+)/),
            facebookAppId: sdkConfig.facebookAppId,
            thinkingDataAppId: sdkConfig.thinkingData.appId,
            title: metaValue(meta, 'title'),
            description: metaValue(meta, 'description'),
            ogTitle: metaValue(meta, 'og:title'),
            ogDescription: metaValue(meta, 'og:description'),
            ogImage: metaValue(meta, 'og:image'),
            twitterTitle: metaValue(meta, 'twitter:title'),
            twitterDescription: metaValue(meta, 'twitter:description'),
            twitterImage: metaValue(meta, 'twitter:image'),
        },
        shareImage: inspectShareImage(shareImageFile),
    };
}

function replaceWebShareImage(projectRoot, dataUrl) {
    const match = String(dataUrl || '').match(/^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/);
    if (!match) throw new Error('分享图片必须转换为 JPEG 后再保存');
    const content = Buffer.from(match[1], 'base64');
    if (content.length === 0 || content.length > 20 * 1024 * 1024) {
        throw new Error('分享图片大小必须在 1 Byte 到 20 MB 之间');
    }
    if (content[0] !== 0xFF || content[1] !== 0xD8 || content[2] !== 0xFF) {
        throw new Error('分享图片不是有效的 JPEG 文件');
    }

    const templateRoot = path.join(projectRoot, 'build-templates', 'web-mobile');
    const imageFile = path.join(templateRoot, 'invite.jpg');
    const templateFile = path.join(templateRoot, 'index.ejs');
    fs.writeFileSync(imageFile, content);

    let template = fs.readFileSync(templateFile, 'utf8');
    template = replaceMetaContent(template, 'og:image', './invite.jpg');
    template = replaceMetaContent(template, 'twitter:image', './invite.jpg');
    fs.writeFileSync(templateFile, template, 'utf8');
    return inspectShareImage(imageFile);
}

function inspectShareImage(file) {
    if (!fs.existsSync(file)) return { file, dataUrl: '', size: 0 };
    const content = fs.readFileSync(file);
    return {
        file,
        dataUrl: `data:image/jpeg;base64,${content.toString('base64')}`,
        size: content.length,
    };
}

function saveWebReleaseSettings(projectRoot, environment, patch) {
    const release = WEB_RELEASES[environment];
    if (!release) throw new Error(`未知 Web 环境：${environment}`);
    const templateRoot = path.join(projectRoot, 'build-templates', 'web-mobile');
    const templateFile = path.join(templateRoot, 'index.ejs');
    const thinkingFile = path.join(templateRoot, 'gala-thinkingdata-bridge.1.0.0.js');
    const thirdPartyFile = path.join(templateRoot, 'thirdPartyEvents.js');
    const googleConfig = inspectGoogleLogin(projectRoot, []);

    let template = fs.readFileSync(templateFile, 'utf8');
    template = replaceTitle(template, requiredValue(patch.title, 'HTML title'));
    for (const [name, value] of [
        ['description', patch.description],
        ['og:title', patch.ogTitle],
        ['og:description', patch.ogDescription],
        ['og:image', patch.ogImage],
        ['twitter:title', patch.twitterTitle],
        ['twitter:description', patch.twitterDescription],
        ['twitter:image', patch.twitterImage],
    ]) {
        template = replaceMetaContent(template, name, requiredValue(value, name));
    }
    const liveChatId = requiredDigits(patch.liveChatId, 'LiveChat ID');
    template = template.replace(/(window\.__lc\.license\s*=\s*)[0-9]+/, `$1${liveChatId}`);
    template = template.replace(/(livechat\.com\/chat-with\/)[0-9]+/g, `$1${liveChatId}`);
    fs.writeFileSync(templateFile, template, 'utf8');

    if (!googleConfig.file) throw new Error('找不到 Google 登录 Client ID 配置文件');
    replaceActiveProperty(googleConfig.file, 'client_id', requiredValue(patch.googleClientId, 'Google Client ID'));
    replaceActiveProperty(thirdPartyFile, 'appId', requiredDigits(patch.facebookAppId, 'Facebook App ID'));
    replaceEnvironmentValue(
        thinkingFile,
        release.releaseEnvironment,
        requiredValue(patch.thinkingDataAppId, 'ThinkingData AppId'),
    );
    return inspectWebRelease(projectRoot, environment);
}

function inspectSdkConfig(projectRoot, environment, template, errors, warnings) {
    const templateRoot = path.join(projectRoot, 'build-templates', 'web-mobile');
    const thinkingData = readText(path.join(templateRoot, 'gala-thinkingdata-bridge.1.0.0.js'), 'ThinkingData bridge', errors);
    const firebaseWeb = readText(path.join(templateRoot, 'InitializeFirebase.js'), 'Firebase Web config', errors);
    const firebaseWorker = readText(path.join(templateRoot, 'firebase-messaging-sw.js'), 'Firebase Service Worker config', errors);
    const thirdParty = readText(path.join(templateRoot, 'thirdPartyEvents.js'), 'thirdPartyEvents', errors);
    const thinkingAppIds = {};
    for (const name of ['development', 'test', 'production']) {
        const match = thinkingData.match(new RegExp(`${name}\\s*:\\s*['"]([^'"]*)['"]`));
        thinkingAppIds[name] = match ? match[1].trim() : '';
    }
    const thinkingReceiver = quotedValue(thinkingData, /RECEIVER_URL\s*=\s*['"]([^'"]+)['"]/);
    const selectedThinkingAppId = thinkingAppIds[environment] || '';
    if (!selectedThinkingAppId) errors.push(`ThinkingData ${environment} AppId 未配置`);
    if (environment !== 'development' && /debug|placeholder|appid/i.test(selectedThinkingAppId)) {
        errors.push(`ThinkingData ${environment} AppId 仍是占位值`);
    }
    if (!thinkingReceiver) errors.push('ThinkingData Receiver URL 未配置');

    const firebase = {
        projectId: quotedProperty(firebaseWeb, 'projectId'),
        appId: quotedProperty(firebaseWeb, 'appId'),
        messagingSenderId: quotedProperty(firebaseWeb, 'messagingSenderId'),
        workerProjectId: quotedProperty(firebaseWorker, 'projectId'),
        workerAppId: quotedProperty(firebaseWorker, 'appId'),
    };
    if (!firebase.projectId || !firebase.appId || !firebase.messagingSenderId) {
        errors.push('Firebase Web 配置不完整');
    }
    if (firebase.projectId !== firebase.workerProjectId || firebase.appId !== firebase.workerAppId) {
        errors.push('Firebase Web 与 Service Worker 配置不一致');
    }
    const facebookAppId = quotedProperty(thirdParty, 'appId');
    if (!facebookAppId) warnings.push('Facebook AppId 未在 thirdPartyEvents.js 中找到');
    if (!/accounts\.google\.com\/gsi\/client/.test(template)) warnings.push('Google Identity SDK 未启用');
    if (!/connect\.facebook\.net\/en_US\/sdk\.js/.test(template)) warnings.push('Facebook SDK 未启用');

    return {
        thinkingData: { environment, appId: selectedThinkingAppId, receiverUrl: thinkingReceiver, allAppIds: thinkingAppIds },
        firebase,
        facebookAppId,
    };
}

function inspectGoogleLogin(projectRoot, warnings) {
    const candidates = [
        path.join(projectRoot, 'assets', 'bundles', 'login', 'src', 'login', 'ThirdPartyEvent.ts'),
        path.join(projectRoot, 'assets', 'base', 'src', 'login', 'ThirdPartyEvent.ts'),
        path.join(projectRoot, 'assets', 'src', 'login', 'ThirdPartyEvent.ts'),
    ];
    const file = candidates.find(candidate => fs.existsSync(candidate)) || '';
    if (!file) {
        warnings.push('未找到 Google 登录配置文件 ThirdPartyEvent.ts');
        return { file: '', clientId: '' };
    }
    return { file, clientId: activePropertyValue(fs.readFileSync(file, 'utf8'), 'client_id') };
}

function activePropertyValue(source, name) {
    const pattern = new RegExp(`^\\s*${name}\\s*:\\s*['"]([^'"]*)['"]`);
    const line = String(source || '').split(/\r?\n/).find(item => !item.trim().startsWith('//') && pattern.test(item));
    const match = line && line.match(pattern);
    return match ? match[1].trim() : '';
}

function replaceActiveProperty(file, name, value) {
    const source = fs.readFileSync(file, 'utf8');
    const lines = source.split(/(\r?\n)/);
    const pattern = new RegExp(`^(\\s*${name}\\s*:\\s*['"])([^'"]*)(['"])`);
    let replaced = false;
    for (let index = 0; index < lines.length; index += 2) {
        if (lines[index].trim().startsWith('//') || !pattern.test(lines[index])) continue;
        lines[index] = lines[index].replace(pattern, `$1${value}$3`);
        replaced = true;
        break;
    }
    if (!replaced) throw new Error(`找不到可修改配置：${name}（${file}）`);
    fs.writeFileSync(file, lines.join(''), 'utf8');
}

function replaceEnvironmentValue(file, environment, value) {
    const source = fs.readFileSync(file, 'utf8');
    const pattern = new RegExp(`(\\b${environment}\\s*:\\s*['"])([^'"]*)(['"])`);
    if (!pattern.test(source)) throw new Error(`找不到 ThinkingData ${environment} 配置`);
    fs.writeFileSync(file, source.replace(pattern, `$1${value}$3`), 'utf8');
}

function replaceTitle(source, value) {
    if (!/<title>[^<]*<\/title>/i.test(source)) throw new Error('index.ejs 缺少 title');
    return source.replace(/<title>[^<]*<\/title>/i, `<title>${escapeAttribute(value)}</title>`);
}

function replaceMetaContent(source, name, value) {
    const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const tagPattern = new RegExp(`(<meta\\b[^>]*(?:name|property)=["']${escapedName}["'][^>]*>)`, 'i');
    const tag = source.match(tagPattern);
    if (!tag) throw new Error(`index.ejs 缺少 meta：${name}`);
    const nextTag = /\bcontent=["'][^"']*["']/i.test(tag[1])
        ? tag[1].replace(/\bcontent=["'][^"']*["']/i, `content="${escapeAttribute(value)}"`)
        : tag[1].replace(/\s*\/>$/, ` content="${escapeAttribute(value)}">`);
    return source.replace(tagPattern, nextTag);
}

function escapeAttribute(value) {
    return String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function requiredValue(value, label) {
    const text = String(value || '').trim();
    if (!text) throw new Error(`${label} 不能为空`);
    return text;
}

function requiredDigits(value, label) {
    const text = requiredValue(value, label);
    if (!/^\d+$/.test(text)) throw new Error(`${label} 必须是数字`);
    return text;
}

function metaValue(meta, name) {
    const item = meta.find(entry => entry.name === name);
    return item && item.value || '';
}

function quotedProperty(source, name) {
    return quotedValue(source, new RegExp(`${name}\\s*:\\s*['"]([^'"]+)['"]`));
}

function quotedValue(source, pattern) {
    const match = String(source || '').match(pattern);
    return match ? match[1].trim() : '';
}

function readJson(file, label, errors) {
    try {
        return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
    } catch (error) {
        errors.push(`无法读取 ${label}：${file}（${error.message}）`);
        return {};
    }
}

function readText(file, label, errors) {
    try {
        return fs.readFileSync(file, 'utf8');
    } catch (error) {
        errors.push(`无法读取 ${label}：${file}（${error.message}）`);
        return '';
    }
}

function extractScripts(template, templateRoot) {
    const local = [];
    const remote = [];
    const pattern = /<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*>/gi;
    for (const match of template.matchAll(pattern)) {
        const src = match[1].trim();
        if (!src || src.includes('<%')) continue;
        if (/^https?:\/\//i.test(src)) {
            remote.push(src);
            continue;
        }
        const clean = src.replace(/[?#].*$/, '').replace(/^\.\//, '');
        const file = path.join(templateRoot, clean);
        local.push({ src, file, exists: fs.existsSync(file) });
    }
    return { local, remote };
}

function extractMetaValue(template, name) {
    if (name === 'title') {
        const title = template.match(/<title>([^<]+)<\/title>/i);
        return title ? title[1].trim() : '';
    }
    if (name === 'charset') {
        const charset = template.match(/<meta\s+charset=["']([^"']+)["']/i);
        return charset ? charset[1].trim() : '';
    }
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const tag = template.match(new RegExp(`<meta\\b[^>]*(?:name|property)=["']${escaped}["'][^>]*>`, 'i'));
    if (!tag) return '';
    const content = tag[0].match(/\bcontent=["']([^"']*)["']/i);
    return content ? content[1].trim() : '';
}

module.exports = { WEB_RELEASES, inspectWebRelease, replaceWebShareImage, saveWebReleaseSettings };
