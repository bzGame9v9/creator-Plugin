'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { getRuntimeStatus, installRuntime, removeRuntime } = require('../core/installer');

test('installs, refreshes, and removes isolated runtime assets', async () => {
    const projectRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'multi-texture-batcher-'));
    await fs.promises.mkdir(path.join(projectRoot, 'assets', 'resources'), { recursive: true });
    try {
        const first = await installRuntime(projectRoot);
        assert.equal(first.installed, true);
        assert.equal(first.changed, true);
        assert.equal(getRuntimeStatus(projectRoot).installed, true);

        const second = await installRuntime(projectRoot);
        assert.equal(second.changed, false);

        await removeRuntime(projectRoot);
        assert.equal(getRuntimeStatus(projectRoot).installed, false);
    } finally {
        await fs.promises.rm(projectRoot, { recursive: true, force: true });
    }
});
