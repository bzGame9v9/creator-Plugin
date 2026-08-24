(function initializeMultiTextureBatcher(root, factory) {
    'use strict';

    var api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root && root.cc) api.bootstrap(root);
}(typeof globalThis !== 'undefined' ? globalThis : this, function createMultiTextureBatcherApi() {
    'use strict';

    var VERSION = '0.3.2';
    var MAX_TEXTURE_SLOTS = 8;
    var EFFECT_PATH = '__multi_texture_batcher__/multi-texture-batch';
    var GLOBAL_KEY = '__MULTI_TEXTURE_BATCHER_RUNTIME__';
    var SELF_TEST_SCENE_NAME = 'MultiTextureBatcherSelfTest';
    var SLOT_OFFSET = 9;

    function parseRuntimeOptions(search) {
        var mode = '';
        var query = String(search || '').replace(/^\?/, '').split('&');
        for (var index = 0; index < query.length; index += 1) {
            var pair = query[index].split('=');
            if (decodeURIComponent(pair[0] || '') === 'multiTextureBatcher') {
                mode = decodeURIComponent(pair[1] || '');
                break;
            }
        }
        return {
            mode: mode,
            disabled: mode === 'off' || mode === 'selftest-off',
            selfTest: /^selftest/.test(mode),
            mixedSelfTest: mode === 'selftest-mixed' || mode === 'selftest-char' || mode === 'selftest-bitmap',
            nineTextureSelfTest: mode === 'selftest-nine',
            labelCacheMode: mode === 'selftest-char' ? 'CHAR' : mode === 'selftest-bitmap' ? 'BITMAP' : 'NONE',
            maskSelfTest: mode === 'selftest-mask',
        };
    }

    function buildTextureSetPlan(entries, slotCount) {
        var limit = Math.max(1, Math.min(MAX_TEXTURE_SLOTS, Number(slotCount) || MAX_TEXTURE_SLOTS));
        var groups = [];
        var assignments = new Array(entries.length).fill(null);
        var current = null;

        function start(entry) {
            current = {
                stateKey: entry.stateKey || 'default',
                textureKeys: [],
                slots: Object.create(null),
                entryIndexes: [],
                frozen: false,
            };
        }

        function freeze() {
            if (!current) return;
            current.frozen = true;
            current.index = groups.length;
            groups.push(current);
            current = null;
        }

        for (var index = 0; index < entries.length; index += 1) {
            var entry = entries[index];
            if (!entry || entry.barrier || !entry.textureKey) {
                freeze();
                continue;
            }
            if (!current || current.stateKey !== (entry.stateKey || 'default')) {
                freeze();
                start(entry);
            }
            var slot = current.slots[entry.textureKey];
            if (slot === undefined && current.textureKeys.length >= limit) {
                freeze();
                start(entry);
            }
            slot = current.slots[entry.textureKey];
            if (slot === undefined) {
                slot = current.textureKeys.length;
                current.slots[entry.textureKey] = slot;
                current.textureKeys.push(entry.textureKey);
            }
            current.entryIndexes.push(index);
            assignments[index] = { groupIndex: groups.length, slot: slot };
        }
        freeze();
        return { slotCount: limit, groups: groups, assignments: assignments };
    }

    function isTextureReady(texture) {
        if (!texture || typeof texture.getGFXTexture !== 'function') return false;
        var gfxTexture = texture.getGFXTexture();
        return !!gfxTexture && Number(gfxTexture.width) > 0 && Number(gfxTexture.height) > 0;
    }

    function textureResource(frame) {
        return frame && frame.texture || frame || null;
    }

    function supportsSpriteType(spriteType, spriteTypes) {
        return spriteType === spriteTypes.SIMPLE || spriteType === spriteTypes.SLICED;
    }

    function createRuntime(cc, runtimeRoot) {
        var runtime = {
            cc: cc,
            root: runtimeRoot,
            version: VERSION,
            enabled: true,
            effectAsset: null,
            slotCount: MAX_TEXTURE_SLOTS,
            scopes: new Set(),
            classes: {},
            materialCache: new Map(),
            pluginMaterials: new WeakSet(),
            pluginRenderers: new Set(),
            upgradedRenderers: new Set(),
            originalMaterials: new WeakMap(),
            spriteAssemblerProxies: new WeakMap(),
            labelAssemblerProxies: new WeakMap(),
            objectIds: new WeakMap(),
            gfxIds: new WeakMap(),
            nextObjectId: 1,
            nextGfxId: 1,
            nextMaterialId: 1,
            frame: 0,
            lastMaterialCleanupFrame: -1,
            selfTest: null,
            autoScopes: new Set(),
            autoScopeFrame: 0,
        };

        runtime.vertexFormat = createVertexFormat(cc);
        runtime.slotCount = detectSlotCount(cc);

        runtime.objectId = function objectId(value) {
            if (!value || (typeof value !== 'object' && typeof value !== 'function')) return 'null';
            var id = runtime.objectIds.get(value);
            if (!id) {
                id = runtime.nextObjectId++;
                runtime.objectIds.set(value, id);
            }
            return String(id);
        };

        runtime.gfxId = function gfxId(value) {
            if (!value || (typeof value !== 'object' && typeof value !== 'function')) return 'none';
            var id = runtime.gfxIds.get(value);
            if (!id) {
                id = runtime.nextGfxId++;
                runtime.gfxIds.set(value, id);
            }
            return String(id);
        };

        runtime.textureKey = function textureKey(texture, frame) {
            var sampler = frame && typeof frame.getGFXSampler === 'function' ? frame.getGFXSampler() : null;
            return runtime.objectId(texture) + ':' + (sampler && sampler.hash || 0);
        };

        runtime.isPluginMaterial = function isPluginMaterial(material) {
            return !!material && (runtime.pluginMaterials.has(material) || material.effectAsset === runtime.effectAsset);
        };

        runtime.markDirty = function markDirty(renderer) {
            if (renderer && typeof renderer._markForUpdateRenderData === 'function') renderer._markForUpdateRenderData();
        };

        runtime.requestRenderData = function requestRenderData(renderer, drawInfoType) {
            var RenderData = cc.RenderData || cc.UI && cc.UI.RenderData;
            if (!RenderData || typeof RenderData.add !== 'function') {
                return cc.UIRenderer.prototype.requestRenderData.call(renderer, drawInfoType);
            }
            var data = RenderData.add(runtime.vertexFormat);
            data.initRenderDrawInfo(renderer, typeof drawInfoType === 'number' ? drawInfoType : 0);
            renderer._renderData = data;
            return data;
        };

        runtime.writeTextureSlot = function writeTextureSlot(renderer, slot) {
            var renderData = renderer && renderer.renderData;
            if (!renderData || !renderData.chunk || renderData.floatStride <= SLOT_OFFSET) return;
            var vertexData = renderData.chunk.vb;
            var stride = renderData.floatStride;
            var vertexCount = Number(renderData.vertexCount || renderData.dataLength || 0);
            for (var index = 0; index < vertexCount; index += 1) {
                vertexData[index * stride + SLOT_OFFSET] = slot;
            }
            if (renderData.chunk.meshBuffer && typeof renderData.chunk.meshBuffer.setDirty === 'function') {
                renderData.chunk.meshBuffer.setDirty();
            }
        };

        runtime.afterAssemblerUpdate = function afterAssemblerUpdate(renderer) {
            var assignment = renderer && renderer.__multiTextureAssignment;
            runtime.writeTextureSlot(renderer, assignment ? assignment.slot : 0);
        };

        runtime.getSpriteAssemblerProxy = function getSpriteAssemblerProxy(original) {
            return getAssemblerProxy(runtime, original, runtime.spriteAssemblerProxies);
        };

        runtime.getLabelAssemblerProxy = function getLabelAssemblerProxy(original) {
            return getAssemblerProxy(runtime, original, runtime.labelAssemblerProxies);
        };

        runtime.flushSpriteAssembler = function flushSpriteAssembler(renderer) {
            cc.Sprite.prototype._flushAssembler.call(renderer);
            if (renderer._assembler) renderer._assembler = runtime.getSpriteAssemblerProxy(renderer._assembler);
        };

        runtime.flushLabelAssembler = function flushLabelAssembler(renderer) {
            cc.Label.prototype._flushAssembler.call(renderer);
            if (renderer._assembler) renderer._assembler = runtime.getLabelAssemblerProxy(renderer._assembler);
        };

        runtime.rendererKind = function rendererKind(renderer) {
            if (!renderer) return '';
            if (renderer.__multiTextureRendererKind) return renderer.__multiTextureRendererKind;
            if (renderer.constructor === cc.Sprite) return 'sprite';
            if (renderer.constructor === cc.Label) return 'label';
            return '';
        };

        runtime.canUpgradeRenderer = function canUpgradeRenderer(renderer, kind) {
            if (!renderer || !kind) return false;
            if (renderer.customMaterial && !runtime.isPluginMaterial(renderer.customMaterial)) return false;
            if (kind === 'sprite') {
                if (!supportsSpriteType(renderer.type, cc.Sprite.Type) || renderer.grayscale) return false;
            }
            var frame = renderer.spriteFrame;
            var texture = textureResource(frame);
            if (!frame || !texture || !isTextureReady(texture)) return false;
            if (cc.RenderTexture && texture instanceof cc.RenderTexture) return false;
            if (isAlphaSeparated(cc, texture)) return false;
            return true;
        };

        runtime.spriteInstanceMethods = {
            requestRenderData: function requestRenderData(drawInfoType) {
                return runtime.requestRenderData(this, drawInfoType);
            },
            _flushAssembler: function flushAssembler() {
                runtime.flushSpriteAssembler(this);
            },
            _render: function render(render) {
                runtime.renderComponent(this, render, cc.Sprite.prototype._render);
            },
        };

        runtime.labelInstanceMethods = {
            requestRenderData: function requestRenderData(drawInfoType) {
                return runtime.requestRenderData(this, drawInfoType);
            },
            _flushAssembler: function flushAssembler() {
                runtime.flushLabelAssembler(this);
            },
            _render: function render(render) {
                runtime.renderComponent(this, render, cc.Label.prototype._render);
            },
        };

        runtime.upgradeRenderer = function upgradeRenderer(renderer) {
            if (!renderer || !renderer.isValid) return false;
            if (renderer.__multiTextureRendererKind) return true;
            var kind = runtime.rendererKind(renderer);
            if (!runtime.canUpgradeRenderer(renderer, kind)) return false;
            var methods = kind === 'sprite' ? runtime.spriteInstanceMethods : runtime.labelInstanceMethods;
            var methodNames = ['requestRenderData', '_flushAssembler', '_render'];
            for (var index = 0; index < methodNames.length; index += 1) {
                if (Object.prototype.hasOwnProperty.call(renderer, methodNames[index])) return false;
            }
            Object.defineProperty(renderer, '__multiTextureRendererKind', {
                value: kind,
                configurable: true,
                writable: true,
            });
            for (var methodIndex = 0; methodIndex < methodNames.length; methodIndex += 1) {
                var methodName = methodNames[methodIndex];
                Object.defineProperty(renderer, methodName, {
                    value: methods[methodName],
                    configurable: true,
                    writable: true,
                });
            }
            runtime.upgradedRenderers.add(renderer);
            if (typeof renderer.destroyRenderData === 'function') renderer.destroyRenderData();
            renderer._flushAssembler();
            runtime.markDirty(renderer);
            return true;
        };

        runtime.downgradeRenderer = function downgradeRenderer(renderer) {
            if (!renderer || !renderer.__multiTextureRendererKind) return;
            runtime.restoreRenderer(renderer);
            var methods = renderer.__multiTextureRendererKind === 'sprite'
                ? runtime.spriteInstanceMethods : runtime.labelInstanceMethods;
            var methodNames = ['requestRenderData', '_flushAssembler', '_render'];
            for (var index = 0; index < methodNames.length; index += 1) {
                var methodName = methodNames[index];
                if (renderer[methodName] === methods[methodName]) delete renderer[methodName];
            }
            delete renderer.__multiTextureRendererKind;
            runtime.upgradedRenderers.delete(renderer);
            if (!renderer.isValid) return;
            if (typeof renderer.destroyRenderData === 'function') renderer.destroyRenderData();
            var kind = renderer.constructor === cc.Sprite ? 'sprite' : renderer.constructor === cc.Label ? 'label' : '';
            if (kind === 'sprite') cc.Sprite.prototype._flushAssembler.call(renderer);
            if (kind === 'label') cc.Label.prototype._flushAssembler.call(renderer);
            runtime.markDirty(renderer);
        };

        runtime.restoreRenderer = function restoreRenderer(renderer) {
            if (!renderer) return;
            renderer.__multiTextureAssignment = null;
            renderer.__multiTextureRecord = null;
            if (runtime.originalMaterials.has(renderer)) {
                var original = runtime.originalMaterials.get(renderer);
                if (runtime.isPluginMaterial(renderer.customMaterial)) renderer.customMaterial = original;
                runtime.originalMaterials.delete(renderer);
            }
            var renderData = renderer.renderData;
            if (renderData && runtime.isPluginMaterial(renderData.material)) {
                renderData.material = typeof renderer.getRenderMaterial === 'function'
                    ? renderer.getRenderMaterial(0) : null;
                renderData.passDirty = true;
                renderData.textureDirty = true;
                renderData.hashDirty = true;
                if (typeof renderData.updateHash === 'function') renderData.updateHash();
            }
            runtime.pluginRenderers.delete(renderer);
            runtime.markDirty(renderer);
        };

        runtime.assignRenderer = function assignRenderer(renderer, assignment) {
            var previous = renderer.__multiTextureAssignment;
            if (previous && previous.signature === assignment.signature && previous.slot === assignment.slot) return;
            renderer.__multiTextureAssignment = assignment;
            runtime.markDirty(renderer);
        };

        runtime.setRendererMaterial = function setRendererMaterial(renderer, record) {
            if (!runtime.originalMaterials.has(renderer)) {
                runtime.originalMaterials.set(renderer, runtime.isPluginMaterial(renderer.customMaterial) ? null : renderer.customMaterial);
            }
            renderer.__multiTextureRecord = record;
            runtime.pluginRenderers.add(renderer);
            var material = record.material;
            if (renderer.customMaterial !== material) renderer.customMaterial = material;
        };

        runtime.updateMaterialPasses = function updateMaterialPasses(material) {
            var passes = material && material.passes;
            if (!passes || passes.length === 0) return false;
            try {
                for (var index = 0; index < passes.length; index += 1) {
                    var pass = passes[index];
                    if (!pass || !pass.descriptorSet || typeof pass.update !== 'function') return false;
                    pass.update();
                }
            } catch (error) {
                runtime.error = error && (error.message || error.stack) || String(error);
                return false;
            }
            return true;
        };

        runtime.isMaterialRecordUsable = function isMaterialRecordUsable(record) {
            if (!record || !record.prepared || !record.material || !record.material.isValid) return false;
            var passes = record.material.passes;
            if (!passes || passes.length === 0) return false;
            for (var index = 0; index < passes.length; index += 1) {
                if (!passes[index] || !passes[index].descriptorSet) return false;
            }
            return true;
        };

        runtime.ensureGroupMaterial = function ensureGroupMaterial(assignment) {
            var group = assignment && assignment.group;
            if (!runtime.effectAsset || !group || !group.entries || group.entries.length === 0) return null;
            var textures = new Array(runtime.slotCount);
            var frames = new Array(runtime.slotCount);
            for (var index = 0; index < group.entries.length; index += 1) {
                var entry = group.entries[index];
                var slot = group.slots[entry.textureKey];
                if (textures[slot]) continue;
                textures[slot] = textureResource(entry.frame);
                frames[slot] = entry.frame;
            }
            var anchorTexture = textures[0];
            var anchorFrame = frames[0];
            if (!anchorTexture || !anchorFrame || !isTextureReady(anchorTexture)) return null;

            var resourceParts = [];
            for (var slotIndex = 0; slotIndex < runtime.slotCount; slotIndex += 1) {
                var texture = textures[slotIndex] || anchorTexture;
                var frame = frames[slotIndex] || anchorFrame;
                if (!isTextureReady(texture)) return null;
                var gfxTexture = texture.getGFXTexture ? texture.getGFXTexture() : null;
                var sampler = frame && typeof frame.getGFXSampler === 'function' ? frame.getGFXSampler() : null;
                resourceParts.push(runtime.objectId(texture) + ':' + runtime.gfxId(gfxTexture)
                    + ':' + (sampler && sampler.hash || 0));
            }
            var key = runtime.objectId(assignment.scope) + ':' + group.index;
            var resourceSignature = resourceParts.join('|');
            var cached = runtime.materialCache.get(key);
            if (runtime.isMaterialRecordUsable(cached)) {
                if (cached.resourceSignature !== resourceSignature) {
                    for (var cachedSlot = 1; cachedSlot < MAX_TEXTURE_SLOTS; cachedSlot += 1) {
                        cached.material.setProperty('batchTexture' + cachedSlot, textures[cachedSlot] || anchorTexture);
                    }
                    if (!runtime.updateMaterialPasses(cached.material)) return null;
                    cached.resourceSignature = resourceSignature;
                }
                cached.anchorFrame = anchorFrame;
                cached.anchorHash = anchorFrame.getHash();
                cached.lastUsedFrame = runtime.frame;
                return cached;
            }
            if (cached) runtime.materialCache.delete(key);

            var material = new cc.Material('MultiTextureBatch-' + runtime.nextMaterialId);
            material.initialize({ effectAsset: runtime.effectAsset });
            for (var propertySlot = 1; propertySlot < MAX_TEXTURE_SLOTS; propertySlot += 1) {
                material.setProperty('batchTexture' + propertySlot, textures[propertySlot] || anchorTexture);
            }
            if (!runtime.updateMaterialPasses(material)) {
                if (material.isValid) material.destroy();
                return null;
            }
            var record = {
                id: runtime.nextMaterialId++,
                key: key,
                material: material,
                anchorFrame: anchorFrame,
                anchorHash: anchorFrame.getHash(),
                resourceSignature: resourceSignature,
                lastUsedFrame: runtime.frame,
                prepared: true,
            };
            runtime.pluginMaterials.add(material);
            runtime.materialCache.set(key, record);
            return record;
        };

        runtime.collectUnusedMaterials = function collectUnusedMaterials() {
            runtime.frame = cc.director && typeof cc.director.getTotalFrames === 'function'
                ? cc.director.getTotalFrames() : runtime.frame;
            runtime.pluginRenderers.forEach(function removeInvalidRenderer(renderer) {
                if (!renderer || !renderer.isValid) runtime.pluginRenderers.delete(renderer);
            });
            runtime.upgradedRenderers.forEach(function removeInvalidUpgrade(renderer) {
                if (!renderer || !renderer.isValid) runtime.upgradedRenderers.delete(renderer);
            });
            runtime.lastMaterialCleanupFrame = runtime.frame;
        };

        runtime.syncRenderData = function syncRenderData(renderer, assignment, record) {
            var renderData = renderer && renderer.renderData;
            if (!renderData || !record) return false;
            runtime.writeTextureSlot(renderer, assignment.slot);
            renderData.material = record.material;
            renderData.passDirty = false;
            renderData.textureHash = record.anchorHash;
            renderData.textureDirty = false;
            renderData.hashDirty = true;
            if (typeof renderData.updateHash === 'function') renderData.updateHash();
            return true;
        };

        runtime.renderComponent = function renderComponent(renderer, render, baseRender) {
            runtime.frame = cc.director && typeof cc.director.getTotalFrames === 'function'
                ? cc.director.getTotalFrames() : runtime.frame;
            var assignment = renderer.__multiTextureAssignment;
            if (!runtime.enabled || !runtime.effectAsset || !assignment || !assignment.scope || !assignment.scope.enabledInHierarchy) {
                baseRender.call(renderer, render);
                return;
            }
            var record = runtime.ensureGroupMaterial(assignment);
            if (!record) {
                assignment.scope.__multiTextureSignature = '';
                runtime.restoreRenderer(renderer);
                baseRender.call(renderer, render);
                return;
            }
            runtime.setRendererMaterial(renderer, record);
            if (!runtime.syncRenderData(renderer, assignment, record)) {
                baseRender.call(renderer, render);
                return;
            }
            render.commitComp(renderer, renderer.renderData, record.anchorFrame, renderer._assembler, null);
        };

        runtime.planScope = function planScope(scope, force) {
            if (!runtime.enabled || !runtime.effectAsset || !scope || !scope.enabledInHierarchy) {
                runtime.clearScope(scope);
                return;
            }
            var collected = collectScopeEntries(runtime, scope);
            if (!force && scope.__multiTextureSignature === collected.signature) return;

            var plan = buildTextureSetPlan(collected.entries, runtime.slotCount);
            for (var groupIndex = 0; groupIndex < plan.groups.length; groupIndex += 1) {
                var group = plan.groups[groupIndex];
                group.entries = group.entryIndexes.map(function mapEntry(entryIndex) {
                    return collected.entries[entryIndex];
                });
            }

            var previousRenderers = scope.__multiTextureRenderers || new Set();
            var nextRenderers = new Set();
            for (var index = 0; index < collected.entries.length; index += 1) {
                var entry = collected.entries[index];
                var planned = plan.assignments[index];
                if (!entry || !entry.renderer || !planned) continue;
                var groupForRenderer = plan.groups[planned.groupIndex];
                var assignment = {
                    scope: scope,
                    group: groupForRenderer,
                    slot: planned.slot,
                    signature: collected.signature + ':' + planned.groupIndex,
                };
                runtime.assignRenderer(entry.renderer, assignment);
                nextRenderers.add(entry.renderer);
            }
            previousRenderers.forEach(function restoreMissing(renderer) {
                if (!nextRenderers.has(renderer)) runtime.restoreRenderer(renderer);
            });
            scope.__multiTextureRenderers = nextRenderers;
            scope.__multiTextureSignature = collected.signature;
            scope.__multiTexturePlan = plan;
            scope.__multiTextureStats = collected.stats;
            scope.__multiTextureStats.plannedBatches = plan.groups.length;
            scope.__multiTextureStats.optimizedRenderers = nextRenderers.size;
        };

        runtime.clearScope = function clearScope(scope) {
            if (!scope) return;
            var renderers = scope.__multiTextureRenderers;
            if (renderers) renderers.forEach(runtime.restoreRenderer);
            scope.__multiTextureRenderers = new Set();
            scope.__multiTextureSignature = '';
            scope.__multiTexturePlan = null;
        };

        runtime.ensureAutoScopes = function ensureAutoScopes(force) {
            if (!runtime.enabled || !runtime.effectAsset || !cc.director) return;
            runtime.autoScopeFrame += 1;
            if (!force && runtime.autoScopeFrame % 60 !== 0) return;
            var scene = cc.director.getScene();
            if (!scene || !scene.activeInHierarchy) return;
            var canvasNodes = new Set();

            function visit(node, canvasNode) {
                if (!node || !node.activeInHierarchy) return;
                if (cc.Canvas && node.getComponent(cc.Canvas)) canvasNode = node;
                var renderer = node._uiProps && node._uiProps.uiComp;
                if (canvasNode && runtime.upgradeRenderer(renderer)) {
                    canvasNodes.add(canvasNode);
                }
                var children = node.children || [];
                for (var index = 0; index < children.length; index += 1) visit(children[index], canvasNode);
            }

            visit(scene, null);
            canvasNodes.forEach(function ensureScope(node) {
                var scope = node.getComponent(runtime.classes.MultiBatchScope);
                if (!scope) {
                    scope = node.addComponent(runtime.classes.MultiBatchScope);
                    scope.__multiTextureAutoScope = true;
                }
                if (scope.__multiTextureAutoScope) runtime.autoScopes.add(scope);
            });
            runtime.autoScopes.forEach(function removeInvalid(scope) {
                if (!scope || !scope.isValid || !scope.node) runtime.autoScopes.delete(scope);
            });
        };

        runtime.refresh = function refresh() {
            runtime.ensureAutoScopes(true);
            runtime.scopes.forEach(function refreshScope(scope) {
                scope.__multiTextureSignature = '';
                runtime.planScope(scope, true);
            });
        };

        runtime.setEnabled = function setEnabled(value) {
            runtime.enabled = value !== false;
            if (runtime.enabled) runtime.refresh();
            else {
                runtime.scopes.forEach(runtime.clearScope);
                Array.from(runtime.upgradedRenderers).forEach(runtime.downgradeRenderer);
            }
            return runtime.enabled;
        };

        runtime.getStats = function getStats() {
            var result = {
                version: VERSION,
                enabled: runtime.enabled,
                effectReady: !!runtime.effectAsset,
                textureSlots: runtime.slotCount,
                scopes: runtime.scopes.size,
                autoScopes: runtime.autoScopes.size,
                scannedRenderers: 0,
                eligibleRenderers: 0,
                optimizedRenderers: 0,
                plannedBatches: 0,
                upgradedRenderers: runtime.upgradedRenderers.size,
                materialCacheSize: runtime.materialCache.size,
                error: runtime.error || '',
                skipped: {},
                drawCalls: cc.director && cc.director.root && cc.director.root.device
                    ? cc.director.root.device.numDrawCalls : -1,
            };
            runtime.scopes.forEach(function collectStats(scope) {
                var stats = scope.__multiTextureStats;
                if (!stats) return;
                result.scannedRenderers += stats.scannedRenderers || 0;
                result.eligibleRenderers += stats.eligibleRenderers || 0;
                result.optimizedRenderers += stats.optimizedRenderers || 0;
                result.plannedBatches += stats.plannedBatches || 0;
                Object.keys(stats.skipped || {}).forEach(function mergeReason(reason) {
                    result.skipped[reason] = (result.skipped[reason] || 0) + stats.skipped[reason];
                });
            });
            return result;
        };

        return runtime;
    }

    function detectSlotCount(cc) {
        var device = cc.director && cc.director.root && cc.director.root.device;
        var limit = device && device.capabilities && Number(device.capabilities.maxTextureUnits);
        if (!limit || limit < 1) return MAX_TEXTURE_SLOTS;
        return Math.max(1, Math.min(MAX_TEXTURE_SLOTS, limit));
    }

    function createVertexFormat(cc) {
        var gfx = cc.gfx;
        return [
            new gfx.Attribute(gfx.AttributeName.ATTR_POSITION, gfx.Format.RGB32F),
            new gfx.Attribute(gfx.AttributeName.ATTR_TEX_COORD, gfx.Format.RG32F),
            new gfx.Attribute(gfx.AttributeName.ATTR_COLOR, gfx.Format.RGBA32F),
            new gfx.Attribute(gfx.AttributeName.ATTR_TEX_COORD1, gfx.Format.R32F),
        ];
    }

    function getAssemblerProxy(runtime, original, cache) {
        var cached = cache.get(original);
        if (cached) return cached;
        var proxy = {};
        var methods = [
            'createData', 'fillBuffers', 'updateColor', 'updateUVs', 'updateVertexData',
            'getAssemblerData', 'resetAssemblerData', 'removeData',
        ];
        methods.forEach(function proxyMethod(name) {
            if (typeof original[name] !== 'function') return;
            proxy[name] = function delegatedAssemblerMethod() {
                return original[name].apply(original, arguments);
            };
        });
        if (typeof original.updateRenderData === 'function') {
            proxy.updateRenderData = function updateRenderData(renderer) {
                var result = original.updateRenderData.apply(original, arguments);
                runtime.afterAssemblerUpdate(renderer);
                return result;
            };
        }
        proxy.__multiTextureOriginal = original;
        cache.set(original, proxy);
        return proxy;
    }

    function isAlphaSeparated(cc, texture) {
        if (!texture || typeof texture.getPixelFormat !== 'function' || !cc.PixelFormat) return false;
        var format = texture.getPixelFormat();
        return format === cc.PixelFormat.RGBA_ETC1
            || format === cc.PixelFormat.RGB_A_PVRTC_4BPPV1
            || format === cc.PixelFormat.RGB_A_PVRTC_2BPPV1;
    }

    function collectScopeEntries(runtime, scope) {
        var cc = runtime.cc;
        var entries = [];
        var signatureParts = [];
        var stats = {
            scannedRenderers: 0,
            eligibleRenderers: 0,
            optimizedRenderers: 0,
            plannedBatches: 0,
            skipped: {},
        };

        function skip(reason) {
            stats.skipped[reason] = (stats.skipped[reason] || 0) + 1;
        }

        function barrier(reason) {
            entries.push({ barrier: true, reason: reason });
            signatureParts.push('|' + reason + '|');
        }

        function rendererEntry(renderer, maskDepth) {
            var kind = renderer && renderer.__multiTextureRendererKind || '';
            var isSprite = kind === 'sprite';
            var isLabel = kind === 'label';
            if (!isSprite && !isLabel) return null;
            if (renderer.customMaterial && !runtime.isPluginMaterial(renderer.customMaterial)) {
                skip('custom-material');
                return null;
            }
            if (isSprite) {
                if (!supportsSpriteType(renderer.type, cc.Sprite.Type)) {
                    skip('unsupported-sprite-type');
                    return null;
                }
                if (renderer.grayscale) {
                    skip('grayscale');
                    return null;
                }
            }
            var frame = isSprite ? renderer.spriteFrame : renderer.spriteFrame;
            var texture = textureResource(frame);
            if (!frame || !texture || !isTextureReady(texture)) {
                skip('texture-not-ready');
                return null;
            }
            if (cc.RenderTexture && texture instanceof cc.RenderTexture) {
                skip('render-texture');
                return null;
            }
            if (isAlphaSeparated(cc, texture)) {
                skip('alpha-separated');
                return null;
            }
            var textureKey = runtime.textureKey(texture, frame);
            return {
                renderer: renderer,
                frame: frame,
                texture: texture,
                textureKey: textureKey,
                stateKey: 'layer=' + renderer.node.layer + ';mask=' + maskDepth,
            };
        }

        function visit(node, maskDepth) {
            if (!node || !node.activeInHierarchy) return;
            if (node !== scope.node) {
                var nestedScope = node.getComponent(runtime.classes.MultiBatchScope);
                if (nestedScope && nestedScope.enabledInHierarchy) {
                    barrier('nested-scope');
                    return;
                }
            }
            var uiProps = node._uiProps;
            var renderer = uiProps && uiProps.uiComp;
            var isMask = !!(renderer && cc.Mask && renderer instanceof cc.Mask && renderer.enabledInHierarchy);
            if (renderer && renderer.enabledInHierarchy) {
                stats.scannedRenderers += 1;
                if (isMask) {
                    barrier('mask-enter');
                } else {
                    var entry = rendererEntry(renderer, maskDepth);
                    if (entry) {
                        entries.push(entry);
                        signatureParts.push(runtime.objectId(renderer) + ':' + entry.textureKey + '@' + entry.stateKey);
                        stats.eligibleRenderers += 1;
                    } else {
                        barrier('unsupported-renderer');
                    }
                }
            }
            if (!node._static) {
                var children = node.children || [];
                for (var index = 0; index < children.length; index += 1) {
                    visit(children[index], maskDepth + (isMask ? 1 : 0));
                }
            }
            if (isMask) barrier('mask-exit');
        }

        visit(scope.node, 0);
        return { entries: entries, signature: signatureParts.join(';'), stats: stats };
    }

    function registerComponents(runtime) {
        var cc = runtime.cc;
        var decorator = cc._decorator;

        class MultiBatchScope extends cc.Component {
            onEnable() {
                runtime.scopes.add(this);
                this.__multiTextureSignature = '';
            }

            lateUpdate() {
                runtime.planScope(this, false);
            }

            onDisable() {
                runtime.clearScope(this);
                runtime.scopes.delete(this);
            }

            onDestroy() {
                runtime.clearScope(this);
                runtime.scopes.delete(this);
                runtime.autoScopes.delete(this);
            }

            refresh() {
                this.__multiTextureSignature = '';
                runtime.planScope(this, true);
            }

            getStats() {
                return JSON.parse(JSON.stringify(this.__multiTextureStats || {}));
            }
        }

        decorator.menu('多纹理合批/多纹理合批作用域')(MultiBatchScope);
        decorator.executionOrder(9999)(MultiBatchScope);
        decorator.disallowMultiple(MultiBatchScope);
        MultiBatchScope = decorator.ccclass('MultiTextureBatcher.MultiBatchScope')(MultiBatchScope) || MultiBatchScope;

        runtime.classes.MultiBatchScope = MultiBatchScope;
    }

    function createSelfTestScene(runtime, options, rendererCount) {
        var cc = runtime.cc;
        var scene = new cc.Scene(SELF_TEST_SCENE_NAME);
        var canvasNode = new cc.Node('Canvas');
        canvasNode.layer = cc.Layers.Enum.UI_2D;
        scene.addChild(canvasNode);
        canvasNode.addComponent('cc.UITransform').setContentSize(960, 640);
        var canvas = canvasNode.addComponent('cc.Canvas');

        var cameraNode = new cc.Node('UICamera');
        cameraNode.layer = cc.Layers.Enum.UI_2D;
        canvasNode.addChild(cameraNode);
        var camera = cameraNode.addComponent('cc.Camera');
        camera.visibility = cc.Layers.Enum.UI_2D;
        canvas.cameraComponent = camera;

        var colors = [
            [232, 76, 61], [52, 152, 219], [46, 204, 113], [241, 196, 15],
            [155, 89, 182], [26, 188, 156], [230, 126, 34], [236, 240, 241],
            [52, 73, 94],
        ];
        var textures = [];
        var frames = [];
        var labels = [];
        for (var index = 0; index < rendererCount; index += 1) {
            var node = new cc.Node(options.mixedSelfTest && index % 2 ? 'Label' + index : 'Sprite' + index);
            node.layer = cc.Layers.Enum.UI_2D;
            canvasNode.addChild(node);
            node.setPosition(-350 + index * 100, 0, 0);
            node.addComponent('cc.UITransform').setContentSize(72, 160);

            if (options.mixedSelfTest && index % 2) {
                var label = node.addComponent(cc.Label);
                runtime.upgradeRenderer(label);
                label.string = 'L' + index;
                label.fontSize = 48;
                label.lineHeight = 58;
                label.cacheMode = cc.Label.CacheMode[options.labelCacheMode];
                label.color = new cc.Color(colors[index][0], colors[index][1], colors[index][2], 255);
                label.enableOutline = true;
                label.outlineWidth = 2;
                label.outlineColor = cc.Color.BLACK;
                label.enableShadow = true;
                label.shadowBlur = 1;
                label.shadowOffset = new cc.Vec2(2, -2);
                labels.push(label);
                continue;
            }

            var texture = new cc.Texture2D('MultiTextureBatcherSelfTestTexture' + index);
            texture.create(16, 16);
            var pixels = new Uint8Array(16 * 16 * 4);
            for (var pixel = 0; pixel < 16 * 16; pixel += 1) {
                var offset = pixel * 4;
                pixels[offset] = colors[index][0];
                pixels[offset + 1] = colors[index][1];
                pixels[offset + 2] = colors[index][2];
                pixels[offset + 3] = 255;
            }
            texture.uploadData(pixels);
            var frame = new cc.SpriteFrame('MultiTextureBatcherSelfTestFrame' + index);
            frame.texture = texture;
            frame.packable = false;
            textures.push(texture);
            frames.push(frame);
            var sprite = node.addComponent(cc.Sprite);
            runtime.upgradeRenderer(sprite);
            sprite.sizeMode = cc.Sprite.SizeMode.CUSTOM;
            sprite.type = cc.Sprite.Type.SIMPLE;
            sprite.spriteFrame = frame;
        }
        var actualRendererCount = rendererCount;
        if (options.maskSelfTest) {
            var maskNode = new cc.Node('MaskBoundary');
            maskNode.layer = cc.Layers.Enum.UI_2D;
            canvasNode.addChild(maskNode);
            maskNode.setPosition(0, -180, 0);
            maskNode.addComponent('cc.UITransform').setContentSize(180, 90);
            var mask = maskNode.addComponent(cc.Mask);
            mask.type = cc.Mask.Type.RECT;

            var clippedNode = new cc.Node('ClippedSprite');
            clippedNode.layer = cc.Layers.Enum.UI_2D;
            maskNode.addChild(clippedNode);
            clippedNode.setPosition(90, 0, 0);
            clippedNode.addComponent('cc.UITransform').setContentSize(360, 90);
            var clippedSprite = clippedNode.addComponent(cc.Sprite);
            runtime.upgradeRenderer(clippedSprite);
            clippedSprite.sizeMode = cc.Sprite.SizeMode.CUSTOM;
            clippedSprite.type = cc.Sprite.Type.SIMPLE;
            clippedSprite.spriteFrame = frames[0];
            actualRendererCount += 1;
        }
        return {
            scene: scene,
            canvasNode: canvasNode,
            scope: null,
            rendererCount: actualRendererCount,
            textures: textures,
            frames: frames,
            labels: labels,
        };
    }

    function launchSelfTest(runtime, options) {
        var cc = runtime.cc;
        var launched = false;
        function launch() {
            if (launched) return;
            launched = true;
            var rendererCount = options.nineTextureSelfTest ? 9 : 8;
            var fixture = createSelfTestScene(runtime, options, rendererCount);
            cc.director.runSceneImmediate(fixture.scene);
            for (var index = 0; index < fixture.labels.length; index += 1) fixture.labels[index].updateRenderData(true);
            if (!options.disabled) {
                runtime.ensureAutoScopes(true);
                fixture.scope = fixture.canvasNode.getComponent(runtime.classes.MultiBatchScope);
                if (!fixture.scope) {
                    runtime.selfTest = { status: 'failed', mode: options.mode, error: 'Automatic Canvas scope was not created.' };
                    console.error('[MultiTextureBatcher] self-test', JSON.stringify(runtime.selfTest));
                    return;
                }
                fixture.scope.refresh();
            }
            measureSelfTest(runtime, options, fixture);
        }
        var scene = cc.director.getScene();
        if (scene && scene.activeInHierarchy) launch();
        else cc.director.once(cc.Director.EVENT_AFTER_SCENE_LAUNCH, launch);
    }

    function measureSelfTest(runtime, options, fixture) {
        var cc = runtime.cc;
        var samples = [];
        var frameCount = 0;
        var finished = false;
        var timeoutId = null;
        function complete(result) {
            if (finished) return;
            finished = true;
            cc.director.off(cc.Director.EVENT_AFTER_DRAW, afterDraw);
            if (timeoutId && runtime.root.clearTimeout) runtime.root.clearTimeout(timeoutId);
            runtime.selfTest = result;
            console.info('[MultiTextureBatcher] self-test', JSON.stringify(result));
        }
        function afterDraw() {
            frameCount += 1;
            if (fixture.labels.length > 0) fixture.labels[0].string = 'L' + (frameCount % 10);
            if (frameCount <= 12) return;
            var drawCalls = cc.director.root && cc.director.root.device ? cc.director.root.device.numDrawCalls : -1;
            if (drawCalls >= 0) samples.push(drawCalls);
            if (samples.length < 20) return;
            var sorted = samples.slice().sort(function sortNumbers(left, right) { return left - right; });
            var median = sorted[Math.floor(sorted.length / 2)];
            var expectedPluginBatches = Math.ceil(fixture.rendererCount / runtime.slotCount);
            var drawCallOverheadAllowance = options.maskSelfTest ? 4 : 1;
            var expected = options.disabled
                ? fixture.rendererCount + drawCallOverheadAllowance
                : expectedPluginBatches + drawCallOverheadAllowance;
            var stats = runtime.getStats();
            var passed = options.disabled
                ? median >= fixture.rendererCount
                : median <= expected && stats.optimizedRenderers === fixture.rendererCount
                    && stats.plannedBatches === expectedPluginBatches;
            complete({
                status: passed ? 'passed' : 'failed',
                mode: options.mode,
                enabled: runtime.enabled,
                rendererCount: fixture.rendererCount,
                labelCount: fixture.labels.length,
                labelCacheMode: options.labelCacheMode,
                maskSelfTest: options.maskSelfTest,
                textureSlots: runtime.slotCount,
                expectedPluginBatches: expectedPluginBatches,
                drawCallOverheadAllowance: drawCallOverheadAllowance,
                expectedDrawCalls: expected,
                drawCalls: median,
                minDrawCalls: sorted[0],
                maxDrawCalls: sorted[sorted.length - 1],
                samples: samples,
                stats: stats,
            });
        }
        cc.director.on(cc.Director.EVENT_AFTER_DRAW, afterDraw);
        if (runtime.root.setTimeout) {
            timeoutId = runtime.root.setTimeout(function selfTestTimeout() {
                complete({ status: 'failed', mode: options.mode, error: 'Timed out while collecting DrawCall samples.' });
            }, 12000);
        }
    }

    function bootstrap(root) {
        if (!root || !root.cc || root[GLOBAL_KEY]) return root && root[GLOBAL_KEY];
        var cc = root.cc;
        var options = parseRuntimeOptions(root.location && root.location.search || '');
        var runtime = createRuntime(cc, root);
        root[GLOBAL_KEY] = runtime;
        registerComponents(runtime);

        root.MultiTextureBatcher = {
            version: VERSION,
            MultiBatchScope: runtime.classes.MultiBatchScope,
            getStats: function getStats() { return runtime.getStats(); },
            setEnabled: function setEnabled(value) { return runtime.setEnabled(value); },
            refresh: function refresh() { runtime.refresh(); },
            getSelfTestResult: function getSelfTestResult() {
                return runtime.selfTest ? JSON.parse(JSON.stringify(runtime.selfTest)) : null;
            },
        };

        var isEditorProcess = !!root.Editor || (typeof CC_EDITOR !== 'undefined' && CC_EDITOR);
        if (isEditorProcess) return runtime;

        function start() {
            cc.resources.load(EFFECT_PATH, cc.EffectAsset, function onEffectLoaded(error, effectAsset) {
                if (error || !effectAsset) {
                    runtime.error = error && (error.message || error.stack) || 'Effect asset is unavailable.';
                    console.error('[MultiTextureBatcher] load failed:', runtime.error);
                    return;
                }
                runtime.effectAsset = effectAsset;
                if (options.disabled) runtime.setEnabled(false);
                else runtime.refresh();
                cc.director.on(cc.Director.EVENT_AFTER_SCENE_LAUNCH, function refreshAutoScopesAfterSceneLaunch() {
                    runtime.ensureAutoScopes(true);
                });
                cc.director.on(cc.Director.EVENT_BEFORE_DRAW, function refreshAutoScopesBeforeDraw() {
                    runtime.ensureAutoScopes(false);
                });
                cc.director.on(cc.Director.EVENT_END_FRAME, function collectMaterialsAfterFrame() {
                    runtime.collectUnusedMaterials();
                });
                console.info('[MultiTextureBatcher] running, texture slots:', runtime.slotCount, 'enabled:', runtime.enabled);
                if (options.selfTest) launchSelfTest(runtime, options);
            });
        }

        if (cc.game && cc.Game) cc.game.once(cc.Game.EVENT_GAME_INITED, start);
        else start();
        return runtime;
    }

    return {
        VERSION: VERSION,
        MAX_TEXTURE_SLOTS: MAX_TEXTURE_SLOTS,
        buildTextureSetPlan: buildTextureSetPlan,
        isTextureReady: isTextureReady,
        parseRuntimeOptions: parseRuntimeOptions,
        supportsSpriteType: supportsSpriteType,
        textureResource: textureResource,
        bootstrap: bootstrap,
    };
}));
