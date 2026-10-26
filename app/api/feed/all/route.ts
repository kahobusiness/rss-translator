import { Feed } from 'feed';
import { getAllTranslatedItems } from '@/lib/storage';
import { escapeHtml, stripHtmlTags } from '@/lib/utils';
import { getSiteUrl } from '@/lib/site-url';
import { rssResponse } from '@/lib/rss-response';
import { monitoredRss } from '@/lib/monitored-rss';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  return monitoredRss(request, 'all', () => generateFeed(request));
}

async function generateFeed(request: Request) {
  const items = await getAllTranslatedItems(100);

  const baseUrl = getSiteUrl(request);

  const feed = new Feed({
    title: 'RSS Translator - 所有翻译内容',
    description: '聚合所有RSS源的中文翻译内容',
    id: baseUrl,
    link: baseUrl,
    language: 'zh-CN',
    favicon: `${baseUrl}/favicon.ico`,
    copyright: 'RSS Translator',
    updated: items.length > 0 ? new Date(items[0].translatedAt) : new Date(),
    feedLinks: {
      rss2: `${baseUrl}/api/feed/all`,
    },
  });

  for (const item of items.filter(i => i.translated !== false)) {
    // 在标题前添加来源标识
    const titleWithSource = item.sourceFeedName
      ? `[${item.sourceFeedName}] ${item.translatedTitle}`
      : item.translatedTitle;

    const safeDescription = stripHtmlTags(item.translatedContent).substring(0, 500) + '...';

    feed.addItem({
      title: titleWithSource,
      id: item.guid,
      link: item.link,
      description: safeDescription,
      content: `
        <div style="margin-bottom: 20px;">
          <p><strong>来源:</strong> ${escapeHtml(item.sourceFeedName || 'Unknown')}</p>
          <p><strong>原标题:</strong> ${escapeHtml(item.originalTitle)}</p>
        </div>
        <hr/>
        ${item.translatedContent}
        <hr/>
        <details>
          <summary>查看原文</summary>
          ${item.originalContent}
        </details>
      `,
      author: item.author ? [{ name: item.author }] : undefined,
      date: new Date(item.pubDate),
      category: [
        ...(item.categories?.map(c => ({ name: c })) || []),
        { name: item.sourceFeedName || 'Unknown Source' },
      ],
    });
  }

  const rss = feed.rss2();

  return rssResponse(rss, items.filter(i => i.translated !== false).length);
}
