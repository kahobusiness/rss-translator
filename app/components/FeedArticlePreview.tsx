import Link from 'next/link';
import { loadFeed } from '@/lib/storage';
import { latestTranslation, articleExcerpt, articleDate } from '@/lib/article-preview';
import styles from '../page.module.css';

export async function FeedArticlePreview({ feedId }: { feedId: string }) {
  let article;
  try {
    article = latestTranslation((await loadFeed(feedId))?.items || []);
  } catch (error) {
    console.error('Article preview unavailable:', feedId, error instanceof Error ? error.message : 'Storage error');
    return <p className={styles.articleEmpty}>译文暂时无法加载，请稍后再试。</p>;
  }
  if (!article) return <p className={styles.articleEmpty}>暂无译文，翻译完成后会在这里展示。</p>;
  const date = articleDate(article.pubDate);
  const path = `/read/${feedId}?guid=${encodeURIComponent(article.guid)}`;
  return (
    <div className={styles.articlePreview}>
      <div className={styles.articleMeta}>
        <span>最新译文</span>
        {date && <time dateTime={article.pubDate}>{date}</time>}
      </div>
      <h4 className={styles.articleTitle}><Link href={path}>{article.translatedTitle}</Link></h4>
      <p className={styles.articleExcerpt}>{articleExcerpt(article.translatedContent)}</p>
      <Link className={styles.readLink} href={path}>阅读全文 <span aria-hidden="true">→</span></Link>
    </div>
  );
}
