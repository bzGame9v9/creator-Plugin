'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const extensionRoot = path.join(__dirname, '..');
const mainSource = fs.readFileSync(path.join(extensionRoot, 'main.js'), 'utf8');
const panelSource = fs.readFileSync(path.join(extensionRoot, 'panel', 'index.js'), 'utf8');
const packageJson = JSON.parse(fs.readFileSync(path.join(extensionRoot, 'package.json'), 'utf8'));

test('extension load only inspects runtime state', () => {
    const loadBody = mainSource.match(/exports\.load\s*=\s*function load\(\)\s*\{([\s\S]*?)\n\};/);
    assert.ok(loadBody);
    assert.match(loadBody[1], /inspectRuntime\(\)/);
    assert.doesNotMatch(loadBody[1], /installRuntime|enableRuntime|synchronizeRuntime/);
});

test('panel exposes one persistent master switch', () => {
    assert.match(panelSource, /id="masterSwitch"/);
    assert.match(panelSource, /set-master-enabled/);
    assert.doesNotMatch(panelSource, /id="installBtn"|id="removeBtn"/);
    assert.deepEqual(packageJson.contributions.messages['set-master-enabled'].methods, ['setMasterEnabled']);
});

test('Creator reload does not install runtime and the master switch controls its lifecycle', async () => {
    const projectRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'multi-texture-lifecycle-'));
    const runtimeDirectory = path.join(projectRoot, 'assets', 'resources', '__multi_texture_batcher__');
    const previousEditor = global.Editor;
    await fs.promises.mkdir(path.join(projectRoot, 'assets', 'resources'), { recursive: true });
    global.Editor = {
        Project: { path: projectRoot },
        Message: {
            send() {},
            async request() {},
        },
    };

    const mainPath = require.resolve('../main');
    delete require.cache[mainPath];
    const extension = require(mainPath);
    try {
        extension.load();
        await new Promise(resolve => setTimeout(resolve, 20));
        assert.equal(fs.existsSync(runtimeDirectory), false);

        const enabledState = await extension.methods.setMasterEnabled(true);
        assert.equal(enabledState.masterEnabled, true);
        assert.equal(fs.existsSync(runtimeDirectory), true);

        const disabledState = await extension.methods.setMasterEnabled(false);
        assert.equal(disabledState.masterEnabled, false);
        assert.equal(fs.existsSync(runtimeDirectory), false);
    } finally {
        delete require.cache[mainPath];
        global.Editor = previousEditor;
        await fs.promises.rm(projectRoot, { recursive: true, force: true });
    }
});
