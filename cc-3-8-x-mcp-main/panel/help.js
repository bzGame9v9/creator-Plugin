'use strict';
const { createHelpPanel } = require('../../creator-help-panel');
module.exports = createHelpPanel('Cocos MCP 工具', [
    ['服务状态', '面板可查看 MCP 服务、端点、预览地址、资源刷新和工作树状态。'],
    ['使用流程', '先确认当前项目和端口，再刷新 Asset DB、重导入资源或执行场景软重载；CLI/MCP 操作前阅读插件自带 cli 文档。'],
    ['安全边界', '服务只绑定当前编辑器项目；工作树和 .dev 文件属于开发状态，不要把 Token、密码或用户数据写入报告。'],
    ['故障处理', '端点不可用时先重启 MCP 服务，再检查端口和编辑器状态；不要用删除项目文件代替服务恢复。'],
]);
