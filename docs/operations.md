# 运行与维护

将 20 个精选技术博客翻译成中文，提供聚合与单源 RSS。运行在 Next.js 16 / Node.js 24 / Vercel，继续使用现有 MiniMax Anthropic 兼容 API。

公开聚合订阅：<https://rss.kaho.io/api/feed/all>

## 工作方式

1. 每 6 小时发现文章，4 个批次各抓取 5 个源。
2. 每篇文章先进入持久化任务队列；任务保存原文、当前阶段、分块进度、重试时间、错误和 token 用量。
3. 每 15 分钟的工作任务处理待完成文章。每批最多 4 篇并行、8 次模型请求，每篇每轮最多翻译 2 个分块。
4. 模型只处理 HTML 中的文本和图片 alt；标签、链接、代码、pre、script、style、math、svg 等结构由程序保留，不交给模型改写。
5. 不再截断长文。成功分块立即持久化，下一轮续跑缺失部分。全部分块完成后才发布新译文。
6. 发布分别更新单源存档和聚合索引；若中途失败，任务保留待发布结果，重试不重新调用模型。

旧实现中疑似被截断的长文，会从当前 RSS 和历史存档中发现并进入补译队列。历史补译需要后台逐步完成，不会因为部署完成就瞬间结束。

M3.1 Flash 使用 `output_config.effort=low`，每块约 3600 个估算输入 token、最多 32 个文本片段、最多 16384 个输出 token（含思考），单次最多 100 秒。译文通过 `submit_translation` 工具提交为以原始片段 ID 为键的对象，逐一校验必需键，避免数组遗漏片段后重新编号。仅被行内标签分隔的独立英文冠词 a/an/the 可译为空串；标题和其他正文片段必须非空。返回格式调整沿用原文分块与已有检查点。100 万 token 是上下文容量，不代表应一次输出整篇超长文章；仍保留分块检查点及完整性校验。模型和请求预算均参与检查点版本，切换模型不会混用译文。旧 M2.7 显式配置仍使用原分块预算。

## 存储与一致性

- **私有 Blob**：存档、索引、任务、租约、配置缓存和版本化翻译检查点。通过 `get(..., { useCache: false })` 直接读取源站。
- **原公开 Blob**：保留为只读兼容来源；迁移不会删除旧数据。
- **本地开发**：使用 `data/`，通过文件锁和原子重命名实现条件更新。

所有可变文档使用 ETag 条件写入；冲突会重新读取并重试，读取错误不会当成空文档覆盖。每个 Cron 批次和文章任务持有有期限的独占租约，旧持有者不能释放新租约。

每源保留最近 100 个不同 GUID 的条目。每个批次维护合并历史的独立聚合分片；读取范围由 `vercel.json` 推导，合并并去重后输出最新 100 篇。失败原文不会作为中文译文发布。RSS 使用 UTF-8 流式响应，避免大正文被缓冲响应大小限制截断。

完整译文也保留在私有任务记录的 `result` 中。早于 RSS 最近 100 篇窗口的历史文章可能不在公开订阅中出现，但完成任务不会丢弃它的完整原文和译文。

翻译检查点版本包含原文、标题、模型、API 端点、提示词及结构版本。每篇文章的检查点一次读取，已完成分块不因其他分块失败而丢失。

## 信源配置与故障回退

`config/feeds.ts` 的白名单筛选 OPML 中的 20 个源，`config/default-feeds.json` 保存验证过的应急快照。

回退顺序为：新鲜内存缓存 → 新鲜持久化缓存 → 获取 OPML → 过期但有效的缓存 → 仓库快照。OPML 为空、没有符合白名单的源或请求失败时，不能覆盖有效缓存。失败后短暂冷却，随后重新尝试；不会把失败时间当成成功刷新时间。

RSS 原生正文优先于摘要。缺失或无效发布时间使用稳定占位日期，而不是每次轮询都将旧文章改成“刚发布”。

每个有文章链接的条目都会抓取链接指向的正文，不再依据 RSS 内容长度或 `content:encoded` 标记跳过抓取；链接博客也翻译目标文章，而不只翻译作者评论。没有链接时，仅接受明确提供完整正文的 RSS 条目。正文抓取失败时保留任务重试，不发布摘要冒充全文。Gwern 迁移过的月刊优先读取作者 canonical 版本，旧 Fabien 文章路径支持已验证的新地址及目录地址回退。部署后，现存 Feed 中的旧版译文会随发现任务逐批重新抓取、翻译并替换，已有订阅地址不变。

## 环境变量

| 变量 | 用途 |
| --- | --- |
| `API_KEY` | MiniMax / Anthropic 兼容 API 密钥，必须 |
| `API_BASE_URL` | 默认 `https://api.minimax.cn/anthropic` |
| `MODEL_NAME` | 默认 `MiniMax-M3.1-Flash-Preview` |
| `CRON_SECRET` | Cron 和状态接口的 Bearer 密钥，必须；未配置时接口关闭 |
| `SITE_URL` | 稳定公开域名，例如 `https://rss.kaho.io` |
| `STATE_BLOB_STORE_ID` | 私有 Blob 的 store ID，生产环境必须配置私有存储 |
| `STATE_BLOB_READ_WRITE_TOKEN` | 私有 Blob 的可选显式凭据；否则使用项目 OIDC |
| `RSS_STATE_READ_WRITE_TOKEN` | 当前项目连接私有存储时自动提供的凭据别名 |
| `BLOB_READ_WRITE_TOKEN` | 旧公开存储的兼容读取凭据；新项目不需要旧存储 |
| `TRANSLATION_PROMPT_VERSION` | 手动升级提示词/术语策略的缓存版本，默认 `1` |
| `OPML_URL` | 自定义 OPML 地址 |
| `GITHUB_TOKEN` | 可选，降低 GitHub Gist API 匿名限流风险 |

私有存储应与项目连接。不要用公开 CDN 读取来实现锁或队列即时状态。订阅地址优先使用 `SITE_URL`，其次使用稳定生产域名或请求来源，绝不使用部署专属的 `VERCEL_URL`。

Vercel 中的 `API_KEY`、`CRON_SECRET`、`BLOB_READ_WRITE_TOKEN` 和 `RSS_STATE_READ_WRITE_TOKEN` 使用 **Secret** 类型；新增的存储令牌或 `GITHUB_TOKEN` 也应使用 Secret。普通地址、模型名称及 store ID 使用 Config。Secret 保存后无法从控制台或 API 取回明文，运行中的部署仍可正常使用。类型转换不等于轮换密钥；修改部署配置后需新建部署才能应用。

GitHub 默认分支和 Vercel 生产分支均为 `main`；推送到 `main` 会触发生产部署。

## API 和监控

| 端点 | 用途 |
| --- | --- |
| `GET /api/feeds` | 公开订阅列表 |
| `GET /api/feed/all` | 聚合中文 RSS |
| `GET /api/feed/[id]` | 单源中文 RSS |
| `GET /api/cron?batch=N` | 发现文章并处理队列，需要 Bearer 密钥 |
| `GET /api/cron?batch=N&work=1` | 仅处理持久化队列，需要 Bearer 密钥 |
| `GET /api/cron?batch=N&dryRun=1` | 严格只读诊断，不调用模型或写入任务 |
| `GET /api/status` | 受保护的运行状态；支持 `state=failed`、`feed=源ID` 和 `limit=20` |

### Speed Insights

根布局通过 `@vercel/speed-insights/next` 接入 Speed Insights，采集首页与 `/read/[id]` 阅读页的真实用户性能指标。上报前移除查询参数和片段，不发送文章 GUID；API 路径不采集。SDK 自动识别 Next.js 动态路由。

在 Vercel 项目的 Speed Insights 页面启用后，部署包含 SDK 的版本，再访问首页和阅读页即可开始积累数据。开发环境仅输出调试信息；本地构建不能证明线上已收到数据。查看结果时区分 Production、Preview 与设备类型。本次使用项目现有配置，不升级套餐或开启 Plus。

### Vercel 原生监控

监控复用 Vercel Web Analytics、Observability 和 Runtime Logs，不再维护独立的 Blob 计数、IP 指纹、报表密钥或统计 API。RSS 保留原有 5 分钟浏览器/CDN 缓存。项目不提供公开的监控页面或后台入口，统计数据请登录 Vercel 项目后台查看，访问权限由 Vercel 团队控制。

| 问题 | 数据来源与口径 |
| --- | --- |
| 每天多少人访问网站？ | Web Analytics 的 Visitors / Page Views，仅网页访问 |
| 哪些订阅源被复制？ | Web Analytics 的 `rss_subscription_copy` 自定义事件，按 `feed_id`、`feed_type` 区分；只在剪贴板写入成功后发送 |
| 每天 RSS 被拉取多少次？ | Observability → CDN Requests，查看 `/api/feed/all` 和 `/api/feed/[id]` 路由及 HTTP 状态，包含 CDN 缓存命中 |
| 哪些阅读器访问了源站？ | Logs 搜索 `rss_origin_response`，查看规范化的 `reader` 和 `feed`，只含缓存未命中的 GET |
| 后台翻译是否健康？ | Cron Jobs、Functions、Logs 及已有的 `/api/status` |

Web Analytics 仅追踪公开主页，发送前移除 URL 查询参数与片段，并排除 API 和其他页面。复制事件仅发送源 ID 及聚合/单源类型，不发送复制的完整 URL、IP、完整 User-Agent 或密钥。Analytics 故障不会影响复制操作；没有读取或存储剪贴板中既有的内容。用户禁用脚本或拦截采集会影响网页统计。

**复制成功仅代表订阅意向，不能当作新增订阅人数。** RSS 请求也包含自动刷新、浏览器及机器人；云阅读器可能替多人合并抓取。平台原生请求量和网页访客都无法准确还原 RSS 订阅人数或实际阅读人数。源站返回含文章的成功响应不证明客户端下载完成或有人阅读。

Vercel 部署的 RSS GET 会输出结构化 `rss_origin_response` 日志，包含源 ID（已知列表外统一为 `other`，避免维度膨胀）、阅读器类别、HTTP 状态、文章出现条数和响应生成耗时。HEAD 不记录。日志及可选自定义指标不包含 CDN 命中；完整拉取流量以 CDN Requests 为准。重复获取相同文章仍算多次请求，文章条数也不是去重文章数。

#### 可选：Observability Custom Metrics

默认不开启付费扩展。仅在团队已具备 **Observability Plus / Custom Metrics** 权益时设置 `RSS_CUSTOM_METRICS_ENABLED=true` 并重新部署：

| 指标 | 聚合方式 | 含义 |
| --- | --- | --- |
| `rss.origin_requests` | `sum` | 源站处理的 RSS GET 次数，含失败 |
| `rss.origin_duration_ms` | `avg` / `p95` | 源站响应生成耗时，不是客户端完整下载耗时 |
| `rss.origin_content_responses` | `sum` | 源站成功生成非空 RSS 的次数 |
| `rss.origin_item_appearances` | `sum` | 源站成功非空响应中累计出现的文章条数（含重复） |

指标标签为 `feed`、`reader`、`status_class`，不包含用户标识、请求 ID 或任意 URL。SDK 的 `metric()` 在不支持的运行环境中不采集；需部署到 Vercel 并命中源站后才可验证入库。本地通过只能证明埋点调用正确。每次源站请求最多额外上报 4 个指标点，每个点计入 Observability 事件；未开启自定义指标时仍可查看 CDN Requests 和日志。

```bash
# 部署后先调用 RSS 接口产生源站请求，再查看可用指标及标签
vercel metrics schema rss.origin_requests
vercel metrics rss.origin_requests -a sum --group-by feed --since 24h
vercel metrics rss.origin_duration_ms -a p95 --since 24h
```

#### 上线与查看

1. 在项目 Web Analytics 页面确认已启用采集，然后部署包含 `@vercel/analytics` 的代码。当前项目为 Pro，网页自定义事件能力由套餐提供；不自动升级订阅。
2. 打开公开首页，复制一次订阅地址；在 Analytics → Events 查看 `rss_subscription_copy`，对比 `aggregate` 和 `single`，以及各源 ID。
3. 在 Observability → CDN Requests 选择 Production 和相同时间范围，查看 RSS 路由，区分 2xx、3xx、4xx、5xx；不要把 `/api/cron` 算作用户拉取。Vercel Functions 次数不等于全部 RSS 请求次数。
4. 在 Logs 搜索 `rss_origin_response` 检查源站情况；已有 Cron 运行日志继续用于后台故障排查。
5. 按界面展示的时区与时间范围解读每日数据；可用历史范围、细分查询、告警和保留期限依赖套餐。未开启 Plus 时，不承诺跨月自定义查询。旧的网页访问和复制行为无法补录。

参考：[Web Analytics 接入](https://vercel.com/docs/analytics/quickstart)、[自定义事件](https://vercel.com/docs/analytics/custom-events)、[Observability](https://vercel.com/docs/observability)、[Functions metric API](https://vercel.com/docs/functions/functions-api-reference/vercel-functions-package#metric)。

状态接口返回各批次上次运行、近期 48 次运行记录、源抓取错误、任务积压、失败阶段、分块进度、重试时间以及实际 API/token 统计。未初始化、超过 8 小时没有成功发现文章、配置降级、源抓取失败或任务失败时返回 503，健康时返回 200。Vercel 结构化运行日志也记录源错误和批次结果，可供现有告警系统采集。

失败任务持续按指数退避重试，最长间隔 24 小时。已经完成的分块保留；单轮执行期限导致的暂停不算作翻译失败。调度使用 UTC，见 `vercel.json`。

MiniMax 的 `input/output new_sensitive (1026/1027)` 即使通过 HTTP 500 返回，也标记为 `provider_content_policy`，不立即重复调用，至少等待 24 小时。原文和已有翻译分块保留；该错误需要单独处理，不表示文章已经成功发布。

`scripts/retry-failed-jobs.ts` 默认只读检查失败任务；显式 `--write --snapshot=/absolute/path.json` 才重试快照选中的任务，写入前自动备份，并复用批次/文章租约及完整性校验。`--rounds=N` 可续跑长文；发生新错误后本次脚本停止重试该文章。脚本要求模型配置与线上任务 profile 一致，避免本地旧环境变量使检查点被重置。

## 本地开发和验证

```bash
npm ci
cp .env.example .env.local
npm run dev

npm test
npm run lint
npm run check
```

项目锁文件与 `.npmrc` 固定安装行为，Vercel 使用 `npm ci` 安装并执行 `npm run check`；两条命令均先移除不受 npm 支持的 `npm_config_cache_dir` / `NPM_CONFIG_CACHE_DIR` 环境变量，避免重复配置警告。`package.json` 的 `allowScripts` 仅许可已检查的 `unrs-resolver@1.11.1` 安装脚本；升级该依赖时需重新核对。测试启动时会清除继承的生产凭据，避免云端构建测试误写生产数据。

真实集成验证需先获准临时读取生产环境变量，完成后删除临时文件：

```bash
node --env-file=.env.production.local scripts/verify-blob-cas.ts
node --env-file=.env.production.local scripts/benchmark-translator.ts
```

前者使用独立临时路径验证真实条件冲突和租约并清理探针。后者对现有模型执行小规模完整性/耗时/token 验证，保留代码与链接，并清理测试检查点；报告保存在 `/tmp/rss-translation-smoke.json`。单个样本不能证明某模型是所有模型中的最优选择。

## 迁移、修复和回滚

```bash
# 先备份旧文档，再仅创建尚不存在的私有副本；公开存档保持不变。
node --env-file=.env.production.local scripts/migrate-state.ts

# 默认仅检查；显式 --write 才重建聚合索引，并强制先备份。
node --env-file=.env.production.local scripts/rebuild-recent-index.ts
node --env-file=.env.production.local scripts/rebuild-recent-index.ts --write --backup-dir /tmp/rss-index-backup
```

首次迁移清理了私有副本中的重复 GUID，备份位于 `/tmp/rss-state-migration-backup/`。这类本机临时备份不会跟随部署上传；需要长期保存时应另行归档。过去已被旧版 100 条上限挤出的文章无法仅凭现有存档恢复。

回滚前应先停用新增工作 Cron，确认没有新 worker 在运行，再回退应用。旧版仅认识公开存档，回退后不会看到私有存储中新完成的译文；私有数据仍保留，恢复新版后可继续使用。不要清空私有存储作为回滚手段。
