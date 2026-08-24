'use strict';
const { createHelpPanel } = require('../../creator-help-panel');
module.exports = createHelpPanel('资源引用查找器', [
    ['用途', '检查选中资源的正向引用、Prefab/Scene 字符串匹配和引用树。'],
    ['使用流程', '在资源管理器选中 assets 下资源，使用 F6 或“查找资源引用”，再在面板查看引用文件和字符串匹配。'],
    ['冗余清理', 'Prefab 冗余清理会先创建备份，只处理明确选中的 Prefab；确认备份和 Git 状态后再执行，插件不会静默覆盖无法解析的文件。'],
    ['边界', '插件只扫描项目文件和 Asset DB 信息，不读取网络、Cookie 或用户数据。'],
]);
