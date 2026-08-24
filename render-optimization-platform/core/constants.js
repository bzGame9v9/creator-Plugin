'use strict';

const PLUGIN_VERSION = '1.0.0';
const REPORT_SCHEMA_VERSION = 1;

const COMPONENT_KINDS = Object.freeze({
    'cc.Sprite': 'sprite',
    'cc.Label': 'label',
    'cc.RichText': 'richText',
    'cc.Mask': 'mask',
    'cc.Graphics': 'graphics',
    'cc.UIOpacity': 'uiOpacity',
    'sp.Skeleton': 'spine',
    'dragonBones.ArmatureDisplay': 'dragonBones',
    'cc.ParticleSystem2D': 'particle2D',
});

const RENDERER_KINDS = new Set([
    'sprite',
    'label',
    'richText',
    'mask',
    'graphics',
    'spine',
    'dragonBones',
    'particle2D',
]);

const STRUCTURED_EXTENSIONS = new Set([
    '.scene',
    '.prefab',
    '.mtl',
    '.material',
    '.pac',
    '.anim',
    '.labelatlas',
    '.spriteatlas',
    '.json',
]);

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp']);

const SEVERITY_ORDER = Object.freeze({
    critical: 0,
    high: 1,
    medium: 2,
    low: 3,
    info: 4,
});

const THRESHOLDS = Object.freeze({
    criticalTextureDimension: 4096,
    highTextureDimension: 2048,
    highTextureMemoryBytes: 16 * 1024 * 1024,
    largeSourceBytes: 4 * 1024 * 1024,
    atlasCandidateMaxDimension: 1024,
    atlasCandidateMaxArea: Math.floor(2048 * 2048 * 0.78),
    atlasCandidateMinCount: 4,
    labelNoneCachePerDocument: 8,
    masksPerDocument: 4,
    batchBreakMinimumRenderers: 8,
    batchBreakRatio: 0.5,
    maxFindings: 500,
    maxEvidenceItems: 30,
});

module.exports = {
    COMPONENT_KINDS,
    IMAGE_EXTENSIONS,
    PLUGIN_VERSION,
    RENDERER_KINDS,
    REPORT_SCHEMA_VERSION,
    SEVERITY_ORDER,
    STRUCTURED_EXTENSIONS,
    THRESHOLDS,
};
