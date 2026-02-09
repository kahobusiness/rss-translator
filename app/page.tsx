import { getEnabledFeeds, OPML_URL } from '@/config/feeds';

export const revalidate = 3600;

export default async function Home() {
  const feeds = await getEnabledFeeds();

  return (
    <main style={{ padding: '2rem', fontFamily: 'system-ui, sans-serif', maxWidth: '900px', margin: '0 auto' }}>
      <h1>RSS Translator</h1>
      <p>将RSS订阅源自动翻译成中文，使用Claude AI进行高质量翻译。</p>

      <div style={{ background: '#e8f5e9', padding: '1rem', borderRadius: '8px', marginBottom: '2rem' }}>
        <h3 style={{ margin: '0 0 0.5rem 0' }}>推荐订阅</h3>
        <p style={{ margin: 0 }}>
          <strong>聚合订阅（所有源合并）：</strong>
          <code style={{ background: '#fff', padding: '0.25rem 0.5rem', borderRadius: '4px', marginLeft: '0.5rem' }}>
            /api/feed/all
          </code>
        </p>
        <p style={{ margin: '0.5rem 0 0 0', fontSize: '0.9rem', color: '#666' }}>
          在Reeder中订阅这个地址，即可获取所有源的翻译内容，文章标题会标注来源。
        </p>
      </div>

      <h2>数据来源</h2>
      <p style={{ fontSize: '0.9rem', color: '#666' }}>
        从 <a href={OPML_URL} target="_blank" rel="noopener noreferrer">HN Popular Blogs 2025 OPML</a> 加载，
        共 <strong>{feeds.length}</strong> 个博客源。
      </p>

      <h2>可用的翻译订阅源</h2>
      <p>你也可以单独订阅某个源的翻译内容：</p>

      <div style={{ maxHeight: '400px', overflow: 'auto', border: '1px solid #ddd', borderRadius: '8px', padding: '1rem' }}>
        <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {feeds.slice(0, 50).map(feed => (
            <li key={feed.id} style={{ marginBottom: '0.75rem', padding: '0.75rem', background: '#f9f9f9', borderRadius: '6px' }}>
              <strong>{feed.name}</strong>
              <br />
              <code style={{ background: '#fff', padding: '0.15rem 0.4rem', borderRadius: '4px', fontSize: '0.85rem' }}>
                /api/feed/{feed.id}
              </code>
              {feed.htmlUrl && (
                <>
                  <br />
                  <small style={{ color: '#666' }}>
                    <a href={feed.htmlUrl} target="_blank" rel="noopener noreferrer">{feed.htmlUrl}</a>
                  </small>
                </>
              )}
            </li>
          ))}
          {feeds.length > 50 && (
            <li style={{ textAlign: 'center', color: '#666', padding: '1rem' }}>
              还有 {feeds.length - 50} 个源... 访问 <code>/api/feeds</code> 查看完整列表
            </li>
          )}
        </ul>
      </div>

      <h2>API端点</h2>
      <ul>
        <li><code>/api/feeds</code> - 查看所有可用的翻译源列表（JSON格式）</li>
        <li><code>/api/feed/all</code> - 聚合所有源的翻译RSS（推荐）</li>
        <li><code>/api/feed/[id]</code> - 获取特定源的翻译RSS</li>
        <li><code>/api/cron</code> - 触发更新（由Vercel Cron自动调用）</li>
      </ul>

      <h2>使用说明</h2>
      <ol>
        <li>部署到Vercel后，复制你的域名</li>
        <li>在Reeder或其他RSS阅读器中添加订阅</li>
        <li>推荐: <code>https://your-domain.vercel.app/api/feed/all</code></li>
        <li>或单独订阅: <code>https://your-domain.vercel.app/api/feed/simonwillison-net</code></li>
      </ol>

      <h2>注意事项</h2>
      <ul style={{ color: '#666', fontSize: '0.9rem' }}>
        <li>翻译内容会在Cron任务执行后逐步填充</li>
        <li>由于源较多，每次Cron只处理部分源的新文章</li>
        <li>Vercel免费版Cron最短间隔为1天，Pro版支持更频繁调度</li>
        <li>建议配置 <code>ANTHROPIC_API_KEY</code> 环境变量</li>
      </ul>
    </main>
  );
}
