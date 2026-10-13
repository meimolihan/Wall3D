# 星云漫游 · 场景骨架构建说明

这是 `kpanel-scene-pack@1` 的 three.js 起步骨架，目录结构对齐 KPanel 官方 `scene-packs/_template/`。

## 本地预览

任意静态服务器打开 `index.html` 即可（`importmap` 从 CDN 加载 three.js，仅限开发阶段）：

```bash
cd scene-template
python -m http.server 8000
# 浏览器打开 http://127.0.0.1:8000/index.html
# 看第 2 个机位：http://127.0.0.1:8000/index.html?entrance=off&shot=1
```

## 开发一个新场景

1. 复制整个 `scene-template/` 为 `objects/<你的 id>/`（或 KPanel 仓库的 `scene-packs/<id>/`）；
2. 改 `manifest.json`：`id`（与目录名一致）、`name` / `description`（含 zh-CN 与 en-US）、`author`、`theme`、`cameras`、`tags`；
3. 改 `scene.js`：`SHOTS` 的 id 与 `manifest.json` 的 `cameras` 保持一致；把 `buildNebula()` 换成你自己的世界；
4. 截图出海报与缩略图（`?entrance=off&shot=N` 直接定机位）：
   - `poster.webp`：16:9，建议 1664×936，≤200 KB
   - `thumb.webp`：16:9，400×225，≤40 KB

## 发布到 KPanel

开发用 importmap + CDN 仅限本地；KPanel 沙箱 CSP 只允许包内资源，**必须打包**：

1. 用 esbuild / vite 把 `scene.js` + three.js 打包成无 importmap 的单文件 `dist/scene.js`：

   ```bash
   npx esbuild scene.js --bundle --format=esm --outfile=dist/scene.js --minify
   ```

2. 复制 `index.html`（去掉 importmap）、`manifest.json`、`poster.webp`、`thumb.webp`、`assets/`（如有）到 `dist/`；
3. 把 three.js 在 `manifest.json` 的 `dependencies` 里声明来源与版本（已声明）；
4. 按官方流程构建 + 校验（在 KPanel 仓库内）：

   ```bash
   npm --prefix web run scene-packs:build
   node scripts/check-scene-packs.mjs
   ```

5. 提 Pull Request。

## 骨架实现的三件套（规范建议）

- **进场**：`ENTRANCE_SECONDS = 4`，从近景拉远 + 粒子渐显（`uReveal` 逻辑换成 `arrival`）；
- **待机呼吸**：粒子大小 + 星核光晕明灭，缓慢自转；
- **机位转场**：`TRANSITION_SECONDS = 4` 三次缓动插值（position / target / fov），`HOLD_SECONDS = 30` 自动轮换。

## 生产环境优化（强烈建议，见官方规范第 4 节）

当前骨架在主线程渲染。发布前建议把渲染放进 **Worker + OffscreenCanvas**（官方 `src/runtime.ts` 的做法）：iframes 与面板共用一个主线程，主线程渲染会在编译着色器 / 上传显卡时让桌面卡顿。浏览器不支持时退回 `?worker=off` 主线程渲染。

关键点：沙箱是不透明源，Worker 只能从自己创建的 `blob:` 启动；Worker 里相对地址用 `THREE.DefaultLoadingManager.setURLModifier` 按页面地址解析；图片用 `ImageBitmapLoader`。
