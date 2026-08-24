'use strict';
const { createHelpPanel } = require('../../creator-help-panel');
module.exports = createHelpPanel('发布流水线', [
    ['任务顺序', '默认顺序是 cleanBackup -> obfuscateJs -> fingerprintBuild -> zipBuild -> writeReport。ZIP 只有在最终指纹审计通过后才生成。'],
    ['组合指纹', 'Cocos Bundle 版本由最终 index.js 和 config.json 的带边界组合字节计算，四个 Bundle 的 index/config/settings.bundleVers 必须一致。'],
    ['命令', '完整构建使用 npm.cmd run release:web:all；只处理已有构建使用 npm.cmd run release:web:pipeline。--force 只在确认需要重新混淆时使用。'],
    ['缓存和回滚', '入口和 Worker 需要可重新验证，真正内容寻址资源才使用 immutable；回滚恢复上一份完整 ZIP，不覆盖旧 hash URL。'],
]);
