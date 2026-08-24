# Multi Texture Batcher 0.3.2

Cocos Creator 3.8.6 项目级 Web/H5 多纹理合批扩展。运行时对安全的标准 `Sprite`、`Label` 实例做局部、可逆升级，不修改 Creator 的 `Batcher2D`、组件原型或项目序列化资产。

## 当前能力

- 一个批次最多绑定 8 张已有纹理，第 9 张纹理安全创建下一批。
- 使用独立 `textureSlot` 顶点属性，不编码或覆盖 UV。
- Sprite 首期支持 SIMPLE、SLICED。
- Label 复用官方 TTF、CHAR、BMFont 几何和文字纹理生成流程。
- Mask 本体保持官方渲染，进入和退出 Mask 都作为批次边界。
- 自定义材质、Tiled/Filled Sprite、RenderTexture、分离 Alpha 和非 Web 平台回退官方渲染。
- 运行时自动发现安全的标准 Sprite/Label，并为对应 Canvas 创建临时 Scope，不写回 Scene。
- 不再转换 Sprite/Label 的 `__type__`；编辑器扫描始终只读。
- 可恢复 0.2.x 已创建的序列化转换备份。

## 总开关与生命周期

扩展面板中的总开关是运行时唯一入口：

- 打开：安装或刷新运行时资源，新启动的 Web/H5 预览和新构建启用合批。
- 关闭：完整移除运行时资源，新启动的预览和新构建使用 Creator 官方渲染。
- Creator 启动或扩展重新加载：只检查当前状态，不自动安装，也不改变总开关。

总开关打开后，运行时资源位于：

```text
assets/resources/__multi_texture_batcher__
```

该目录由扩展管理并已加入项目忽略规则。总开关状态由该目录是否安装完整决定，因此关闭后重启 Creator 仍保持关闭。

## 接入

1. 在扩展面板打开“启用多纹理合批”总开关。
2. 重新启动 Web 预览，运行时自动扫描当前激活 Canvas。
3. 可执行“只读扫描项目”查看 Scene/Prefab 中的静态候选数量。
4. 0.2.x 曾执行过转换时，先点击“恢复旧版转换”，再重新预览。
5. 不支持的组件和状态继续使用 Creator 官方渲染。

运行时只在 Web/H5 加载，不修改业务 TypeScript。旧版备份与清单位于项目已忽略的 `local/multi-texture-batcher`。

## 自测

```text
?multiTextureBatcher=selftest
?multiTextureBatcher=selftest-nine
?multiTextureBatcher=selftest-mixed
?multiTextureBatcher=selftest-char
?multiTextureBatcher=selftest-bitmap
?multiTextureBatcher=selftest-mask
?multiTextureBatcher=selftest-off
```

控制台调试接口只影响当前页面，不改变编辑器总开关：

```js
MultiTextureBatcher.getStats()
MultiTextureBatcher.setEnabled(false)
MultiTextureBatcher.setEnabled(true)
MultiTextureBatcher.refresh()
MultiTextureBatcher.getSelfTestResult()
```

## 自动测试

```powershell
node --test extensions/multi-texture-batcher/test/*.test.js
```

## 使用帮助

Creator 菜单“打开使用帮助”提供总开关、Web/H5 适用平台、每批最多 8 张纹理、Mask/材质边界、只读扫描和旧版恢复说明。插件不修改 Scene/Prefab；关闭总开关会移除扩展管理的运行时资源。
