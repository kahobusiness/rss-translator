import { NextResponse } from 'next/server';
import { Feed } from 'feed';
import { getAllTranslatedItems } from '@/lib/storage';

export const dynamic = 'force-dynamic';

export async function GET() {
  const items = await getAllTranslatedItems(100);

  const baseUrl = process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : 'http://localhost:3000';

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

  for (const item of items) {
    // 在标题前添加来源标识
    const titleWithSource = item.sourceFeedName
      ? `[${item.sourceFeedName}] ${item.translatedTitle}`
      : item.translatedTitle;

    feed.addItem({
      title: titleWithSource,
      id: item.guid,
      link: item.link,
      description: item.translatedContent.substring(0, 500) + '...',
      content: `
        <div style="margin-bottom: 20px;">
          <p><strong>来源:</strong> ${item.sourceFeedName || 'Unknown'}</p>
          <p><strong>原标题:</strong> ${item.originalTitle}</p>
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

  return new NextResponse(rss, {
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': 'public, max-age=300, s-maxage=300',
    },
  });
}
