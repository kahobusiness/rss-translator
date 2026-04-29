# RSS Translator

将精选英文技术博客自动翻译成中文的 RSS 服务。基于 MiniMax-M2.7 翻译，部署在 Vercel 上，输出标准 RSS 格式，可直接在 Reeder 等阅读器中订阅。

## 特性

- 从 92 个 HN 热门博客中精选 20 个高质量信源，覆盖 AI、安全、系统、科技、硬件 5 个领域
- MiniMax-M2.7 翻译，带专业 system prompt（保留代码/HTML 结构、技术术语首次标注英文）
- Token-budget 动态打包：根据 204,800 上下文窗口自动分配输入/输出预算，长文 HTML-safe 切片
- 批次内 5 路并发 + 指数退避重试，充分利用 500 RPM / 20M TPM 配额
- RSS 内容不足时自动抓取原文全文，提升翻译质量
- 翻译失败自动重试，不遗漏任何文章
- 聚合订阅 + 单源订阅，文章标题标注来源
- Vercel Blob 持久化存储，聚合索引加速查询

## 快速开始

### 部署到 Vercel

1. Fork 此项目，在 [Vercel](https://vercel.com) 中导入
2. 配置环境变量（见下方）
3. 部署完成后，在 RSS 阅读器中订阅：

```
# 推荐 — 聚合订阅（20 个源合并）
https://your-domain.vercel.app/api/feed/all

# 单独订阅
https://your-domain.vercel.app/api/feed/simonwillison-net
https://your-domain.vercel.app/api/feed/paulgraham-com
```

### 本地开发

```bash
npm install
cp .env.example .env.local  # 编辑填入 API 密钥
npm run dev                  # http://localhost:3000
```

## 环境变量

### 翻译 API（必须配置）

**MiniMax（默认）：**

| 变量 | 说明 |
|------|------|
| `API_KEY` | MiniMax API 密钥 |
| `API_BASE_URL` | 可选，默认 `https://api.minimaxi.com/anthropic` |
| `MODEL_NAME` | 可选，默认 `MiniMax-M2.7` |

**官方 Anthropic API：**

| 变量 | 说明 |
|------|------|
| `API_KEY` | Anthropic API 密钥 |
| `API_BASE_URL` | 设为 `https://api.anthropic.com` |
| `MODEL_NAME` | 设为 `claude-sonnet-4-20250514` |

### 存储与其他

| 变量 | 必须 | 说明 |
|------|------|------|
| `BLOB_READ_WRITE_TOKEN` | 生产环境必须 | Vercel Blob 存储 token |
| `CRON_SECRET` | 推荐 | 保护 cron 端点的 Bearer token |
| `OPML_URL` | 可选 | 自定义 OPML 源地址 |
| `GITHUB_TOKEN` | 可选 | 避免 GitHub API 匿名限流 |

## API 端点

| 端点 | 描述 |
|------|------|
| `/api/feed/all` | 聚合所有源的翻译 RSS（推荐订阅） |
| `/api/feed/[id]` | 单个源的翻译 RSS |
| `/api/feeds` | 所有可用源列表（JSON） |
| `/api/cron?batch=N` | 定时任务入口（Vercel Cron 自动调用） |

## 信源管理

默认从 [HN Popular Blogs 2025 OPML](https://gist.github.com/emschwartz/e6d2bf860ccc367fe37ff953ba6de66b) 加载 92 个博客源，通过 `config/feeds.ts` 中的 `CURATED_FEED_IDS` 白名单筛选为 20 个精选信源。

当前精选覆盖的领域：

| 领域 | 数量 | 代表信源 |
|------|------|----------|
| AI 与深度思考 | 5 | Simon Willison, Dwarkesh Patel, Gwern, Gary Marcus, Ed Zitron |
| 系统与工程实践 | 4 | antirez, Rachel Kroll, Armin Ronacher, Mitchell Hashimoto |
| 科技行业与文化 | 6 | Daring Fireball, Construction Physics, Paul Graham, Cory Doctorow, Anil Dash, Tedium |
| 安全 | 3 | Krebs on Security, Troy Hunt, lcamtuf |
| 硬件与底层 | 2 | Ken Shirriff, Fabien Sanglard |

修改精选列表：编辑 `config/feeds.ts` 中的 `CURATED_FEED_IDS` Set。设为 `null` 可使用 OPML 中的全部信源。

## 翻译策略

针对 MiniMax-M2.7 的 204,800 token 上下文窗口设计了三层策略：

1. **单篇切片**：超过 50K token 的长文按 HTML 块级标签边界切分，无损重组
2. **动态打包**：按 140K token 输入预算贪心装箱，短文一批装 10-20 篇，长文独占
3. **动态输出**：`max_tokens` 按输入动态计算（上限 50K），替代固定值

批次内 5 路并发处理，429/5xx 错误自动指数退避重试（500ms / 1.5s / 4s + 抖动）。

## 定时更新

`vercel.json` 配置了 4 个 cron 批次（batch 0-3），每 6 小时交错执行，每批处理 5 个 feed（共 20 个）。

翻译失败的文章会被标记为 `translated: false`，在下次 cron 中自动重试。

## 存储

- **生产环境**：Vercel Blob（持久化）
- **本地开发**：`./data/` 目录（文件系统）

每个 feed 保留最近 100 篇文章。聚合索引 `_recent_items.json` 缓存最新 100 篇，避免全量扫描。

## License

MIT
