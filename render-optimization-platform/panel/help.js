'use strict';
const { createHelpPanel } = require('../../creator-help-panel');
module.exports = createHelpPanel('渲染优化平台', [
    ['扫描范围', '扫描 Meta、Scene、Prefab、Sprite、Label、Mask、Graphics、Spine、材质、图片和静态 RenderTree。'],
    ['指标含义', '报告中的 DrawCall、纹理组、材质组和批次边界是静态估算；实际 FPS、GPU 时间、GC 和上传耗时必须运行时采集。'],
    ['报告导出', '报告默认写入 build/render-optimization-reports；构建报告写入构建输出的 render-optimization-report。'],
    ['禁止自动修改', '插件默认只读，不自动改 Scene、Prefab、Meta、图片、材质、业务代码、引擎或构建逻辑。'],
]);
