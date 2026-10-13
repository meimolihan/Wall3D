# KPanel 桌面 3D 场景包开发规范（中文精简版）

> 来源：[kejilion/KPanel · scene-packs/README.md](https://github.com/kejilion/KPanel/blob/main/scene-packs/README.md)
> 整理日期：2026-10-13 ｜ 本文为精简摘录，以官方原文为准

一个 **3D 场景包**就是一个目录，KPanel 把它当动态壁纸运行。目录名即包 ID。规范只约束三件事：**宿主协议、安全边界、体积上限**——用什么引擎、什么美术风格、什么镜头语言，全由作者决定。

## 1. 目录结构

```
scene-packs/<id>/
├── manifest.json     元数据（必需）
├── index.html        入口页面（必需，脚本必须是外部文件，CSP 禁内联）
├── src/              可读源码（必需，供审核）
├── poster.webp       静态帧，16:9，建议 1664×936，≤200 KB
├── thumb.webp        缩略图，16:9，400×225，≤40 KB
├── [preview.webm]    悬停预览，≤8 秒、≤3 MB、无声（可选）
├── assets/           运行时模型/贴图/数据（glTF 分离格式，禁嵌入图片）
└── dist/             发布文件，面板只下载这里
```

**体积硬限制**：每包 ≤200 个文件、总计 ≤30 MB、单文件 ≤16 MB、路径深度 ≤4 层；文件名只用小写字母、数字、`-`、`_`、`.`。

## 2. manifest.json

```json
{
  "schema": 1,
  "id": "orbital-station",
  "version": "1.0.0",
  "runtime": "kpanel-scene-pack@1",
  "name": { "zh-CN": "星港轨道", "en-US": "Orbital Station" },
  "description": { "zh-CN": "……", "en-US": "……" },
  "author": { "name": "你的名字", "url": "https://github.com/you" },
  "license": "MIT",
  "tags": ["space", "sci-fi"],
  "entry": "index.html",
  "poster": "poster.webp",
  "thumb": "thumb.webp",
  "theme": { "brand": "#2f6fd0", "neutral": "#33415a", "signature": "#35b8d6" },
  "cameras": [
    { "id": "panorama", "name": { "zh-CN": "全景", "en-US": "Panorama" } }
  ],
  "dependencies": [{ "name": "three", "version": "0.186.0", "license": "MIT" }]
}
```

要点：`id` 与目录名一致，发布后不可改；内容变化要升 `version`；`name`/`description` 至少提供 `zh-CN` 与 `en-US`（中文名 ≤20 字、描述 ≤40 字）；`cameras` 1–6 个，顺序即机位编号；`theme` 三项（brand 主色 / neutral 中性 / signature 点缀），每个场景只有一套。

## 3. 宿主协议（postMessage）

场景页面与桌面之间只有 `postMessage`，`targetOrigin` 用 `'*'`。

**场景 → 桌面**（发给 `window.parent`）：

| 消息 | 时机 |
| --- | --- |
| `{ source:'kpanel-scene-pack', type:'progress', value }` | 加载中（可选），0–1 只增不减 |
| `{ source:'kpanel-scene-pack', type:'ready', cameras:[…] }` | 第一帧画出后立即发送（**必需**，20 秒无消息则桌面改用海报） |
| `{ source:'kpanel-scene-pack', type:'camera', index }` | 机位切换开始时（可选） |
| `{ source:'kpanel-scene-pack', type:'error', reason }` | WebGL 不可用 / 上下文丢失（建议） |

**桌面 → 场景**（只接受 `event.source === window.parent`）：

| 消息 | 场景应做 |
| --- | --- |
| `{ source:'kpanel-desktop', type:'pause' }` | 停止渲染循环（窗口铺满 / 页面隐藏时） |
| `{ source:'kpanel-desktop', type:'resume' }` | 恢复渲染，时间不跳变 |
| `{ source:'kpanel-desktop', type:'camera', index? }` | 转到指定机位；无 `index` 则切下一个 |

**加载与进场**：海报先静止，超约 2 秒未就绪才开始「明暗呼吸 + 细进度线」；收到 `ready` 后约 1.6 秒缓入缓出淡入，保留底层海报，与场景自身曝光/镜头入场同时进行。建议先编译着色器、画出第一帧再发 `ready`。

**URL 参数（约定，非协议要求）**：`?entrance=off&shot=N` 跳过进场、直接看第 N 个机位，供截图 poster 用。

## 4. Worker 渲染（强烈建议）

场景 iframe 与面板同站点共用一个主线程，直接在页面上解码图片/编译着色器/逐帧绘制会让桌面卡顿。官方场景把渲染放进 **Worker + OffscreenCanvas**：

- 沙箱是不透明源，Worker 只能从自己创建的 `blob:` 启动（`importScripts(<scene.js 地址>)`，脚本走缓存）；
- Worker 里相对地址要按页面地址解析（`THREE.DefaultLoadingManager.setURLModifier`，自己的 `fetch` 同理）；
- Worker 里没有 `<img>`/DOM 画布，图片用 `THREE.ImageBitmapLoader`（后台线程解码，`imageOrientation` 翻转），画布纹理用 `OffscreenCanvas`；
- 浏览器不支持时退回页面上运行（URL 加 `?worker=off` 可对比）。

## 5. 加载与性能（质量建议，审核参考不强制）

- 3 秒内发 `ready`（缓存命中 1 秒内）；首次下载尽量 ≤10 MB；1080p 中端集显待机 ≥30 fps；
- 设备像素比封顶 1.5–2；**暂停时完全停止 `requestAnimationFrame`**；
- 构图避开左侧图标列（约 18% 宽）与右侧小部件区（约 22% 宽），主体放中间；
- 画面不出现大面积高频闪烁（每秒 ≤3 次）；
- 进场 3–6 秒、简洁：从黑场淡入 + 一个连贯镜头运动，不闪白、不堆叠特效；
- 待机动作缓慢有「呼吸感」；用 rAF 时间戳推进时间时，**单帧步长 clamp 在 0.05–0.1 秒以内**，避免首帧/恢复后时间倒流跳变；
- 所有文件一开始就并发请求，不等前一个；用 `renderer.compileAsync(scene, camera)` 预编译；贴图用 `renderer.initTexture(texture)` 立即上传；
- 大模型用 Draco 压缩，解码器放 `assets/` 用 `setDecoderPath` 指向并声明依赖；
- 贴图分辨率以场景实际用到的最大 mip 为准。

## 6. 安全边界（硬性）

- iframe 用 `sandbox="allow-scripts"`：**不透明源**，读不到面板 Cookie、会话、localStorage、DOM；不能弹窗、跳顶层、下载、申请摄像头/麦克风/定位/全屏权限；
- 场景文件响应带 CSP：`default-src 'none'`，网络来源限定到当前包资源 URL 前缀，依赖必须打包进 `dist/`，不能用同源整站 `'self'` 放行面板 API；
- 场景无声音；不接收鼠标键盘事件，不依赖交互；
- **禁止**：伪造系统弹窗/登录框/KPanel 界面、仿冒品牌、广告、成人暴力仇恨内容、挖矿或与画面无关的计算、刻意耗尽 CPU/GPU/内存、探测/突破沙箱。

## 7. 开发与发布

```bash
# 1. 复制 _template/（或任意包）为 scene-packs/<你的 id>/，改 manifest.json 与 src/
# 2. 构建：打包 src/main.ts → dist/scene.js，复制入口、图片、assets/，更新 catalog.json
npm --prefix web run scene-packs:build
# 3. 校验
node scripts/check-scene-packs.mjs
```

预览：任意静态服务器打开 `scene-packs/<id>/dist/index.html`（加 `?entrance=off&shot=1` 跳过进场看第 2 个机位）。

发布：在 KPanel 仓库新建 `scene-packs/<id>/`，提交源码 + `dist/` + 图片 + 许可证，运行构建与校验，提 PR；维护者审源码、隔离环境运行、对照第 6 节检查，合并后即出现在场景列表。更新时升 `version` 重新构建。
