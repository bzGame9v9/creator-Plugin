'use strict';

const PACKAGE_NAME = 'native-hot-update-toolkit';

/** Creator Android 构建面板选项；默认关闭，避免未配置 login/hall 发布参数时阻塞现有打包。 */
exports.configs = {
    android: {
        hooks: './hooks',
        options: {
            enabled: {
                label: 'Generate Native Hot Update Release',
                description: 'Generate a base APK plus login/hall Bundle candidate release after Creator build.',
                default: false,
                render: { ui: 'ui-checkbox' },
            },
            configPath: {
                label: 'Toolkit Config',
                description: 'Project-relative JSON configuration path.',
                default: 'tools/native-hot-update-toolkit/config.local.json',
                render: { ui: 'ui-input' },
            },
        },
        verifyRuleMap: {},
    },
};

/** 记录 Creator builder adapter 已加载。 */
exports.load = function load() {
    console.log(`[${PACKAGE_NAME}] builder loaded`);
};

/** 记录 Creator builder adapter 已卸载。 */
exports.unload = function unload() {
    console.log(`[${PACKAGE_NAME}] builder unloaded`);
};
