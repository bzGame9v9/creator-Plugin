'use strict';

const fs = require('fs');
const path = require('path');
const { ensureDirectory } = require('./file-system');

function formatBytes(bytes) {
    const value = Number(bytes || 0);
    if (value < 1024) return `${value} B`;
    if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KiB`;
    if (value < 1024 * 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MiB`;
    return `${(value / (1024 * 1024 * 1024)).toFixed(2)} GiB`;
}

function reportToMarkdown(report) {
    const severity = report.summary.findingsBySeverity;
    const lines = [
        '# Render Optimization Report',
        '',
        `- Project: ${report.project.name}`,
        `- Creator: ${report.creatorVersion}`,
        `- Plugin: ${report.pluginVersion}`,
        `- Generated: ${report.generatedAt}`,
        `- Duration: ${report.durationMs} ms`,
        `- Partial: ${report.partial ? 'yes' : 'no'}`,
        '',
        '## Summary',
        '',
        `- Assets: ${report.summary.assetCount}`,
        `- Scenes / Prefabs: ${report.summary.sceneCount} / ${report.summary.prefabCount}`,
        `- Textures / Materials / Atlases: ${report.summary.textureCount} / ${report.summary.materialCount} / ${report.summary.atlasCount}`,
        `- Nodes / Renderers: ${report.summary.nodeCount} / ${report.summary.rendererCount}`,
        `- Findings: Critical ${severity.critical || 0}, High ${severity.high || 0}, Medium ${severity.medium || 0}, Low ${severity.low || 0}, Info ${severity.info || 0}`,
        `- Texture source bytes: ${formatBytes(report.metrics.textureSourceBytes)}`,
        `- RGBA memory upper bound: ${formatBytes(report.metrics.textureRgbaMemoryUpperBound)}`,
        '',
        '## Findings',
        '',
    ];

    if (!report.findings.length) {
        lines.push('No finding matched the current rules.', '');
    } else {
        for (const finding of report.findings) {
            lines.push(`### [${finding.severity.toUpperCase()}] ${finding.title}`);
            lines.push('');
            lines.push(finding.description);
            lines.push('');
            lines.push(`- Rule: ${finding.ruleId}`);
            lines.push(`- Category: ${finding.category}`);
            lines.push(`- Confidence: ${finding.confidence}`);
            lines.push(`- Action safety: ${finding.actionSafety}`);
            lines.push(`- Recommendation: ${finding.recommendation}`);
            if (finding.evidence.length) {
                lines.push('- Evidence:');
                for (const item of finding.evidence.slice(0, 30)) lines.push(`  - ${String(item).replace(/\r?\n/g, ' ')}`);
            }
            lines.push('');
        }
    }

    lines.push('## Limitations', '');
    for (const limitation of report.limitations) lines.push(`- ${limitation}`);
    lines.push('');
    return lines.join('\n');
}

function safeTimestamp(value) {
    return String(value || new Date().toISOString()).replace(/[:.]/g, '-');
}

async function writeReport(report, outputDirectory, options = {}) {
    await ensureDirectory(outputDirectory);
    const baseName = options.baseName || `render-report-${safeTimestamp(report.generatedAt)}`;
    const jsonPath = path.join(outputDirectory, `${baseName}.json`);
    const markdownPath = path.join(outputDirectory, `${baseName}.md`);
    await fs.promises.writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    if (options.markdown !== false) {
        await fs.promises.writeFile(markdownPath, `${reportToMarkdown(report)}\n`, 'utf8');
    }
    return {
        directory: outputDirectory,
        jsonPath,
        markdownPath: options.markdown === false ? '' : markdownPath,
    };
}

module.exports = {
    formatBytes,
    reportToMarkdown,
    writeReport,
};
