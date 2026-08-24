'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
    analyzeDocument,
    convertProject,
    getConversionState,
    restoreLastConversion,
    scanProject,
} = require('../core/serialized-converter');

function sprite(overrides = {}) {
    return {
        __type__: 'cc.Sprite',
        _type: 0,
        _useGrayscale: false,
        _customMaterial: null,
        ...overrides,
    };
}

function label(overrides = {}) {
    return { __type__: 'cc.Label', _customMaterial: null, ...overrides };
}

function hash(content) {
    return crypto.createHash('sha256').update(content).digest('hex');
}

async function createLegacyConversion(projectRoot, relativePath, originalDocument) {
    const target = path.join(projectRoot, relativePath);
    const backupDirectory = path.join(projectRoot, 'local', 'multi-texture-batcher', 'backups', 'legacy-test');
    const backup = path.join(backupDirectory, relativePath);
    const original = `${JSON.stringify(originalDocument, null, 2)}\n`;
    const convertedDocument = originalDocument.map(component => {
        if (component.__type__ === 'cc.Sprite') return { ...component, __type__: 'MultiTextureBatcher.MultiSprite' };
        if (component.__type__ === 'cc.Label') return { ...component, __type__: 'MultiTextureBatcher.MultiLabel' };
        return component;
    });
    const converted = `${JSON.stringify(convertedDocument, null, 2)}\n`;
    const manifest = {
        version: 1,
        backupDirectory,
        files: [{
            path: relativePath.replace(/\\/g, '/'),
            originalHash: hash(original),
            convertedHash: hash(converted),
        }],
    };
    await fs.promises.mkdir(path.dirname(target), { recursive: true });
    await fs.promises.mkdir(path.dirname(backup), { recursive: true });
    await fs.promises.writeFile(target, converted, 'utf8');
    await fs.promises.writeFile(backup, original, 'utf8');
    await fs.promises.mkdir(path.join(projectRoot, 'local', 'multi-texture-batcher'), { recursive: true });
    await fs.promises.writeFile(
        path.join(projectRoot, 'local', 'multi-texture-batcher', 'last-conversion.json'),
        `${JSON.stringify(manifest, null, 2)}\n`,
        'utf8',
    );
    return { target, original, converted };
}

test('analyzes only safe standard Sprite and Label candidates', () => {
    const result = analyzeDocument([
        sprite(),
        sprite({ _type: 2 }),
        sprite({ _useGrayscale: true }),
        label(),
        label({ _customMaterial: { __uuid__: 'material' } }),
        { __type__: 'MultiTextureBatcher.MultiSprite' },
    ]);
    assert.deepEqual(result.candidates.map(item => item.sourceType), ['cc.Sprite', 'cc.Label']);
    assert.equal(result.convertedSprites, 1);
    assert.deepEqual(result.skipped, {
        'unsupported-sprite-type': 1,
        grayscale: 1,
        'custom-material': 1,
    });
});

test('rejects serialized type conversion and leaves assets untouched', async () => {
    const projectRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'multi-texture-readonly-'));
    const assetPath = path.join(projectRoot, 'assets', 'ui', 'sample.prefab');
    const source = `${JSON.stringify([sprite(), label()], null, 2)}\n`;
    await fs.promises.mkdir(path.dirname(assetPath), { recursive: true });
    await fs.promises.writeFile(assetPath, source, 'utf8');
    try {
        await assert.rejects(
            convertProject(projectRoot, { assetPaths: ['assets/ui/sample.prefab'] }),
            /不再修改 Scene\/Prefab 的 __type__/,
        );
        assert.equal(await fs.promises.readFile(assetPath, 'utf8'), source);
        assert.equal((await getConversionState(projectRoot)).restorable, false);
    } finally {
        await fs.promises.rm(projectRoot, { recursive: true, force: true });
    }
});

test('restores exact files created by the legacy converter', async () => {
    const projectRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'multi-texture-restore-'));
    try {
        const fixture = await createLegacyConversion(projectRoot, 'assets/ui/sample.prefab', [sprite(), label()]);
        const restored = await restoreLastConversion(projectRoot);
        assert.equal(restored.restoredFiles, 1);
        assert.equal(await fs.promises.readFile(fixture.target, 'utf8'), fixture.original);
        assert.equal((await getConversionState(projectRoot)).restorable, false);
    } finally {
        await fs.promises.rm(projectRoot, { recursive: true, force: true });
    }
});

test('does not overwrite a legacy-converted asset changed by the user', async () => {
    const projectRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'multi-texture-conflict-'));
    try {
        const fixture = await createLegacyConversion(projectRoot, 'assets/sample.scene', [sprite()]);
        const changed = `${JSON.stringify([{ __type__: 'MultiTextureBatcher.MultiSprite', note: 'user edit' }], null, 2)}\n`;
        await fs.promises.writeFile(fixture.target, changed, 'utf8');
        const restored = await restoreLastConversion(projectRoot);
        assert.equal(restored.restoredFiles, 0);
        assert.deepEqual(restored.conflicts, ['assets/sample.scene']);
        assert.equal(await fs.promises.readFile(fixture.target, 'utf8'), changed);
    } finally {
        await fs.promises.rm(projectRoot, { recursive: true, force: true });
    }
});

test('limits read-only scans to explicitly selected assets', async () => {
    const projectRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'multi-texture-scan-'));
    const selectedPath = path.join(projectRoot, 'assets', 'ui', 'selected.prefab');
    const untouchedPath = path.join(projectRoot, 'assets', 'ui', 'untouched.prefab');
    const source = `${JSON.stringify([sprite(), label()], null, 2)}\n`;
    await fs.promises.mkdir(path.dirname(selectedPath), { recursive: true });
    await fs.promises.writeFile(selectedPath, source, 'utf8');
    await fs.promises.writeFile(untouchedPath, source, 'utf8');
    try {
        const scan = await scanProject(projectRoot, { assetPaths: ['assets/ui/selected.prefab'] });
        assert.equal(scan.summary.files, 1);
        assert.deepEqual(scan.assets.map(asset => asset.path), ['assets/ui/selected.prefab']);
        assert.equal(await fs.promises.readFile(selectedPath, 'utf8'), source);
        assert.equal(await fs.promises.readFile(untouchedPath, 'utf8'), source);
    } finally {
        await fs.promises.rm(projectRoot, { recursive: true, force: true });
    }
});
