# 万象小说工坊

面向个人小说作者的 AI 长篇创作工作台。项目覆盖从灵感、设定、人物和大纲，到自动写作、一致性审校、云端检查点、版本历史和成稿导出的完整流程。

## 已实现功能

- AI 全书创作：没有灵感时自动生成 3 个故事方向，并支持 AI 代选
- 自动蓝图：一次建立作品信息、人物、世界观、关系、大纲、伏笔和章节目录
- 连续写作：按章、按段生成全书，支持暂停、错误重试和刷新后续写
- 长篇记忆：每章完成后提取梗概、时间线、人物状态、事实和待回收线索
- 滚动审校：每 5 章及全书结尾自动审查人物、时间线、世界规则和伏笔
- 成本保护：限制最大模型调用数和 Token，并显示实际消耗
- 多作品管理：新建、切换、复制和删除作品
- 双层持久化：浏览器即时保存，同时通过 D1 保存作品、运行状态、生成步骤和事实账本
- 安全恢复：每段生成后写入检查点；新蓝图、导入和恢复前自动备份
- 完整工作台：灵感、世界观、人物、关系图、大纲、章节、素材、一致性、版本和导出
- 响应式界面：支持桌面、平板和手机布局

## AI 配置

在“设置 → AI 模型”中填写：

1. OpenAI Chat Completions 兼容接口地址，例如 `https://api.openai.com/v1` 或 `http://127.0.0.1:11434/v1`
2. API Key
3. 模型名称
4. 创作温度

接口地址支持 HTTP 和 HTTPS，可选择“自动识别、Chat Completions、Responses API”。显式 `/responses` 地址会原样使用；自动模式在 Chat 端点返回 404 时会尝试 Responses。Responses 请求只发送合法的文本输入，不会把 `output_text` 当成输入类型。API Key 可留空，适合 Ollama 等无需鉴权的本地服务。AI 请求通过 `/api/ai` 转发，服务端默认不持久化 API Key 或生成内容。公网 HTTP 会以明文传输内容和密钥，建议公网模型使用 HTTPS；本机和内网接口只允许在本地运行本站时访问。

“AI 全书”默认按约 2200 字一段连续生成。每段、每章记忆和滚动审校完成后都会写入检查点。使用浏览器中的 API Key 时，自动写作期间需要保持页面打开；暂停或意外刷新后，可以从已保存位置继续。

## 本地运行

需要 Node.js `22.13.0` 或更高版本。

```bash
npm run install:ci
npm run dev
```

打开 `http://localhost:5173/`。

生产验证：

```bash
npm run lint
npm exec -- tsc --noEmit
npm test
```

数据库结构变更后生成迁移：

```bash
npm run db:generate
```

## 云端数据与认证

Cloudflare Sites 配置在 `.openai/hosting.json`，D1 绑定名为 `DB`。数据表包括作品、自动化运行、生成步骤、事实账本和作品快照。

- 本地开发仅允许来自 `localhost`、`127.0.0.1` 或 `::1` 的请求使用本地开发身份
- 生产环境从 `oai-authenticated-user-email` 请求头取得登录用户，并按用户隔离作品
- 写入接口执行同源校验和请求体大小限制
- 浏览器 `localStorage` 仍作为断网和云端异常时的本地兜底
- 建议定期从“设置 → 数据管理”导出 JSON 完整备份；备份不包含 API Key

## 关闭网页后继续写作

项目支持两种连续写作方式：

- 浏览器连续写作：可使用任意 HTTP/HTTPS Chat Completions 兼容接口，页面需保持打开
- 云端后台写作：使用 OpenAI Responses API 后台模式与 Webhook 接力，关闭网页后仍会按“章节段落 → 章节记忆 → 滚动审校”的顺序继续

云端后台模式需要在部署环境设置：

```text
OPENAI_API_KEY=服务端 OpenAI API Key
OPENAI_MODEL=支持 Responses API 的模型名称
OPENAI_WEBHOOK_SECRET=OpenAI Webhook 签名密钥
```

在 OpenAI 项目中创建 Webhook，订阅 `response.completed`，回调地址为：

```text
https://你的站点/api/openai/webhook
```

后台任务会在 D1 中保存模型响应编号、运行步骤、调用次数、Token、错误和幂等 Webhook 事件。重复回调不会重复写入正文；达到预算上限会停止提交新步骤；点击暂停会取消当前后台响应。

## 技术结构

- Next.js 16、React 19、TypeScript
- Vinext 与 Cloudflare Worker 运行时
- Cloudflare D1 与 Drizzle ORM
- Sites 生产部署
- OpenAI Chat Completions 兼容 AI 代理
- OpenAI Responses API 后台模式与签名 Webhook
