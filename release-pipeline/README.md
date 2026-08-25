# Release Pipeline

Cocos Creator 3.8.x build extension for release post-processing.

It supports two compatible entry points:

- Cocos Creator build hook: runs after editor builds.
- CLI: runs through `node tools/release-web.js` or `npm run release:web`.

Both entry points use the same task pipeline in `lib/pipeline.js`.

## Default Tasks

```text
cleanBackup -> obfuscateJs -> fingerprintBuild -> zipBuild -> writeReport
```

Task order is configured in `config/default-config.json`.

## Commands

Build with Cocos Creator and then run the pipeline:

```bash
npm run release:web
```

Run only post-processing against `build/web-mobile`:

```bash
npm run release:web:pipeline
```

Run a local self-test without touching `build/web-mobile`:

```bash
node tools/test-release-pipeline.js
```

## Cocos Creator Path

`tools/release-web.js` looks for `CocosCreator.exe` in common install paths and prefers the version from `package.json`.

You can override it:

```powershell
$env:COCOS_CREATOR_EXE="C:\ProgramData\cocos\editors\Creator\3.8.6\CocosCreator.exe"
```

## Notes

The default obfuscation config uses two groups:

- `game-main`: obfuscates `assets/main/index.*.js`.
- `web-root-sdk`: lightly obfuscates root web SDK/helper scripts such as Firebase, Google/Facebook event glue, and floating-button helpers.

The root SDK group keeps conservative options and reserves known `window.*` callback names. Engine files, polyfills, and bootstrap entry files stay excluded.

`fingerprintBuild` is a required release boundary. It computes the configured MD5 prefix from final bytes, rewrites HTML/JS/JSON references, propagates `src/import-map` and Cocos `settings` changes, audits local JS/Worker URLs, and only then allows `zipBuild` to run. The task is automatically inserted after `obfuscateJs` or before `zipBuild` when a custom task list omits it.

After fingerprint propagation converges, the task treats the root `index.<hash>.js` referenced directly by `index.html` as the human-readable version anchor. It injects that exact hash into the final HTML as `window.__GALA_BUILD_FINGERPRINT__`, records the same path/hash in `release-integrity-manifest.json.versionAnchor`, and then performs the final audit. Runtime version labels use `appVersion_fingerprint`; complete artifact integrity continues to use `releaseId` and SHA256.

Cocos bundle `config.<version>.json` and `index.<version>.js` intentionally share one `bundleVers` value. That value is a length-delimited combination digest of the final `index` and final `config` bytes, so a config-only change also creates a new URL. Both files are moved together, and the `settings` hash/reference chain is updated. This preserves Cocos 3.8 runtime loading while keeping the complete Bundle URL content-addressed.

The fingerprint task uses a staging directory and atomic replacement. A failed reference or hash audit stops the pipeline before zip generation. Existing Service Worker cache migration remains controlled by the generated Worker (`networkFirst` navigation, versioned `cocos-pwa-cache-*` cache, `updateViaCache: 'none'`, and `debug=1` network bypass); server headers must still prevent HTML/Worker responses from being immutable.

## 使用帮助

Creator 菜单“打开使用帮助”说明构建、混淆、Bundle 组合指纹、ZIP、审计、`--force`、回滚和缓存策略。Bundle 版本由最终 index/config 组合字节决定，四个 Bundle 必须与 settings 一致。
