import { NextRequest, NextResponse } from 'next/server';
import { Feed } from 'feed';
import { loadFeed } from '@/lib/storage';
import { getFeedConfig } from '@/config/feeds';
import { escapeHtml, stripHtmlTags } from '@/lib/utils';

export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  // 检查feed配置是否存在
  const feedConfig = await getFeedConfig(id);
  if (!feedConfig) {
    return NextResponse.json({ error: 'Feed not found' }, { status: 404 });
  }

  // 加载翻译后的数据
  const storedFeed = await loadFeed(id);

  if (!storedFeed || storedFeed.items.length === 0) {
    return NextResponse.json(
      { error: 'No translated content available yet. The feed will be populated after the next cron job runs.' },
      { status: 404 }
    );
  }

  // 构建RSS feed
  const baseUrl = process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : 'http://localhost:3000';

  const feed = new Feed({
    title: `${storedFeed.feedTitle} (中文翻译)`,
    description: storedFeed.feedDescription || `${feedConfig.name} 的中文翻译版本`,
    id: `${baseUrl}/api/feed/${id}`,
    link: `${baseUrl}/api/feed/${id}`,
    language: 'zh-CN',
    updated: new Date(storedFeed.lastUpdated),
    generator: 'RSS Translator',
    copyright: `Original content from ${storedFeed.feedLink || feedConfig.url}`,
    feedLinks: {
      rss2: `${baseUrl}/api/feed/${id}`,
    },
  });

  // 添加文章
  for (const item of storedFeed.items) {
    const safeDescription = stripHtmlTags(item.translatedContent).substring(0, 500) + '...';

    feed.addItem({
      title: item.translatedTitle,
      id: item.guid,
      link: item.link,
      description: safeDescription,
      content: `
        <div style="margin-bottom: 10px;">
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
      category: item.categories?.map(cat => ({ name: cat })),
    });
  }

  // 返回RSS XML
  const rssXml = feed.rss2();

  return new NextResponse(rssXml, {
    headers: {
      'Content-Type': 'application/rss+xml; charset=utf-8',
      'Cache-Control': 'public, max-age=300, s-maxage=300',
    },
  });
}
