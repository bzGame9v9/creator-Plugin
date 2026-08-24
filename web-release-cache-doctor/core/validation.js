'use strict';

const fs = require('fs');
const path = require('path');

function normalizeInputs(input, projectRoot) {
    const root = path.resolve(projectRoot || process.cwd());
    return {
        publicUrl: String(input && input.publicUrl || '').trim(),
        originUrl: String(input && input.originUrl || '').trim(),
        buildDirectory: resolvePath(input && input.buildDirectory, root),
        zipPath: resolvePath(input && input.zipPath, root),
        timeout: Number(input && input.timeout),
        concurrency: Number(input && input.concurrency),
    };
}

function resolvePath(value, root) {
    if (!value) return '';
    return path.isAbsolute(String(value)) ? path.resolve(String(value)) : path.resolve(root, String(value));
}

function validateInputs(input, options = {}) {
    const values = input || {};
    const errors = {};
    if (options.requirePublicUrl !== false) {
        if (!values.publicUrl) errors.publicUrl = '游戏地址不能为空。';
        else {
            try {
                const url = new URL(values.publicUrl);
                if (!['http:', 'https:'].includes(url.protocol)) errors.publicUrl = '游戏地址协议必须是 http 或 https。';
            } catch (error) {
                errors.publicUrl = '游戏地址不是有效的 http/https URL。';
            }
        }
    }
    if (values.originUrl) {
        try {
            const origin = new URL(values.originUrl);
            if (!['http:', 'https:'].includes(origin.protocol)) errors.originUrl = '源站地址协议必须是 http 或 https。';
        } catch (error) {
            errors.originUrl = '源站地址不是有效的 http/https URL。';
        }
    }
    if (!values.buildDirectory) errors.buildDirectory = '本地构建目录不能为空。';
    else if (!fs.existsSync(values.buildDirectory) || !fs.statSync(values.buildDirectory).isDirectory()) errors.buildDirectory = '本地构建目录不存在或不是目录。';
    if (!values.zipPath) errors.zipPath = '本地发布 ZIP 不能为空。';
    else if (!fs.existsSync(values.zipPath) || !fs.statSync(values.zipPath).isFile()) errors.zipPath = '本地发布 ZIP 不存在或不是文件。';
    if (values.buildDirectory && values.zipPath && fs.existsSync(values.buildDirectory) && fs.existsSync(values.zipPath)) {
        const buildName = path.basename(values.buildDirectory);
        const zipName = path.basename(values.zipPath).replace(/\.zip$/i, '');
        if (buildName !== zipName) errors.zipPath = `ZIP 与构建目录 outputName 不匹配：${zipName} != ${buildName}。`;
    }
    if (!Number.isFinite(values.timeout) || values.timeout < 1000 || values.timeout > 120000) errors.timeout = '请求超时必须是 1000 到 120000 毫秒。';
    if (!Number.isInteger(values.concurrency) || values.concurrency < 1 || values.concurrency > 16) errors.concurrency = '并发数必须是 1 到 16 的整数。';
    return errors;
}

module.exports = { normalizeInputs, validateInputs };
