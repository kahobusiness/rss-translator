import { getEnabledFeeds } from '@/config/feeds';

export default function Home() {
  const feeds = getEnabledFeeds();

  return (
    <main style={{ padding: '2rem', fontFamily: 'system-ui, sans-serif', maxWidth: '800px', margin: '0 auto' }}>
      <h1>RSS Translator</h1>
      <p>将RSS订阅源自动翻译成中文，使用Claude AI进行高质量翻译。</p>

      <h2>可用的翻译订阅源</h2>
      <p>在你的RSS阅读器（如Reeder）中添加以下链接：</p>

      <ul style={{ listStyle: 'none', padding: 0 }}>
        {feeds.map(feed => (
          <li key={feed.id} style={{ marginBottom: '1rem', padding: '1rem', border: '1px solid #ddd', borderRadius: '8px' }}>
            <strong>{feed.name}</strong>
            <br />
            <code style={{ background: '#f5f5f5', padding: '0.25rem 0.5rem', borderRadius: '4px', fontSize: '0.9rem' }}>
              /api/feed/{feed.id}
            </code>
            <br />
            <small style={{ color: '#666' }}>原始源: {feed.url}</small>
          </li>
        ))}
      </ul>

      <h2>API端点</h2>
      <ul>
        <li><code>/api/feeds</code> - 查看所有可用的翻译源列表</li>
        <li><code>/api/feed/[id]</code> - 获取特定源的翻译RSS</li>
        <li><code>/api/cron</code> - 触发更新（由Vercel Cron自动调用）</li>
      </ul>

      <h2>使用说明</h2>
      <ol>
        <li>部署到Vercel后，复制你的域名</li>
        <li>在Reeder或其他RSS阅读器中添加订阅</li>
        <li>例如: <code>https://your-domain.vercel.app/api/feed/hacker-news</code></li>
      </ol>
    </main>
  );
}
