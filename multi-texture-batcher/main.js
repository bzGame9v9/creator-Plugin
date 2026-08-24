'use strict';

const { getRuntimeStatus, installRuntime, removeRuntime } = require('./core/installer');
const {
    getConversionState,
    restoreLastConversion: restoreSerializedConversion,
    scanProject,
} = require('./core/serialized-converter');

const PACKAGE_NAME = 'multi-texture-batcher';
let state = createState('idle');

function projectRoot() {
    if (global.Editor && Editor.Project && Editor.Project.path) return Editor.Project.path;
    return process.cwd();
}

function createState(status, overrides = {}) {
    return {
        status,
        masterEnabled: false,
        runtime: null,
        conversion: null,
        scan: null,
        restore: null,
        error: '',
        updatedAt: new Date().toISOString(),
        ...overrides,
    };
}

function emitState() {
    state.updatedAt = new Date().toISOString();
    if (global.Editor && Editor.Message) Editor.Message.send(PACKAGE_NAME, 'state-updated', state);
}

async function refreshAssetDatabase(dbUrl) {
    if (!global.Editor || !Editor.Message) return;
    try {
        await Editor.Message.request('asset-db', 'refresh-asset', dbUrl);
    } catch (error) {
        console.warn(`[${PACKAGE_NAME}] asset refresh failed: ${error && (error.message || error.stack) || error}`);
    }
}

async function createRuntimeState(status, overrides = {}) {
    const runtime = getRuntimeStatus(projectRoot());
    return createState(status || (runtime.installed ? 'enabled' : 'disabled'), {
        masterEnabled: runtime.installed,
        runtime,
        conversion: await getConversionState(projectRoot()),
        scan: state.scan,
        ...overrides,
    });
}

async function inspectRuntime() {
    state = await createRuntimeState();
    emitState();
    return state;
}

async function enableRuntime() {
    state = await createRuntimeState('enabling');
    emitState();
    try {
        const result = await installRuntime(projectRoot());
        await refreshAssetDatabase(result.dbUrl);
        state = await createRuntimeState('enabled');
        console.log(`[${PACKAGE_NAME}] runtime ${result.changed ? 'installed/refreshed' : 'already current'}: ${result.directory}`);
    } catch (error) {
        state = await createRuntimeState('failed', {
            error: error && (error.stack || error.message) || String(error),
        });
        console.error(`[${PACKAGE_NAME}] runtime install failed: ${state.error}`);
    }
    emitState();
    return state;
}

async function disableRuntime() {
    state = await createRuntimeState('disabling');
    emitState();
    try {
        const result = await removeRuntime(projectRoot());
        await refreshAssetDatabase('db://assets/resources');
        state = await createRuntimeState('disabled');
        console.log(`[${PACKAGE_NAME}] runtime removed: ${result.directory}`);
    } catch (error) {
        state = await createRuntimeState('failed', {
            error: error && (error.stack || error.message) || String(error),
        });
        console.error(`[${PACKAGE_NAME}] runtime removal failed: ${state.error}`);
    }
    emitState();
    return state;
}

exports.load = function load() {
    void inspectRuntime();
};

exports.unload = function unload() {};

exports.methods = {
    async openPanel() {
        await Editor.Panel.open(PACKAGE_NAME);
        return state;
    },

    async openHelp() {
        await Editor.Panel.open(`${PACKAGE_NAME}.help`);
    },

    enableRuntime,

    disableRuntime,

    async setMasterEnabled(value) {
        return value === true ? enableRuntime() : disableRuntime();
    },

    async getState() {
        return inspectRuntime();
    },

    async scanProject() {
        state = await createRuntimeState('scanning');
        emitState();
        try {
            const scan = await scanProject(projectRoot());
            state = await createRuntimeState('scanned', { scan });
        } catch (error) {
            state = await createRuntimeState('failed', {
                error: error && (error.stack || error.message) || String(error),
            });
        }
        emitState();
        return state;
    },

    async restoreLastConversion() {
        state = await createRuntimeState('restoring');
        emitState();
        try {
            const result = await restoreSerializedConversion(projectRoot());
            await refreshAssetDatabase('db://assets');
            state = await createRuntimeState(result.conflicts && result.conflicts.length > 0 ? 'restore-conflict' : 'restored', {
                scan: await scanProject(projectRoot()),
                restore: result,
            });
        } catch (error) {
            state = await createRuntimeState('failed', {
                error: error && (error.stack || error.message) || String(error),
            });
        }
        emitState();
        return state;
    },
};
