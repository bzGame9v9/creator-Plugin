'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { scanProject } = require('../core/scanner');

const fixtureRoot = path.join(__dirname, 'fixtures', 'project');

test('scans a Creator fixture and emits evidence-backed findings', async () => {
    const progressPhases = new Set();
    const report = await scanProject(fixtureRoot, {
        onProgress(progress) { progressPhases.add(progress.phase); },
    });
    assert.equal(report.creatorVersion, '3.8.6');
    assert.equal(report.summary.assetCount, 5);
    assert.equal(report.summary.prefabCount, 1);
    assert.equal(report.summary.textureCount, 2);
    assert.equal(report.summary.materialCount, 2);
    assert.equal(report.summary.componentCounts.mask, 2);
    assert.equal(report.summary.componentCounts.label, 8);
    assert.equal(report.metrics.runtime.available, false);
    assert.ok(report.findings.some(finding => finding.ruleId === 'texture.exact-duplicate'));
    assert.ok(report.findings.some(finding => finding.ruleId === 'material.equivalent-assets'));
    assert.ok(report.findings.some(finding => finding.ruleId === 'mask.nested'));
    assert.ok(report.findings.some(finding => finding.ruleId === 'label.none-cache-density'));
    assert.ok(progressPhases.has('complete'));
});

test('honors a cancellation signal before reading assets', async () => {
    await assert.rejects(
        scanProject(fixtureRoot, { signal: { cancelled: true } }),
        error => error && error.code === 'SCAN_CANCELLED',
    );
});
