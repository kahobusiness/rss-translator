import { getEnabledFeeds } from '@/config/feeds';
import { CopyButton } from './components/CopyButton';
import styles from './page.module.css';
import { MODEL_NAME } from '@/lib/model-config';

export const dynamic = 'force-dynamic';

const FEED_CATEGORIES: Record<string, string[]> = {
  'AI 与深度思考': [
    'simonwillison-net',
    'dwarkesh-com',
    'gwern-net',
    'garymarcus-substack-com',
    'wheresyoured-at',
  ],
  '系统与工程实践': [
    'antirez-com',
    'rachelbythebay-com',
    'lucumr-pocoo-org',
    'mitchellh-com',
  ],
  '科技行业与文化': [
    'daringfireball-net',
    'construction-physics-com',
    'paulgraham-com',
    'pluralistic-net',
    'anildash-com',
    'tedium-co',
  ],
  安全: ['krebsonsecurity-com', 'troyhunt-com', 'lcamtuf-substack-com'],
  '硬件与底层': ['righto-com', 'fabiensanglard-net'],
};

const AGGREGATE_PATH = '/api/feed/all';

const API_ROUTES: Array<[string, string]> = [
  [AGGREGATE_PATH, '聚合所有源的翻译 RSS（推荐订阅）'],
  ['/api/feed/[id]', '单个源的翻译 RSS'],
  ['/api/feeds', '可用源列表（JSON）'],
];

export default async function Home() {
  const feeds = await getEnabledFeeds();
  const feedMap = new Map(feeds.map((f) => [f.id, f]));

  return (
    <main className={styles.main}>
      <header className={styles.header}>
        <p className={styles.eyebrow}>RSS · 中文翻译</p>
        <h1 className={styles.title}>精选英文技术博客，译成中文。</h1>
        <p className={styles.subtitle}>
          {feeds.length} 个信源，每 6 小时自动更新，由 {MODEL_NAME} 翻译。
        </p>
      </header>

      <section className={styles.subscribeCard}>
        <p className={styles.subscribeLabel}>聚合订阅（推荐）</p>
        <div className={styles.subscribeRow}>
          <code className={styles.subscribeUrl}>{AGGREGATE_PATH}</code>
          <CopyButton path={AGGREGATE_PATH} />
        </div>
        <p className={styles.subscribeHint}>
          在 Reeder、NetNewsWire 等阅读器中订阅此地址，即可获取所有源的翻译内容。
        </p>
      </section>

      <section>
        <div className={styles.sectionHeader}>
          <h2 className={styles.sectionTitle}>信源</h2>
          <p className={styles.sectionDesc}>
            从 HN Popular Blogs 2025 中精选，覆盖 AI、系统、科技、安全、硬件 5 个领域。
          </p>
        </div>

        {Object.entries(FEED_CATEGORIES).map(([category, ids]) => {
          const categoryFeeds = ids
            .map((id) => feedMap.get(id))
            .filter((f): f is NonNullable<typeof f> => !!f);
          if (categoryFeeds.length === 0) return null;

          return (
            <div key={category} className={styles.category}>
              <h3 className={styles.categoryTitle}>
                <span>{category}</span>
                <span className={styles.categoryCount}>
                  {categoryFeeds.length}
                </span>
              </h3>
              <div className={styles.feedList}>
                {categoryFeeds.map((feed) => (
                  <div key={feed.id} className={styles.feedItem}>
                    <div className={styles.feedMeta}>
                      <span className={styles.feedName}>{feed.name}</span>
                      {feed.htmlUrl && (
                        <a
                          href={feed.htmlUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className={styles.feedLink}
                        >
                          {feed.htmlUrl.replace(/^https?:\/\//, '')}
                        </a>
                      )}
                    </div>
                    <code className={styles.feedPath}>/api/feed/{feed.id}</code>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </section>

      <section>
        <div className={styles.sectionHeader}>
          <h2 className={styles.sectionTitle}>API</h2>
        </div>
        <table className={styles.apiTable}>
          <tbody>
            {API_ROUTES.map(([path, desc]) => (
              <tr key={path}>
                <td className={styles.apiPath}>{path}</td>
                <td className={styles.apiDesc}>{desc}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </main>
  );
}
