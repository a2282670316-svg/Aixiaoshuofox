# 万象小说工坊

面向个人小说作者的 AI 长篇创作工作台。项目覆盖从灵感、设定、人物和大纲，到自动写作、一致性审校、云端检查点、版本历史和成稿导出的完整流程。

## 已实现功能

- AI 全书创作：没有灵感时自动生成 3 个故事方向，并支持 AI 代选
- 分阶段蓝图：人物、设定、大纲、伏笔、章节依次生成并分别校验；每章包含目标、开场、场景链、转折、结尾钩子和伏笔任务，支持暂停、阶段恢复和从任一阶段重做
- 连续写作：按章、按段生成全书，支持暂停、错误重试和刷新后续写
- 长篇记忆：每章完成后提取梗概、时间线、人物状态、事实和待回收线索
- 逐章审校：每章完成后自动对照前文事实、章纲与伏笔任务；问题带正文证据、修复建议，并支持保留旧版本的一键 AI 修复与复查
- 成本保护：所有手动、自动、审校和修复请求在发送前占用调用预算，并分别累计输入、输出和总 Token
- 多作品管理：新建、切换、复制和删除作品；云端保存使用版本号避免多页面静默覆盖
- 双层持久化：浏览器即时保存，同时通过 D1 保存作品、运行状态、生成步骤和事实账本
- 安全恢复：蓝图每个阶段和正文每个分段完成后写入检查点；刷新后可从最近阶段继续，新蓝图、导入和恢复前自动备份
- 章节级回退：可从任意章节重新开始写作，自动存档旧正文，并同步回滚后续章节记忆、事实账本和 AI 审校结果
- 写作调度中心：可选择起止章节、预估分段与模型调用，在超预算或前文缺失时阻止启动，浏览器与云端后台共用同一范围
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
npm run check
npm run security:audit
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
- 后台写作：支持 OpenAI 官方 Webhook，也支持第三方 Responses 接口轮询；关闭网页后仍按“章节段落 → 章节记忆 → 滚动审校”的顺序继续

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

### 第三方 Responses 接口

第三方接口不会触发 OpenAI 官方 Webhook。请在 `.env.local` 中配置：

```text
BACKGROUND_AI_BASE_URL=https://your-provider.example/v1
BACKGROUND_AI_API_KEY=第三方接口密钥
BACKGROUND_AI_MODEL=gpt-5.5
BACKGROUND_WORKER_SECRET=至少32位随机字符串
BACKGROUND_SITE_URL=http://localhost:5173
```

启动网站后，在另一个终端运行：

```bash
npm run background:worker
```

只要网站服务和工作器进程仍在运行，即使关闭浏览器，第三方后台任务也会继续。公网 HTTP 会明文传输 API Key、提示词和小说正文，生产环境建议让接口提供 HTTPS。

## 技术结构

- Next.js 16、React 19、TypeScript
- Vinext 与 Cloudflare Worker 运行时
- Cloudflare D1 与 Drizzle ORM
- Sites 生产部署
- OpenAI Chat Completions 兼容 AI 代理
- OpenAI Responses API 后台模式与签名 Webhook
- 第三方 Responses API 轮询工作器
