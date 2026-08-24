# Web 发布诊断中心

这是一个适用于 Cocos Creator 3.8.6 的 Web 发布诊断扩展。它与 `release-pipeline` 共用 `core/cache-doctor.js`，检查本地 ZIP、源站、CDN 公网和浏览器只读报告是否属于同一个发布版本。

## Creator 菜单

```text
扩展 -> Web 发布诊断中心 -> 打开诊断面板
扩展 -> Web 发布诊断中心 -> 快速诊断
扩展 -> Web 发布诊断中心 -> 打开最新报告
```

## CLI

```powershell
node tools/release-cache-doctor.js --zip build/web-mobile.zip --url https://h5test.dudle.shop
```

可增加 `--origin-url` 对比源站，使用 `--json` 和 `--markdown` 导出报告。CLI 默认不添加时间戳或 `debug=1`，不访问 `/api/`，不执行 purge、注销 Worker 或删除浏览器缓存。

## 面板分页

- 快速诊断：自动发现 `build/web-mobile`、ZIP 和最近配置，执行可取消的关键文件检查。
- 文件对比：显示 HTTP 状态、文件大小、SHA-256、Cache-Control、ETag、Age 和 CF-Cache-Status。
- 引用链：显示 `index.html -> root index -> application -> import-map -> settings -> Bundle index/config`。
- 浏览器缓存：复制只读脚本并导入浏览器 JSON；不读取 Cookie、localStorage、Token、API 响应或用户数据。
- 历史报告：查看 `build/cache-doctor-reports` 下的 JSON、Markdown 和 HTML 报告。
- 使用帮助：面板内搜索中文帮助，不依赖外部浏览器。

## 问题分类

诊断会输出本地构建不一致、ZIP 损坏、源站部署不一致、CDN 返回旧版本、同一指纹对应不同内容、引用链版本混用、Service Worker 过期、CacheStorage 内容不一致、缓存响应头错误、关键文件缺失、需要浏览器侧检查和全部通过等结论。

`browser-cache-doctor-fix.js` 是独立事故恢复脚本，执行前会确认，只清当前站点的 Service Worker 和 `cocos-pwa-cache-*`，不会清理登录态。它不能代替正确的 Bundle 组合指纹、入口 `no-cache` 和完整 ZIP 部署。
