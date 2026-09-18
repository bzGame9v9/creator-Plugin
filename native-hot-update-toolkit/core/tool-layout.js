'use strict';

const fs = require('fs');
const path = require('path');

/**
 * 发布工具的目录布局。
 *
 * 插件（extensions/）是全分支共享的，而各分支的项目内 tools/ 布局可能不同：
 *   - release-center 布局：发布工具收进 tools/release-center/（v1.4 起）
 *   - legacy 布局：发布工具散落在 tools/ 根（v1.3 及更早）
 * 插件必须两种都能识别，否则会把尚未归拢的分支打断。
 */

/** 布局定义：字段值是相对于项目根的路径片段数组。 */
const TOOL_LAYOUTS = [
    {
        id: 'release-center',
        androidRelease: ['tools', 'release-center', 'android-release'],
        hotUpdateToolkit: ['tools', 'release-center', 'native-hot-update-toolkit'],
        web: ['tools', 'release-center', 'web'],
    },
    {
        id: 'legacy',
        androidRelease: ['tools', 'android-release'],
        hotUpdateToolkit: ['tools', 'native-hot-update-toolkit'],
        web: ['tools'],
    },
];

/** 按 android-release/cli.js 是否存在判定项目使用的布局；都不存在时按 release-center 处理（报错信息仍指向该布局）。 */
function resolveToolLayout(projectRoot) {
    for (const layout of TOOL_LAYOUTS) {
        if (fs.existsSync(path.join(projectRoot, ...layout.androidRelease, 'cli.js'))) return layout;
    }
    return TOOL_LAYOUTS[0];
}

/** 返回当前项目实际使用的工具绝对路径，以及对应的 project:// 相对路径（用于写回配置）。 */
function resolveToolPaths(projectRoot) {
    const layout = resolveToolLayout(projectRoot);
    const absolute = (parts) => path.join(projectRoot, ...parts);
    const relative = (parts) => parts.join('/');
    return {
        layout: layout.id,
        androidRelease: absolute(layout.androidRelease),
        hotUpdateToolkit: absolute(layout.hotUpdateToolkit),
        hotUpdateLib: absolute([...layout.hotUpdateToolkit, 'lib']),
        web: absolute(layout.web),
        androidReleaseRelative: relative(layout.androidRelease),
        hotUpdateToolkitRelative: relative(layout.hotUpdateToolkit),
        webRelative: relative(layout.web),
    };
}

module.exports = { TOOL_LAYOUTS, resolveToolLayout, resolveToolPaths };
