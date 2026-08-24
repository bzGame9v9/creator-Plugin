# Render Optimization Platform

项目级 Cocos Creator 3.8.6 渲染诊断扩展。插件默认只读，不修改 Scene、Prefab、Meta、图片、材质、业务代码、引擎或构建逻辑。

## 入口

在 Creator 中打开：

```text
扩展 / Render Optimization Platform / Open Platform
```

也可以直接选择 `Scan Project`。面板支持扫描、取消、重复扫描、风险和关键字筛选、打开源资源、导出 JSON/Markdown 报告。

## 扫描范围

- Meta、根 UUID、子资源 UUID、正向和反向依赖。
- Scene、Prefab 的 Node DFS、Sprite、Label、RichText、Mask、Graphics、UIOpacity、Spine、DragonBones、Particle2D。
- 静态 RenderTree 和 Texture、Material、Blend、Mask 批次边界估算。
- 图片尺寸、源大小、RGBA 理论上限、Mipmap/NPOT、完全重复纹理。
- Auto Atlas 目录覆盖和小纹理候选组。
- 材质 Effect、Technique、Define、State、Property 等价指纹。
- 嵌套 Mask、Mask 密度、NONE Cache Label 密度和部分解析失败。

实际 DrawCall、FPS、CPU Render、GPU 时间、GC、RenderData 分配和 Buffer 上传只能由运行时采集。未采集时报告写 `unavailable`，不会用静态估算冒充运行数据。

## 报告

面板导出目录：

```text
build/render-optimization-reports
```

构建插件开启后，`onAfterBuild` 在构建输出目录下生成：

```text
render-optimization-report/render-report.json
```

构建插件只生成报告，不修改构建产物。可在构建面板关闭 `Generate render optimization report`。

## 命令行

```powershell
node extensions\render-optimization-platform\cli\scan.js <PROJECT_ROOT>
node --test extensions\render-optimization-platform\test\*.test.js
```

## 运行时遥测适配器

`runtime/telemetry.js` 提供实例级、可卸载、保留返回值和异常行为的只读 Hook。它默认不会注入游戏包。直接改写 Batcher2D 行为、RenderData Pool、SuperAssembler、SuperMesh、Dirty Region 和虚拟渲染顺序都不属于 1.0.0 自动能力。

## Creator 3.8.6 手工验收

1. 打开当前项目根目录，在扩展管理器确认 `Render Optimization Platform 1.0.0` 已启用。
2. 从扩展菜单打开面板，确认状态为“等待扫描”。
3. 点击“扫描项目”，确认进度阶段依次更新；扫描中再次点击不可并发启动。
4. 扫描中点击“取消”，确认状态进入“扫描已取消”；重新扫描可成功完成。
5. 在问题页筛选 Critical，打开一条嵌套 Mask 结果，确认 Creator 定位到对应 Prefab。
6. 检查资产和 RenderTree 页，确认表格、关键字筛选和窗口缩放正常。
7. 点击“导出”，确认 JSON 和 Markdown 可解析且 `metrics.runtime.available = false`。
8. 执行一次测试构建，确认输出目录出现 `render-optimization-report/render-report.json`，游戏产物未被改写。

## 升级约束

Creator 升级时必须重新核对 `sprite.ts`、`simple.ts`、`render-data.ts`、`batcher-2d.ts`、`mesh-buffer.ts` 和 Builder Hook。3.8.6 中相关渲染接口包含 private/deprecated 标记，不承诺跨版本兼容。

## 使用帮助

Creator 菜单“打开使用帮助”说明扫描范围、静态指标和真实运行时指标的区别、报告导出位置，以及默认只读和禁止自动修改的边界。
