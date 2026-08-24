'use strict';

const fs = require('fs');
const path = require('path');
const { resolveProjectPath } = require('../context');

async function run(context) {
    const backupConfig = context.config.backup || {};
    if (backupConfig.enabled === false || backupConfig.cleanBeforeRun === false) {
        return { skipped: true };
    }

    const backupRoot = resolveProjectPath(context.projectRoot, backupConfig.root || 'project://build/.release-pipeline-backups');
    const target = path.join(backupRoot, context.outputName);

    if (fs.existsSync(target)) {
        if (!isInside(path.resolve(context.projectRoot), path.resolve(target))) {
            throw new Error(`Refuse to remove backup outside project: ${target}`);
        }
        if (!context.dryRun) {
            fs.rmSync(target, { recursive: true, force: true });
        }
    }

    return { removed: target };
}

function isInside(root, target) {
    const relative = path.relative(root, target);
    return relative && !relative.startsWith('..') && !path.isAbsolute(relative);
}

module.exports = { run };
