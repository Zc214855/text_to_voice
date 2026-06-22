# 项目分析进展

## 2026-06-06 阶段 1：结构扫描

- 根目录包含 `web` 前端工程、`stories` 示例文本、`start.bat` 启动脚本、`使用文档.md`。
- `web` 是 Vue 3 + TypeScript + Vite 工程。
- 核心模块：`TTSApp.vue`、`useTTS.ts`、`useEdgeTTS.ts`、`useSharedHistory.ts`、`server/index.js`。
- 初步风险：`web/src/composables/useTTS.ts` 与 `web/server/index.js` 终端读取出现中文乱码/疑似源码编码损坏，需要构建验证。

## 2026-06-06 阶段 2：构建验证

- `npm run typecheck` 通过。
- `npm run build` 通过，产物生成于 `web/dist`。
- 复查 `rg` 输出后确认中文源码可正常读取；前次乱码属于 PowerShell 输出编码问题。
- 当前仓库存在 `web/public/config.json`，其中包含可疑真实 API Key；该文件会随 Vite public 静态发布暴露。

## 2026-06-06 阶段 3：静态风险检查

- `npm audit --omit=dev` 结果：0 个生产依赖漏洞。
- `node --check web/server/index.js` 通过。
- 火山 TTS 鉴权在浏览器端完成，`X-Api-Key` 从 public 配置读取；该设计会暴露密钥。
- Vite `/volc-api` 与 `/edge-api` 代理只在开发服务器有效；纯静态生产部署需要额外网关或后端。
- Edge TTS 服务启用全局 CORS，且 `app.listen(PORT)` 未限制只监听本机地址；在局域网环境存在被调用风险。

## 2026-06-06 阶段 4：图片生成重试需求

- 当前工程仅包含火山语音合成与 Edge TTS，不存在 LLM 或 Seedream 图片生成调用。
- 无法在本工程实现“缓存 LLM 结果，仅重试图片生成”；需要定位实际图片生成工程。
- 模型选择建议：默认 Seedream 5.0 lite；仅在确实需要 1K 小图时提供 Seedream 4.0 作为“经济/小尺寸”选项。

## 2026-06-06 阶段 5：风险修复

- Edge TTS 服务移除全局 CORS，并限制监听 `127.0.0.1`。
- Vite 开发与生产预览统一配置火山/Edge 代理。
- 新增 Vitest 与 `textCleanup` 自动化测试。
- 智谱兼容接口与火山方舟 `/api/v3` 属于大模型推理接口，不直接提供本项目需要的音频合成结果，未接入。
- 自动化测试发现并修复：带前导空格的 Markdown 列表符号无法被文本整理器移除。
- Vitest 3.x 存在安全公告，依赖升级至 4.1.8。

## 2026-06-06 阶段 6：最终验证

- `npm test`：4 项测试全部通过。
- `npm run typecheck`：通过。
- `npm run build`：通过。
- `npm audit --omit=dev`：0 个生产依赖漏洞。
- `node --check server/index.js`：通过。
- 生产预览 `http://127.0.0.1:4173/edge-api/health` 经代理返回 `{"status":"ok"}`。

## 2026-06-06 阶段 7：复核

- `npm audit`（含开发依赖）：0 个漏洞。
- Edge 健康接口直连与 Vite preview 代理均返回 HTTP 200。
- Edge 直连接口不再返回 `Access-Control-Allow-Origin`。
- 未发现阻断运行或需要继续修改的问题。
- 剩余验证缺口：未调用会产生外部请求或费用的真实火山 TTS、Edge 合成接口。
