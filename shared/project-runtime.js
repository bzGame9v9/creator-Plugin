'use strict';

const fs = require('fs');
const path = require('path');
const { createRequire } = require('module');

function resolveProjectRoot(explicitRoot, options, result) {
    const direct = [
        explicitRoot,
        global.Editor && global.Editor.Project && global.Editor.Project.path,
        options && (options.projectPath || options.project),
        result && (result.projectPath || result.project),
    ].filter(Boolean);
    for (const candidate of direct) {
        const root = path.resolve(String(candidate));
        if (fs.existsSync(path.join(root, 'package.json'))) return root;
    }

    const buildPaths = [
        result && (result.dest || result.outputPath || result.buildPath),
        options && options.dest,
    ].filter(Boolean);
    for (const candidate of buildPaths) {
        let current = path.resolve(String(candidate));
        while (path.dirname(current) !== current) {
            if (fs.existsSync(path.join(current, 'package.json'))) return current;
            current = path.dirname(current);
        }
    }

    const cwd = process.cwd();
    if (fs.existsSync(path.join(cwd, 'package.json'))) return cwd;
    throw new Error('Cannot resolve current Cocos project root');
}

function requireProjectDependency(name, projectRoot) {
    const root = resolveProjectRoot(projectRoot);
    try {
        return createRequire(path.join(root, 'package.json'))(name);
    } catch (error) {
        throw new Error(
            `Cannot load project dependency "${name}" from ${root}. Run npm.cmd ci --include=dev in this project.`,
            { cause: error },
        );
    }
}

module.exports = { requireProjectDependency, resolveProjectRoot };
