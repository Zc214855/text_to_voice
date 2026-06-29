# 2026-06-30 项目审查进展

## 阶段 1：结构与上下文读取

- 已确认当前项目目录：`D:\LAYABOXPROJECT\CodeProject\text_to_voice`。
- 已确认故事文本目录：`D:\LAYABOXPROJECT\CodeProject\story_text`。
- 当前项目是 Vue 3 + TypeScript + Vite 前端，配套本地 Express 服务用于 Edge TTS 与作品库文件存储。
- 故事文本目录包含“小熊猫团团的晚安中国”系列文本、纯叙述版文本、系列大纲与格式规则。
- 当前 Git 状态显示 `web/src/data/voices.json` 已有未提交改动；本次审查不覆盖该文件。
- 初步风险点：需要验证构建、测试、后端语法、故事文本格式与角色解析链路是否一致。

## 阶段 2：基础验证

- `npm test`：通过，3 个测试文件、44 个用例全部通过。
- `node --check server/index.js`：通过。
- `npm audit --omit=dev`：通过，0 个生产依赖漏洞。
- `npm run build`：通过，Vite 产物已生成到 `web/dist`。
- `npm run typecheck`：失败。
- 类型检查失败点：
  - `web/src/components/TTSApp.vue:764`、`:784`、`:786`：模板中比较 `activeEngine === 'edge'`，但 TypeScript 当前推断该分支下 `activeEngine` 只能是 `'volc'`。
  - `web/src/composables/useSharedHistory.ts:157`：`catch` 块引用 `oldItem`，但变量定义在 `try` 块内，作用域不可见。
- 编码确认：源码本身为 UTF-8；此前终端乱码来自 PowerShell 默认解码。

## 阶段 3：故事文本与业务风险

- 10 个角色分音版故事均满足基础格式：首行为 `标题：...`，角色行使用中文冒号，正文角色与 `[角色音色]` 元数据角色一致。
- 10 个角色分音版正文长度约 914-1423 字，均低于睡前分音版建议上限 1800 字，也低于项目单次 5000 字限制。
- 10 个“纯叙述版”文件是单段朗读材料，不是角色分音格式；直接用于“角色故事”模式会被解析为旁白，不会得到多角色分音。
- `web/public/config.json` 已被 Git 跟踪，且包含真实形态 API Key；该文件会作为 Vite public 静态资源发布，存在密钥泄露风险。
- `web/src/data/voices.json` 当前已有用户改动：360 个音色，0 个重复 ID，0 个缺失字段；但测试只覆盖精简假数据，未覆盖当前真实音色列表的推荐排序。
- `web/public/config.json` 包含 `seed-icl-2.0`，当前 `voices.json` 没有该资源音色；若没有配置 `cloneVoices`，切到该资源会出现无可用音色或资源不匹配。
- 未执行真实火山 TTS 或 Edge TTS 合成请求，避免产生外部费用或依赖网络状态。

## 阶段 4：角色故事重构

- 用户确认 `public/config.json` 的 API Key 仅本机使用，暂不处理密钥迁移。
- 已修复 `useSharedHistory.renameItem` 中 `oldItem` 作用域错误。
- 已移除主界面的单段模式、顶层“云端/本地”切换和“整理文本”入口。
- 已删除无入口的火山/Edge 单段合成导出，保留角色故事与逐段底层合成能力。
- 主界面改为唯一工作流：输入角色分音故事，解析角色和 `[角色音色]` 元数据，自动生成角色级音色方案。
- 新增 `voicePlanner` 统一推荐器：同一角色会同时评估火山云端音色与 Edge 本地音色，按角色名、角色描述、年龄、性别、语气、模型质量和普通话适配排序。
- 角色面板支持逐角色手动切换云端/本地候选音色，并保留推荐参数的可调节能力。
- 克隆音色继续由火山配置中的 `cloneVoices` 注入，并参与云端候选推荐。
- 新增底层音频合成入口：主界面可按角色逐段调用火山或 Edge，再合并为单个 WAV 作品保存。
- 已新增 `voicePlanner.test.ts` 覆盖跨引擎候选池和儿童角色推荐。
- 当前阶段验证：`npm run typecheck` 通过；`npm test` 通过；`node --check server/index.js` 通过。

## 阶段 5：重构后验证

- `npm test`：通过，4 个测试文件、46 个用例全部通过。
- `npm run typecheck`：通过。
- `npm run build`：通过。
- `npm audit`：通过，0 个漏洞。
- `node --check server/index.js`：通过。
- 本地服务验证：
  - `http://127.0.0.1:5174/api/edge-tts/health` 返回 `{"status":"ok"}`。
  - `http://127.0.0.1:5173` 返回 HTTP 200。
- 浏览器渲染验证：
  - 首屏包含 `睡前故事分音`、`角色推荐`、`生成角色音频`。
  - 首屏不再包含 `单段` 和 `整理文本`。
  - 默认示例已自动推荐云端首选音色，候选列表仍包含本地 Edge 音色，可逐角色切换。
  - 默认示例的 3 个角色音色下拉均包含 390 个候选，并且每个下拉都同时包含云端候选与本地候选。

## 阶段 6：底部说明区恢复

- 按用户反馈恢复底部 UI 说明区。
- 说明内容已改为匹配当前角色故事唯一工作流：
  - 角色文本格式。
  - 统一推荐逻辑。
  - 云端与本地音色差异。
  - 克隆音色配置与保存位置。
- 未恢复单段模式说明，避免与当前产品流程冲突。

## 阶段 7：说明区细化

- 按用户反馈将说明区从概念文案改为可操作说明。
- 新增控制台和文档入口：
  - 火山语音控制台。
  - API Key 管理。
  - 音色列表文档。
  - V3 接口文档。
- 新增模型 / 服务表：
  - 火山语音合成 2.0：`seed-tts-2.0`。
  - 火山语音合成 1.0：`seed-tts-1.0`。
  - 火山声音复刻 2.0：`seed-icl-2.0`。
  - Microsoft Edge Neural：`/edge-api/synthesize`。
- 新增配置字段说明：`apiKey`、`resourceId`、`resourceIds`、`cloneVoices`。
- 新增推荐参数说明：语速、音调、音量、情绪。
- 新增生成链路说明：角色分音文本、候选选择、逐段合成、400ms 间隔、WAV 保存到 `output`。
- 验证：`npm run typecheck`、`npm test`、`npm run build` 均通过。
