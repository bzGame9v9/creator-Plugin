'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { installRuntimeTelemetry } = require('../runtime/telemetry');

test('runtime telemetry preserves return values, errors, and can uninstall', () => {
    const target = {
        value: 2,
        commitComp(delta) { this.value += delta; return this.value; },
        flushMaterial() { throw new Error('expected'); },
    };
    const originalCommit = target.commitComp;
    const telemetry = installRuntimeTelemetry(target);
    assert.equal(target.commitComp(3), 5);
    assert.throws(() => target.flushMaterial(), /expected/);
    const snapshot = telemetry.snapshot();
    assert.equal(snapshot.calls.commitComp, 1);
    assert.equal(snapshot.calls.flushMaterial, 1);
    assert.equal(snapshot.errors.flushMaterial, 1);
    assert.ok(snapshot.totalTimeMs.commitComp >= 0);
    assert.equal(telemetry.uninstall(), true);
    assert.equal(target.commitComp, originalCommit);
    assert.equal(telemetry.uninstall(), false);
});
