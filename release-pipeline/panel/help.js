'use strict';
const { createHelpPanel } = require('../../creator-help-panel');
module.exports = createHelpPanel('发布流水线', [
    ['任务顺序', '默认顺序是 cleanBackup -> obfuscateJs -> fingerprintBuild -> zipBuild -> archiveRelease -> writeReport。ZIP 只有在最终指纹审计通过后才生成并归档。'],
    ['组合指纹', 'Cocos Bundle 版本由最终 index.js 和 config.json 的带边界组合字节计算，四个 Bundle 的 index/config/settings.bundleVers 必须一致。'],
    ['命令', '完整构建使用 npm.cmd run release:web:all；只处理已有构建使用 npm.cmd run release:web:pipeline。--force 只在确认需要重新混淆时使用。'],
    ['归档和回滚', '每次 ZIP 校验成功后按环境、appVersion_fingerprint 和北京时间归档；同指纹重复打包不覆盖。回滚恢复上一份完整 ZIP，不覆盖旧 hash URL。'],
]);
