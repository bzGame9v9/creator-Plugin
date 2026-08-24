'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { analyzeSerializedAsset, materialFingerprint } = require('../core/serialized-analyzer');

const fixtureRoot = path.join(__dirname, 'fixtures', 'project');

test('analyzes nested masks and deterministic render order', async () => {
    const record = {
        uuid: '55555555-5555-4555-8555-555555555555',
        dbUrl: 'db://assets/ui/nested-mask.prefab',
        relativePath: 'assets/ui/nested-mask.prefab',
        absolutePath: path.join(fixtureRoot, 'assets', 'ui', 'nested-mask.prefab'),
        extension: '.prefab',
    };
    const result = await analyzeSerializedAsset(record);
    assert.equal(result.parseError, null);
    assert.equal(result.renderDocument.nodeCount, 3);
    assert.equal(result.renderDocument.nestedMasks.length, 1);
    assert.equal(result.renderDocument.nestedMasks[0].nodePath, 'Root/OuterMask/InnerMask');
    assert.equal(result.renderDocument.componentCounts.label, 8);
    assert.equal(result.renderDocument.renderOrder[0].nodePath, 'Root/OuterMask');
    assert.equal(result.renderDocument.estimatedBreaks.rendererCount, 11);
});

test('material fingerprint ignores editor identity fields', () => {
    const first = { __type__: 'cc.Material', _name: 'A', _id: 'one', _props: [{ value: 2 }], _defines: [{ TEST: true }] };
    const second = { _defines: [{ TEST: true }], _props: [{ value: 2 }], _id: 'two', _name: 'B', __type__: 'cc.Material' };
    assert.equal(materialFingerprint(first), materialFingerprint(second));
});
