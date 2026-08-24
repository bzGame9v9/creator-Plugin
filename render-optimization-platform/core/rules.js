'use strict';

const path = require('path');
const { SEVERITY_ORDER, THRESHOLDS } = require('./constants');

function makeFinding(ruleId, severity, category, data) {
    return {
        id: `${ruleId}:${data.key || data.affectedAssets?.[0] || 'project'}`,
        ruleId,
        severity,
        category,
        title: data.title,
        description: data.description,
        evidence: data.evidence || [],
        affectedAssets: data.affectedAssets || [],
        affectedNodes: data.affectedNodes || [],
        metrics: data.metrics || {},
        recommendation: data.recommendation,
        actionSafety: data.actionSafety || 'manual',
        confidence: data.confidence || 'high',
    };
}

function groupBy(items, selectKey) {
    const result = new Map();
    for (const item of items) {
        const key = selectKey(item);
        if (!result.has(key)) result.set(key, []);
        result.get(key).push(item);
    }
    return result;
}

function isPowerOfTwo(value) {
    return value > 0 && (value & (value - 1)) === 0;
}

function textureFindings(scan) {
    const findings = [];
    const textures = scan.assetIndex.records.filter(record => record.texture);
    const oversized = textures
        .filter(record => Math.max(record.texture.width, record.texture.height) > THRESHOLDS.highTextureDimension)
        .sort((left, right) => right.texture.area - left.texture.area)
        .slice(0, 80);

    for (const record of oversized) {
        const maxDimension = Math.max(record.texture.width, record.texture.height);
        const severity = maxDimension >= THRESHOLDS.criticalTextureDimension ? 'critical' : 'high';
        findings.push(makeFinding('texture.oversized', severity, 'texture', {
            key: record.relativePath,
            title: `超大纹理 ${record.texture.width} x ${record.texture.height}`,
            description: '源纹理尺寸会放大显存、上传和加载峰值，最终成本仍取决于平台压缩格式。',
            evidence: [record.relativePath],
            affectedAssets: [record.relativePath],
            metrics: {
                width: record.texture.width,
                height: record.texture.height,
                sourceBytes: record.byteSize,
                rgbaMemoryUpperBound: record.texture.rgbaMemoryBytes,
            },
            recommendation: '核对实际显示尺寸、目标平台最大纹理和压缩设置；需要缩放时由美术与业务共同确认。',
            actionSafety: 'manual',
            confidence: 'exact',
        }));
    }

    for (const record of textures) {
        const texture = record.texture;
        if (texture.mipfilter === 'none') continue;
        if (isPowerOfTwo(texture.width) && isPowerOfTwo(texture.height)) continue;
        findings.push(makeFinding('texture.npot-mipmap', 'high', 'texture', {
            key: record.relativePath,
            title: 'NPOT 纹理启用了 Mipmap',
            description: '非 2 次幂纹理的 Mipmap 和采样支持在目标设备上需要单独验证。',
            evidence: [record.relativePath],
            affectedAssets: [record.relativePath],
            metrics: { width: texture.width, height: texture.height, mipfilter: texture.mipfilter },
            recommendation: '确认该纹理是否需要 Mipmap；修改尺寸或采样参数前执行 Android、iOS、Web 回归。',
            actionSafety: 'manual',
            confidence: 'exact',
        }));
    }

    const duplicateGroups = [...scan.textureHashes.entries()]
        .map(([hash, records]) => ({ hash, records }))
        .filter(group => group.records.length > 1)
        .sort((left, right) => right.records.reduce((sum, item) => sum + item.byteSize, 0) - left.records.reduce((sum, item) => sum + item.byteSize, 0));
    for (const group of duplicateGroups.slice(0, 60)) {
        const paths = group.records.map(record => record.relativePath);
        findings.push(makeFinding('texture.exact-duplicate', 'medium', 'texture', {
            key: group.hash.slice(0, 12),
            title: `发现 ${paths.length} 份内容完全相同的纹理`,
            description: '文件 SHA-256 完全一致；是否统一引用仍需检查 Bundle、热更和业务归属。',
            evidence: paths.slice(0, THRESHOLDS.maxEvidenceItems),
            affectedAssets: paths,
            metrics: { duplicateCount: paths.length, duplicatedSourceBytes: group.records.slice(1).reduce((sum, item) => sum + item.byteSize, 0) },
            recommendation: '先确认加载边界和发布归属，再预览统一引用方案；不要直接删除文件。',
            actionSafety: 'preview',
            confidence: 'exact',
        }));
    }

    const candidateTextures = textures.filter(record => {
        const texture = record.texture;
        return texture.packable && !record.atlasPath && texture.width > 0 && texture.height > 0
            && Math.max(texture.width, texture.height) <= THRESHOLDS.atlasCandidateMaxDimension;
    });
    const candidateDirectories = groupBy(candidateTextures, record => path.posix.dirname(record.relativePath));
    for (const [directory, records] of candidateDirectories) {
        const area = records.reduce((sum, record) => sum + record.texture.area, 0);
        if (records.length < THRESHOLDS.atlasCandidateMinCount || area > THRESHOLDS.atlasCandidateMaxArea) continue;
        findings.push(makeFinding('atlas.candidate-group', 'medium', 'atlas', {
            key: directory,
            title: `目录内有 ${records.length} 张小纹理可评估图集`,
            description: '这些可打包 SpriteFrame 尚未被源目录下的 Auto Atlas 覆盖。源面积不等于最终图集利用率。',
            evidence: records.slice(0, THRESHOLDS.maxEvidenceItems).map(record => record.relativePath),
            affectedAssets: records.map(record => record.relativePath),
            metrics: { textureCount: records.length, sourceArea: area },
            recommendation: '在不跨 Bundle、热更包和生命周期边界的前提下，新建 Auto Atlas 预览并对比构建产物。',
            actionSafety: 'preview',
            confidence: 'high',
        }));
    }

    return findings;
}

function materialFindings(scan) {
    const findings = [];
    const groups = groupBy(scan.materials, material => material.fingerprint);
    for (const [fingerprint, materials] of groups) {
        if (materials.length < 2) continue;
        const paths = materials.map(item => item.path);
        findings.push(makeFinding('material.equivalent-assets', 'medium', 'material', {
            key: fingerprint.slice(0, 12),
            title: `发现 ${materials.length} 个内容等价的材质资源`,
            description: 'Effect、Technique、Define、State 和 Property 的稳定指纹一致，但资源 UUID 不同。',
            evidence: paths,
            affectedAssets: paths,
            metrics: { materialCount: materials.length, effectUuid: materials[0].effectUuid },
            recommendation: '逐个确认运行时是否会修改材质实例；只对不可变且生命周期一致的资源预览统一引用。',
            actionSafety: 'preview',
            confidence: 'exact',
        }));
    }
    return findings;
}

function documentFindings(scan) {
    const findings = [];
    for (const document of scan.renderDocuments) {
        const labelsWithoutCache = document.components.filter(item => (item.kind === 'label' || item.kind === 'richText') && item.cacheMode === 0);
        if (labelsWithoutCache.length >= THRESHOLDS.labelNoneCachePerDocument) {
            findings.push(makeFinding('label.none-cache-density', 'medium', 'label', {
                key: document.path,
                title: `${document.path} 有 ${labelsWithoutCache.length} 个 NONE Cache Label`,
                description: '静态资产只能确认 CacheMode，不能确认文本运行时变化频率。',
                evidence: labelsWithoutCache.slice(0, THRESHOLDS.maxEvidenceItems).map(item => item.nodePath),
                affectedAssets: [document.path],
                affectedNodes: labelsWithoutCache.map(item => item.nodePath),
                metrics: { noneCacheLabels: labelsWithoutCache.length },
                recommendation: '运行时采样文本变化频率后，将真正静态的 Label 评估为 CHAR/BITMAP；高频数字不要盲目缓存。',
                actionSafety: 'manual',
                confidence: 'high',
            }));
        }

        if (document.nestedMasks.length) {
            findings.push(makeFinding('mask.nested', 'critical', 'mask', {
                key: document.path,
                title: `${document.path} 存在嵌套 Mask`,
                description: '嵌套 Stencil 会改变批次状态并增加渲染正确性风险。',
                evidence: document.nestedMasks.map(item => `${item.nodePath} <- ${item.ancestorPath}`),
                affectedAssets: [document.path],
                affectedNodes: document.nestedMasks.map(item => item.nodePath),
                metrics: { nestedMaskCount: document.nestedMasks.length },
                recommendation: '检查裁剪需求，优先减少嵌套层级；任何替换都必须做截图和交互回归。',
                actionSafety: 'manual',
                confidence: 'exact',
            }));
        }

        const maskCount = document.componentCounts.mask || 0;
        if (maskCount >= THRESHOLDS.masksPerDocument) {
            findings.push(makeFinding('mask.high-density', 'high', 'mask', {
                key: document.path,
                title: `${document.path} 包含 ${maskCount} 个 Mask`,
                description: 'Mask 会引入 Stencil 状态和批次边界，实际开销取决于激活状态和层级。',
                evidence: document.components.filter(item => item.kind === 'mask').map(item => item.nodePath),
                affectedAssets: [document.path],
                metrics: { maskCount },
                recommendation: '定位同屏激活的 Mask，评估裁剪、RectMask 或美术资源替代方案。',
                actionSafety: 'manual',
                confidence: 'exact',
            }));
        }

        const breaks = document.estimatedBreaks;
        if (breaks.rendererCount >= THRESHOLDS.batchBreakMinimumRenderers && breaks.estimatedMergeRate < (1 - THRESHOLDS.batchBreakRatio)) {
            findings.push(makeFinding('batch.static-break-density', 'high', 'batch', {
                key: document.path,
                title: `${document.path} 的静态渲染序列存在较多批次边界`,
                description: '按序列化 Node DFS 估算。运行时显隐、动态图集、材质实例和脚本创建会改变实际结果。',
                evidence: document.renderOrder.slice(0, THRESHOLDS.maxEvidenceItems).map(item => `${item.nodePath} [${item.kind}]`),
                affectedAssets: [document.path],
                metrics: {
                    rendererCount: breaks.rendererCount,
                    estimatedBatches: breaks.estimatedBatches,
                    estimatedMergeRate: breaks.estimatedMergeRate,
                    textureSwitches: breaks.textureSwitches,
                    materialSwitches: breaks.materialSwitches,
                    blendSwitches: breaks.blendSwitches,
                    maskBarriers: breaks.maskBarriers,
                },
                recommendation: '先在运行时验证 Flush 原因，再按同层级视觉约束评估纹理、材质和 Mask；不要自动重排 Node。',
                actionSafety: 'manual',
                confidence: 'medium',
            }));
        }
    }
    return findings;
}

function parseFindings(scan) {
    const errors = [...scan.assetIndex.parseErrors, ...scan.parseErrors];
    if (!errors.length) return [];
    return [makeFinding('scan.partial-parse', 'medium', 'coverage', {
        key: 'parse-errors',
        title: `${errors.length} 个文件无法完整解析`,
        description: '报告已继续生成，但相关资源不会进入完整依赖和渲染分析。',
        evidence: errors.slice(0, THRESHOLDS.maxEvidenceItems).map(item => `${item.path}: ${item.message}`),
        affectedAssets: errors.map(item => item.path),
        metrics: { parseErrorCount: errors.length },
        recommendation: '确认文件编码、JSON 完整性和自定义导入器格式，再重新扫描。',
        actionSafety: 'safe',
        confidence: 'exact',
    })];
}

function runRules(scan) {
    const findings = [
        ...parseFindings(scan),
        ...textureFindings(scan),
        ...materialFindings(scan),
        ...documentFindings(scan),
    ];
    findings.sort((left, right) => {
        const severity = SEVERITY_ORDER[left.severity] - SEVERITY_ORDER[right.severity];
        return severity || left.category.localeCompare(right.category) || left.title.localeCompare(right.title);
    });
    return findings.slice(0, THRESHOLDS.maxFindings);
}

module.exports = {
    isPowerOfTwo,
    makeFinding,
    runRules,
};
