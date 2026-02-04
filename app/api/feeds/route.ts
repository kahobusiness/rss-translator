import { NextResponse } from 'next/server';
import { getEnabledFeeds } from '@/config/feeds';

export const dynamic = 'force-dynamic';

export async function GET() {
  const feeds = getEnabledFeeds();

  const baseUrl = process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : 'http://localhost:3000';

  const feedList = feeds.map(feed => ({
    id: feed.id,
    name: feed.name,
    originalUrl: feed.url,
    translatedUrl: `${baseUrl}/api/feed/${feed.id}`,
  }));

  return NextResponse.json({
    feeds: feedList,
    usage: {
      description: '使用translatedUrl在你的RSS阅读器中订阅翻译后的内容',
      example: `${baseUrl}/api/feed/hacker-news`,
    },
  });
}
