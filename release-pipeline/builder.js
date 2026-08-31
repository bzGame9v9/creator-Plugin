'use strict';

const PACKAGE_NAME = 'release-pipeline';

exports.configs = {
    'web-mobile': {
        hooks: './hooks',
        options: {
            releasePipelineEnabled: {
                label: '启用发布流水线',
                description: '构建完成后运行发布后处理流程。',
                default: true,
                render: {
                    ui: 'ui-checkbox',
                },
            },
            releasePipelineTasks: {
                label: '流水线任务',
                description: '逗号分隔的任务名称。留空时使用 config/default-config.json。',
                default: '',
                render: {
                    ui: 'ui-input',
                    attributes: {
                    placeholder: 'cleanBackup,obfuscateJs,fingerprintBuild,zipBuild,archiveRelease,writeReport',
                    },
                },
            },
        },
        verifyRuleMap: {},
    },
};

exports.load = function load() {
    console.log(`[${PACKAGE_NAME}] builder loaded`);
};

exports.unload = function unload() {
    console.log(`[${PACKAGE_NAME}] builder unloaded`);
};
