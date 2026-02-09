import { getEnabledFeeds } from '@/config/feeds';

export const revalidate = 3600;

// 信源分类映射
const FEED_CATEGORIES: Record<string, string[]> = {
  'AI 与产品趋势': [
    'simonwillison-net', 'garymarcus-substack-com', 'mitchellh-com',
    'paulgraham-com', 'steveblank-com', 'ericmigi-com', 'dwarkesh-com', 'geohot-github-io',
  ],
  '科技行业与文化': [
    'daringfireball-net', 'pluralistic-net', 'wheresyoured-at',
    'anildash-com', 'construction-physics-com',
  ],
  '系统与工程实践': [
    'antirez-com', 'rachelbythebay-com', 'lucumr-pocoo-org',
    'overreacted-io', 'buttondown-com-hillelwayne', 'devblogs-microsoft-com-oldnewthing',
  ],
  '安全': [
    'krebsonsecurity-com', 'troyhunt-com', 'lcamtuf-substack-com',
  ],
  '硬件与底层': [
    'righto-com', 'xania-org', 'berthub-eu',
  ],
  '科学 / 数学 / 复古': [
    'gwern-net', 'johndcook-com', 'fabiensanglard-net',
  ],
  '行业分析': [
    'derekthompson-org', 'dynomight-net',
  ],
};

export default async function Home() {
  const feeds = await getEnabledFeeds();
  const feedMap = new Map(feeds.map(f => [f.id, f]));

  return (
    <main style={{ padding: '2rem', fontFamily: 'system-ui, sans-serif', maxWidth: '900px', margin: '0 auto' }}>
      <h1 style={{ marginBottom: '0.5rem' }}>RSS Translator</h1>
      <p style={{ color: '#555', marginTop: 0 }}>
        精选 {feeds.length} 个英文技术博客，使用 Claude AI 自动翻译成中文。每 6 小时更新。
      </p>

      <div style={{ background: '#e8f5e9', padding: '1rem', borderRadius: '8px', marginBottom: '2rem' }}>
        <h3 style={{ margin: '0 0 0.5rem 0' }}>订阅地址</h3>
        <p style={{ margin: 0 }}>
          <strong>聚合订阅（推荐）：</strong>
          <code style={{ background: '#fff', padding: '0.25rem 0.5rem', borderRadius: '4px', marginLeft: '0.5rem' }}>
            /api/feed/all
          </code>
        </p>
        <p style={{ margin: '0.5rem 0 0 0', fontSize: '0.9rem', color: '#666' }}>
          在 Reeder 等 RSS 阅读器中订阅此地址，即可获取所有源的翻译内容。
        </p>
      </div>

      <h2>精选信源</h2>
      <p style={{ fontSize: '0.9rem', color: '#666', marginBottom: '1.5rem' }}>
        从 HN Popular Blogs 2025 中精选，覆盖 AI、安全、系统、创业等 7 个领域。
      </p>

      {Object.entries(FEED_CATEGORIES).map(([category, ids]) => {
        const categoryFeeds = ids.map(id => feedMap.get(id)).filter(Boolean);
        if (categoryFeeds.length === 0) return null;

        return (
          <div key={category} style={{ marginBottom: '1.5rem' }}>
            <h3 style={{ fontSize: '1rem', color: '#333', marginBottom: '0.5rem', borderBottom: '1px solid #eee', paddingBottom: '0.25rem' }}>
              {category}
              <span style={{ fontWeight: 'normal', color: '#999', fontSize: '0.85rem', marginLeft: '0.5rem' }}>
                ({categoryFeeds.length})
              </span>
            </h3>
            <div style={{ display: 'grid', gap: '0.5rem' }}>
              {categoryFeeds.map(feed => feed && (
                <div key={feed.id} style={{ padding: '0.5rem 0.75rem', background: '#f9f9f9', borderRadius: '6px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.25rem' }}>
                  <div>
                    <strong style={{ fontSize: '0.95rem' }}>{feed.name}</strong>
                    {feed.htmlUrl && (
                      <a href={feed.htmlUrl} target="_blank" rel="noopener noreferrer"
                        style={{ color: '#999', fontSize: '0.8rem', marginLeft: '0.5rem', textDecoration: 'none' }}>
                        {feed.htmlUrl.replace(/^https?:\/\//, '')}
                      </a>
                    )}
                  </div>
                  <code style={{ background: '#fff', padding: '0.1rem 0.4rem', borderRadius: '4px', fontSize: '0.8rem', color: '#666' }}>
                    /api/feed/{feed.id}
                  </code>
                </div>
              ))}
            </div>
          </div>
        );
      })}

      <h2>API</h2>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
        <tbody>
          {[
            ['/api/feed/all', '聚合所有源的翻译 RSS（推荐订阅）'],
            ['/api/feed/[id]', '单个源的翻译 RSS'],
            ['/api/feeds', '可用源列表（JSON）'],
          ].map(([path, desc]) => (
            <tr key={path} style={{ borderBottom: '1px solid #eee' }}>
              <td style={{ padding: '0.5rem 0', fontFamily: 'monospace' }}>{path}</td>
              <td style={{ padding: '0.5rem 0', color: '#666' }}>{desc}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div style={{ marginTop: '2rem', padding: '1rem', background: '#f5f5f5', borderRadius: '8px', fontSize: '0.85rem', color: '#888' }}>
        <p style={{ margin: '0 0 0.5rem 0' }}>
          <strong>工作原理：</strong>每 6 小时通过 Vercel Cron 自动抓取新文章，使用 Claude AI 翻译后存入 Vercel Blob。
          翻译失败的文章会在下次运行时自动重试。
        </p>
        <p style={{ margin: 0 }}>
          Powered by Claude AI &middot; Deployed on Vercel &middot; <a href="https://github.com" style={{ color: '#888' }}>GitHub</a>
        </p>
      </div>
    </main>
  );
}
