'use strict';

const ENABLED_ENVIRONMENTS = new Set(['dev', 'development', 'test']);

function shouldEmbedWebDebugger(environment) {
    return ENABLED_ENVIRONMENTS.has(String(environment || '').toLowerCase());
}

module.exports = { shouldEmbedWebDebugger };
