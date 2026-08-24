'use strict';

function nowMilliseconds() {
    if (globalThis.performance && typeof globalThis.performance.now === 'function') return globalThis.performance.now();
    return Date.now();
}

function installRuntimeTelemetry(target, options = {}) {
    if (!target || typeof target !== 'object') throw new TypeError('A Batcher2D-like target instance is required.');
    const methodNames = options.methods || ['commitComp', 'autoMergeBatches', 'flushMaterial', 'updateBuffer'];
    const originals = new Map();
    const metrics = {
        installedAt: new Date().toISOString(),
        calls: {},
        totalTimeMs: {},
        errors: {},
    };

    for (const methodName of methodNames) {
        const original = target[methodName];
        if (typeof original !== 'function') continue;
        const wrapped = function renderOptimizationTelemetryWrapper(...args) {
            const startedAt = nowMilliseconds();
            metrics.calls[methodName] = (metrics.calls[methodName] || 0) + 1;
            try {
                return original.apply(this, args);
            } catch (error) {
                metrics.errors[methodName] = (metrics.errors[methodName] || 0) + 1;
                throw error;
            } finally {
                metrics.totalTimeMs[methodName] = (metrics.totalTimeMs[methodName] || 0) + (nowMilliseconds() - startedAt);
            }
        };
        originals.set(methodName, { original, wrapped });
        target[methodName] = wrapped;
    }

    let installed = true;
    return {
        snapshot(reset = false) {
            const snapshot = JSON.parse(JSON.stringify({ ...metrics, capturedAt: new Date().toISOString() }));
            if (reset) {
                metrics.calls = {};
                metrics.totalTimeMs = {};
                metrics.errors = {};
            }
            return snapshot;
        },
        uninstall() {
            if (!installed) return false;
            for (const [methodName, entry] of originals) {
                if (target[methodName] === entry.wrapped) target[methodName] = entry.original;
            }
            installed = false;
            return true;
        },
        get installed() {
            return installed;
        },
    };
}

module.exports = {
    installRuntimeTelemetry,
};
