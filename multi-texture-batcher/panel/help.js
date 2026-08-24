'use strict';
const { createHelpPanel } = require('../../creator-help-panel');
module.exports = createHelpPanel('多纹理合批', [
    ['总开关', '只有打开总开关才安装运行时；关闭后会移除扩展生成的运行时资源，Creator 重启不会自动打开。'],
    ['适用范围', 'Web/H5 标准 Sprite、Label 可参与合批；每批最多 8 张纹理，第 9 张会安全拆批。'],
    ['渲染边界', 'Mask、Graphics、自定义材质、RenderTexture、Tiled/Filled Sprite 和非 Web 平台回退 Creator 官方渲染。'],
    ['扫描和恢复', '只读扫描不会修改 Scene/Prefab；旧版本序列化转换需要先确认备份，再执行恢复。'],
]);
