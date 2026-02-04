import { NextResponse } from 'next/server';
import { getEnabledFeeds, OPML_URL } from '@/config/feeds';

export const dynamic = 'force-dynamic';

export async function GET() {
  const feeds = await getEnabledFeeds();

  const baseUrl = process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : 'http://localhost:3000';

  const feedList = feeds.map(feed => ({
    id: feed.id,
    name: feed.name,
    originalUrl: feed.url,
    htmlUrl: feed.htmlUrl,
    translatedUrl: `${baseUrl}/api/feed/${feed.id}`,
  }));

  return NextResponse.json({
    opmlSource: OPML_URL,
    totalFeeds: feeds.length,
    aggregatedFeed: {
      description: '订阅所有源的聚合翻译内容（推荐）',
      url: `${baseUrl}/api/feed/all`,
    },
    feeds: feedList,
    usage: {
      description: '使用translatedUrl在你的RSS阅读器中订阅翻译后的内容',
      aggregated: `${baseUrl}/api/feed/all - 所有源的聚合翻译`,
      individual: `${baseUrl}/api/feed/{feed-id} - 单个源的翻译`,
    },
  });
}
