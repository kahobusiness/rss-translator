# RSS Translator

将RSS订阅源自动翻译成中文的服务，使用Claude AI进行高质量翻译，部署在Vercel上。

## 功能

- 定时从配置的RSS源获取最新内容
- 使用Claude API将内容翻译成中文
- 生成标准RSS格式输出，可在任何RSS阅读器中订阅
- 支持多个RSS源独立管理

## 部署步骤

### 1. Fork或克隆此项目

### 2. 在Vercel上部署

1. 访问 [Vercel](https://vercel.com) 并导入此项目
2. 配置环境变量:
   - `ANTHROPIC_API_KEY`: 你的Anthropic API密钥
   - `CRON_SECRET`: (可选) 保护cron端点的密钥

### 3. 配置RSS源

编辑 `config/feeds.ts` 文件，添加你想要翻译的RSS源:

```typescript
export const feedConfigs: FeedConfig[] = [
  {
    id: 'my-feed',
    name: 'My Feed Name',
    url: 'https://example.com/feed.xml',
    enabled: true,
  },
];
```

## 使用方法

部署完成后，在你的RSS阅读器（如Reeder）中添加以下格式的订阅地址:

```
https://your-domain.vercel.app/api/feed/{feed-id}
```

例如:
- `https://your-domain.vercel.app/api/feed/hacker-news`
- `https://your-domain.vercel.app/api/feed/techcrunch`

## API端点

| 端点 | 描述 |
|------|------|
| `/api/feeds` | 获取所有可用的翻译源列表 |
| `/api/feed/[id]` | 获取特定源的翻译后RSS |
| `/api/cron` | 触发内容更新（由Vercel Cron自动调用） |

## 定时更新

默认配置为每6小时自动更新一次（通过Vercel Cron）。

可以在 `vercel.json` 中修改更新频率:

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

## 注意事项

- Vercel免费版的Cron最短间隔为1天，Pro版支持更频繁的调度
- `/tmp`目录在Serverless环境中是临时的，生产环境建议使用Vercel KV或外部数据库持久化存储
- 翻译会消耗Claude API额度，请注意用量

## License

MIT
