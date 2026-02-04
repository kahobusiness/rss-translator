# RSS Translator

将RSS订阅源自动翻译成中文的服务，使用Claude AI进行高质量翻译，部署在Vercel上。

## 功能

- 从OPML文件自动加载RSS源（默认使用 [HN Popular Blogs 2025](https://gist.github.com/emschwartz/e6d2bf860ccc367fe37ff953ba6de66b)）
- 使用Claude API将内容翻译成中文（支持 Zenmux 等第三方平台）
- 支持聚合订阅（所有源合并）和单独订阅
- 翻译后的文章标注原始来源，方便分类阅读
- 生成标准RSS格式输出，兼容Reeder等阅读器

## 部署步骤

### 1. Fork或克隆此项目

### 2. 在Vercel上部署

1. 访问 [Vercel](https://vercel.com) 并导入此项目
2. 配置环境变量（见下方 API 配置说明）

### 3. 订阅翻译内容

部署完成后，在Reeder等RSS阅读器中添加：

**推荐 - 聚合订阅（所有源合并）：**
```
https://your-domain.vercel.app/api/feed/all
```

**单独订阅某个源：**
```
https://your-domain.vercel.app/api/feed/simonwillison-net
https://your-domain.vercel.app/api/feed/paulgraham-com
```

## API 配置

### 使用 Zenmux（推荐）

[Zenmux](https://zenmux.ai) 是一个 Claude API 中转平台，配置方式：

| 环境变量 | 说明 | 示例 |
|---------|------|------|
| `API_KEY` | Zenmux API 密钥（必须） | `zm-xxx...` |
| `API_BASE_URL` | API 地址（可选） | `https://api.zenmux.ai`（默认） |
| `MODEL_NAME` | 模型名称（可选） | `claude-sonnet-4-20250514`（默认） |

### 使用官方 Anthropic API

如果想使用 Claude 官方 API：

| 环境变量 | 说明 |
|---------|------|
| `API_KEY` 或 `ANTHROPIC_API_KEY` | Anthropic API 密钥 |
| `API_BASE_URL` | `https://api.anthropic.com` |

### 其他环境变量

| 环境变量 | 说明 | 必须 |
|---------|------|------|
| `CRON_SECRET` | 保护 cron 端点的密钥 | 可选 |
| `OPML_URL` | 自定义 OPML 源地址 | 可选 |

## API端点

| 端点 | 描述 |
|------|------|
| `/api/feeds` | 获取所有可用的翻译源列表（JSON） |
| `/api/feed/all` | 聚合所有源的翻译RSS（推荐） |
| `/api/feed/[id]` | 获取特定源的翻译RSS |
| `/api/cron` | 触发内容更新（由Vercel Cron自动调用） |

## 自定义RSS源

默认从HN Popular Blogs 2025 OPML加载约90个博客源。你可以通过设置 `OPML_URL` 环境变量使用自己的OPML文件。

OPML文件格式示例：
```xml
<?xml version="1.0" encoding="UTF-8"?>
<opml version="2.0">
  <head><title>My Feeds</title></head>
  <body>
    <outline text="Blogs" title="Blogs">
      <outline type="rss" text="Example Blog" title="Example Blog"
               xmlUrl="https://example.com/feed.xml" htmlUrl="https://example.com"/>
    </outline>
  </body>
</opml>
```

## 定时更新

默认配置为每天自动更新一次（通过Vercel Cron）。

可以在 `vercel.json` 中修改更新频率：

```json
{
  "crons": [
    {
      "path": "/api/cron",
      "schedule": "0 */6 * * *"
    }
  ]
}
```

> 注意：Vercel免费版Cron最短间隔为1天，Pro版支持更频繁的调度。

## 本地开发

```bash
# 安装依赖
npm install

# 复制环境变量文件
cp .env.example .env.local

# 编辑.env.local，填入你的API密钥

# 启动开发服务器
npm run dev
```

## 存储说明

- 当前使用文件系统存储翻译结果
- 开发环境：`./data/` 目录
- 生产环境：`/tmp/rss-data/` 目录（Vercel Serverless临时存储）

> 注意：`/tmp`在Serverless环境中是临时的，函数冷启动后会清空。生产环境建议升级到 Vercel KV 或外部数据库进行持久化存储。

## 翻译说明

- 由于源较多（约90个），每次Cron执行只处理部分源的新文章
- 每个源每次最多翻译5篇新文章
- 翻译会消耗 API 额度，请注意用量

## License

MIT
