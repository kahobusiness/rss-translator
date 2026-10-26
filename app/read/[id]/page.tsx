import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getFeedConfig } from '@/config/feeds';
import { loadFeed } from '@/lib/storage';
import { articleDate, latestTranslation, readableArticleHtml } from '@/lib/article-preview';
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
  const date = articleDate(article.pubDate);
  let originalUrl: string | undefined;
  try { const url = new URL(article.link); if (['http:', 'https:'].includes(url.protocol)) originalUrl = url.href; } catch { /* No original link. */ }
  return (
    <main className={styles.readingMain}>
      <Link href="/" className={styles.backLink}>← 返回全部订阅源</Link>
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
      <footer className={styles.readingFooter}>
        <p>译文由 AI 自动生成，请结合原文阅读。</p>
        <Link href="/" className={styles.readLink}>返回首页，订阅更多博客 →</Link>
      </footer>
    </main>
  );
}
