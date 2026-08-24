'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildTextureSetPlan } = require('../runtime-template/multi-texture-batcher');

function renderer(textureKey, stateKey = 'default') {
    return { textureKey, stateKey };
}

test('reuses a slot when a texture appears more than once', () => {
    const plan = buildTextureSetPlan([
        renderer('a'),
        renderer('b'),
        renderer('a'),
        renderer('c'),
    ], 8);
    assert.equal(plan.groups.length, 1);
    assert.deepEqual(plan.groups[0].textureKeys, ['a', 'b', 'c']);
    assert.deepEqual(plan.assignments.map(item => item && item.slot), [0, 1, 0, 2]);
});

test('freezes the first set and starts a second set for texture nine', () => {
    const entries = Array.from({ length: 9 }, (_, index) => renderer(`texture-${index}`));
    const plan = buildTextureSetPlan(entries, 8);
    assert.equal(plan.groups.length, 2);
    assert.equal(plan.groups[0].frozen, true);
    assert.deepEqual(plan.groups[0].textureKeys, entries.slice(0, 8).map(entry => entry.textureKey));
    assert.deepEqual(plan.groups[1].textureKeys, ['texture-8']);
    assert.deepEqual(plan.assignments.map(item => item.slot), [0, 1, 2, 3, 4, 5, 6, 7, 0]);
});

test('never merges across a barrier or render state change', () => {
    const plan = buildTextureSetPlan([
        renderer('a', 'layer-1'),
        renderer('b', 'layer-1'),
        { barrier: true },
        renderer('c', 'layer-1'),
        renderer('d', 'layer-2'),
    ], 8);
    assert.deepEqual(plan.groups.map(group => group.textureKeys), [['a', 'b'], ['c'], ['d']]);
});

test('clamps invalid slot counts to a safe range', () => {
    assert.equal(buildTextureSetPlan([renderer('a')], 0).slotCount, 8);
    assert.equal(buildTextureSetPlan([renderer('a')], 64).slotCount, 8);
    assert.equal(buildTextureSetPlan([renderer('a'), renderer('b')], 1).groups.length, 2);
});
