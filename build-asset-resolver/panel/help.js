'use strict';
const { createHelpPanel } = require('../../creator-help-panel');
module.exports = createHelpPanel('构建资源定位器', [
    ['用途', '把构建产物中的 UUID、文件名或路径定位回当前源资源，并在可用时查询 Git 历史。'],
    ['使用流程', '输入构建文件路径、文件名或 UUID，执行定位；结果会区分当前源资源、构建文件和历史资源。'],
    ['结果说明', '当前源资源存在表示可以回到 Asset DB；只有历史结果表示源资源已删除或构建包过期。'],
    ['安全边界', '定位过程只读取项目 assets、build 和 Git 历史，不修改源文件，不读取网络或登录数据。'],
]);
