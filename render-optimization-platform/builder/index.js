'use strict';

const PACKAGE_NAME = 'render-optimization-platform';

exports.load = function load() {
    console.log(`[${PACKAGE_NAME}] builder loaded`);
};

exports.unload = function unload() {
    console.log(`[${PACKAGE_NAME}] builder unloaded`);
};

exports.configs = {
    '*': {
        hooks: './hooks',
        options: {
            enabled: {
                label: '生成渲染优化报告',
                description: '构建成功后执行只读资源扫描。',
                default: true,
                render: { ui: 'ui-checkbox' },
            },
            markdown: {
                label: '生成 Markdown 报告',
                default: false,
                render: { ui: 'ui-checkbox' },
            },
        },
    },
};
