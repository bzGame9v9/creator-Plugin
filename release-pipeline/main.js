'use strict';

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { resolveProjectRoot } = require('../shared/project-runtime');

const PACKAGE_NAME = 'release-pipeline';

function getProjectRoot() {
    return resolveProjectRoot();
}

function openPath(target) {
    if (!target || !fs.existsSync(target)) {
        console.warn(`[${PACKAGE_NAME}] path does not exist: ${target}`);
        return;
    }

    const opener = process.platform === 'win32'
        ? 'explorer'
        : process.platform === 'darwin'
            ? 'open'
            : 'xdg-open';

    const child = spawn(opener, [target], {
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
    });
    child.unref();
}

exports.load = function load() {
    console.log(`[${PACKAGE_NAME}] loaded`);
};

exports.unload = function unload() {
    console.log(`[${PACKAGE_NAME}] unloaded`);
};

exports.methods = {
    openConfig() {
        openPath(path.join(__dirname, 'config', 'default-config.json'));
    },

    openLatestReport() {
        const reportDir = path.join(getProjectRoot(), 'build', '.release-pipeline-reports');
        openPath(reportDir);
    },

    async openHelp() {
        await Editor.Panel.open(PACKAGE_NAME);
    },
};
