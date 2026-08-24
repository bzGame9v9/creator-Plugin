'use strict';

const fs = require('fs');
const path = require('path');

function writeReport(report, directory) {
    fs.mkdirSync(directory, { recursive: true });
    const jsonPath = path.join(directory, 'latest.json');
    const markdownPath = path.join(directory, 'latest.md');
    const htmlPath = path.join(directory, 'latest.html');
    const json = JSON.stringify(report, null, 2);
    const markdown = toMarkdown(report);
    const html = toHtml(report);
    fs.writeFileSync(jsonPath, json, 'utf8');
    fs.writeFileSync(markdownPath, markdown, 'utf8');
    fs.writeFileSync(htmlPath, html, 'utf8');
    const files = { jsonPath, markdownPath, htmlPath };
    if (report.mode === 'failed') {
        files.failedJsonPath = path.join(directory, 'failed-latest.json');
        files.failedMarkdownPath = path.join(directory, 'failed-latest.md');
        files.failedHtmlPath = path.join(directory, 'failed-latest.html');
        fs.writeFileSync(files.failedJsonPath, json, 'utf8');
        fs.writeFileSync(files.failedMarkdownPath, markdown, 'utf8');
        fs.writeFileSync(files.failedHtmlPath, html, 'utf8');
    }
    return files;
}

function toMarkdown(report) {
    const lines = [
        '# Web 发布诊断报告',
        '',
        `- 结论：${report.conclusion}`,
        `- 生成时间：${report.generatedAt}`,
        `- releaseId：${report.local && report.local.manifest && report.local.manifest.releaseId || '无'}`,
        `- ZIP：${report.zipPath || '无'}`,
        `- 公网地址：${report.publicUrl || '无'}`,
        '',
        '| 层级 | 文件 | HTTP | 字节 | SHA-256 | Cache-Control | ETag | Age | CF-Cache-Status |',
        '| --- | --- | ---: | ---: | --- | --- | --- | --- | --- |',
    ];
    [report.origin, report.public].filter(Boolean).forEach((layer) => {
        (layer.responses || []).forEach((row) => lines.push(
            `| ${layer.label} | ${row.path} | ${row.status} | ${row.bytes} | ${row.sha256 || ''} | ${row.cacheControl || ''} | ${row.etag || ''} | ${row.age || ''} | ${row.cfCacheStatus || ''} |`
        ));
    });
    lines.push('', `问题分类：${Array.from(new Set(report.issues || [])).join('、') || '无'}`);
    lines.push('', '本报告只读取 ZIP、公开 URL 和用户主动导入的浏览器诊断 JSON，不读取 Cookie、localStorage、Token 或 API 响应。');
    return `${lines.join('\n')}\n`;
}

function toHtml(report) {
    const escape = (value) => String(value == null ? '' : value)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    const rows = [report.origin, report.public].filter(Boolean).flatMap((layer) => {
        return (layer.responses || []).map((row) => `<tr><td>${escape(layer.label)}</td><td>${escape(row.path)}</td><td>${escape(row.status)}</td><td>${escape(row.bytes)}</td><td><code>${escape(row.sha256)}</code></td><td>${escape(row.cacheControl)}</td><td>${escape(row.cfCacheStatus)}</td></tr>`);
    }).join('');
    return `<!doctype html><meta charset="utf-8"><title>Web 发布诊断报告</title><style>body{font:14px system-ui;background:#202124;color:#eee;padding:24px}table{border-collapse:collapse;width:100%}td,th{border:1px solid #555;padding:6px;text-align:left}code{overflow-wrap:anywhere}</style><h1>Web 发布诊断报告</h1><p>${escape(report.conclusion)}</p><p>releaseId：<code>${escape(report.local && report.local.manifest && report.local.manifest.releaseId || '')}</code></p><table><thead><tr><th>层级</th><th>文件</th><th>HTTP</th><th>字节</th><th>SHA-256</th><th>Cache-Control</th><th>CF-Cache-Status</th></tr></thead><tbody>${rows}</tbody></table>`;
}

module.exports = { toHtml, toMarkdown, writeReport };
