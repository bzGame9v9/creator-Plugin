'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const runtimeApi = require('../runtime-template/multi-texture-batcher');

const runtimeSource = fs.readFileSync(path.join(__dirname, '..', 'runtime-template', 'multi-texture-batcher.js'), 'utf8');
const effectSource = fs.readFileSync(path.join(__dirname, '..', 'runtime-template', 'multi-texture-batch.effect'), 'utf8');

test('parses enabled, disabled, sprite, and mixed self-test modes', () => {
    assert.deepEqual(runtimeApi.parseRuntimeOptions('?foo=1'), {
        mode: '', disabled: false, selfTest: false, mixedSelfTest: false,
        nineTextureSelfTest: false, labelCacheMode: 'NONE', maskSelfTest: false,
    });
    assert.equal(runtimeApi.parseRuntimeOptions('?multiTextureBatcher=selftest').selfTest, true);
    assert.equal(runtimeApi.parseRuntimeOptions('?multiTextureBatcher=selftest-mixed').mixedSelfTest, true);
    assert.equal(runtimeApi.parseRuntimeOptions('?multiTextureBatcher=selftest-off').disabled, true);
    assert.equal(runtimeApi.parseRuntimeOptions('?multiTextureBatcher=selftest-nine').nineTextureSelfTest, true);
    assert.equal(runtimeApi.parseRuntimeOptions('?multiTextureBatcher=selftest-char').labelCacheMode, 'CHAR');
    assert.equal(runtimeApi.parseRuntimeOptions('?multiTextureBatcher=selftest-bitmap').labelCacheMode, 'BITMAP');
    assert.equal(runtimeApi.parseRuntimeOptions('?multiTextureBatcher=selftest-mask').maskSelfTest, true);
});

test('supports SIMPLE and SLICED sprites only', () => {
    const spriteTypes = { SIMPLE: 0, SLICED: 1, TILED: 2, FILLED: 3 };
    assert.equal(runtimeApi.supportsSpriteType(0, spriteTypes), true);
    assert.equal(runtimeApi.supportsSpriteType(1, spriteTypes), true);
    assert.equal(runtimeApi.supportsSpriteType(2, spriteTypes), false);
    assert.equal(runtimeApi.supportsSpriteType(3, spriteTypes), false);
});

test('uses an explicit texture-slot attribute instead of UV encoding', () => {
    assert.match(effectSource, /in float a_texCoord1/);
    assert.match(effectSource, /textureIndex = a_texCoord1/);
    assert.doesNotMatch(effectSource, /floor\s*\(\s*a_texCoord\.x/);
});

test('upgrades only renderer instances and keeps serialized component types untouched', () => {
    assert.doesNotMatch(runtimeSource, /Batcher2D\.prototype/);
    assert.doesNotMatch(runtimeSource, /Sprite\.Assembler\s*=/);
    assert.doesNotMatch(runtimeSource, /Label\.Assembler\s*=/);
    assert.doesNotMatch(runtimeSource, /ccclass\('MultiTextureBatcher\.MultiSprite'/);
    assert.doesNotMatch(runtimeSource, /ccclass\('MultiTextureBatcher\.MultiLabel'/);
    assert.match(runtimeSource, /runtime\.upgradeRenderer/);
    assert.match(runtimeSource, /Object\.defineProperty\(renderer, methodName/);
    assert.match(runtimeSource, /renderer\.constructor === cc\.Sprite/);
    assert.match(runtimeSource, /renderer\.constructor === cc\.Label/);
    assert.match(runtimeSource, /runtime\.ensureAutoScopes/);
});

test('reuses scope batch materials and never destroys cached materials while running', () => {
    assert.match(runtimeSource, /runtime\.updateMaterialPasses/);
    assert.match(runtimeSource, /pass\.update\(\)/);
    assert.match(runtimeSource, /cc\.Director\.EVENT_END_FRAME/);
    assert.match(runtimeSource, /runtime\.objectId\(assignment\.scope\) \+ ':' \+ group\.index/);
    assert.match(runtimeSource, /cached\.resourceSignature !== resourceSignature/);
    assert.match(runtimeSource, /renderData\.material = typeof renderer\.getRenderMaterial/);
    assert.doesNotMatch(runtimeSource, /runtime\.frame\s*\+=\s*1/);
    assert.doesNotMatch(runtimeSource, /runtime\.materialCache\.set\(key, record\);\s*runtime\.collectUnusedMaterials/);
    assert.doesNotMatch(runtimeSource, /record\.material.*\.destroy\(\)/);
});

test('loads the runtime on Web but not Native or Mini Game', () => {
    const meta = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'runtime-template', 'multi-texture-batcher.js.meta'), 'utf8'));
    assert.equal(meta.userData.loadPluginInWeb, true);
    assert.equal(meta.userData.loadPluginInNative, false);
    assert.equal(meta.userData.loadPluginInMiniGame, false);
});
