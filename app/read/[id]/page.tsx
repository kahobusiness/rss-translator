import Link from 'next/link';
import { ReturnToFeeds } from '../../components/ReadingNavigation';
import { notFound } from 'next/navigation';
import { getFeedConfig } from '@/config/feeds';
import { loadFeed } from '@/lib/storage';
import { articleDate, latestTranslation, readableArticleHtml, adjacentTranslations } from '@/lib/article-preview';
import styles from '../../page.module.css';

export const dynamic = 'force-dynamic';

export default async function ReadArticle({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ guid?: string | string[] }>;
}) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const config = await getFeedConfig(id);
  if (!config) notFound();
  const feed = await loadFeed(id);
  const article = typeof query.guid === 'string'
    ? feed?.items.find(item => item.guid === query.guid && item.translated !== false)
    : latestTranslation(feed?.items || []);
  if (!article) notFound();
  const { previous, next } = adjacentTranslations(feed?.items || [], article.guid);
  const articlePath = (guid: string) => `/read/${id}?guid=${encodeURIComponent(guid)}`;
  const date = articleDate(article.pubDate);
  let originalUrl: string | undefined;
  try { const url = new URL(article.link); if (['http:', 'https:'].includes(url.protocol)) originalUrl = url.href; } catch { /* No original link. */ }
  return (
    <main className={styles.readingMain}>
      <ReturnToFeeds feedId={id} />
      <article>
        <header className={styles.readingHeader}>
          <div className={styles.articleMeta}>
            <span>{config.name}</span>
            {date && <time dateTime={article.pubDate}>{date}</time>}
          </div>
          <h1 className={styles.readingTitle}>{article.translatedTitle}</h1>
          <p className={styles.originalTitle}>{article.originalTitle}</p>
          {originalUrl && <a className={styles.readLink} href={originalUrl} target="_blank" rel="noopener noreferrer">查看原文 ↗</a>}
        </header>
        <div className={styles.readingBody}
          dangerouslySetInnerHTML={{ __html: readableArticleHtml(article.translatedContent, article.link) }} />
      </article>
      <nav className={styles.articleNavigation} aria-label="文章翻页">
        {previous ? (
          <Link className={styles.articleNavLink} href={articlePath(previous.guid)}>
            <span className={styles.articleNavLabel}>← 上一篇</span>
            <span>{previous.translatedTitle}</span>
          </Link>
        ) : <div className={styles.articleNavEmpty}>已是最新一篇</div>}
        {next ? (
          <Link className={`${styles.articleNavLink} ${styles.articleNavNext}`} href={articlePath(next.guid)}>
            <span className={styles.articleNavLabel}>下一篇 →</span>
            <span>{next.translatedTitle}</span>
          </Link>
        ) : <div className={`${styles.articleNavEmpty} ${styles.articleNavNext}`}>已是最早一篇</div>}
      </nav>
    </main>
  );
}
