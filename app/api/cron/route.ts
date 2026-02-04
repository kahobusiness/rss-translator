import { NextRequest, NextResponse } from 'next/server';
import { getEnabledFeeds } from '@/config/feeds';
import { parseFeed } from '@/lib/rss-parser';
import { translateContent } from '@/lib/translator';
import { appendItems, getExistingGuids, TranslatedItem } from '@/lib/storage';

// Vercel Cron需要的配置
export const maxDuration = 300; // 5分钟最大执行时间
export const dynamic = 'force-dynamic';

async function processFeed(feedConfig: { id: string; name: string; url: string }) {
  console.log(`Processing feed: ${feedConfig.name}`);

  try {
    // 解析RSS源
    const feed = await parseFeed(feedConfig.url);

    // 获取已翻译的文章guid，避免重复翻译
    const existingGuids = await getExistingGuids(feedConfig.id);

    // 过滤出新文章（只处理最近10篇新文章）
    const newItems = feed.items
      .filter(item => !existingGuids.has(item.guid))
      .slice(0, 10);

    if (newItems.length === 0) {
      console.log(`No new items for ${feedConfig.name}`);
      return { feedId: feedConfig.id, processed: 0 };
    }

    console.log(`Found ${newItems.length} new items for ${feedConfig.name}`);

    // 翻译新文章
    const translatedItems: TranslatedItem[] = [];

    for (const item of newItems) {
      try {
        const translation = await translateContent(item.title, item.content);

        translatedItems.push({
          guid: item.guid,
          originalTitle: item.title,
          translatedTitle: translation.translatedTitle,
          originalContent: item.content,
          translatedContent: translation.translatedContent,
          link: item.link,
          pubDate: item.pubDate,
          author: item.author,
          categories: item.categories,
          translatedAt: new Date().toISOString(),
        });

        // 添加延迟避免API限制
        await new Promise(resolve => setTimeout(resolve, 500));
      } catch (error) {
        console.error(`Error translating item "${item.title}":`, error);
      }
    }

    // 保存翻译结果
    if (translatedItems.length > 0) {
      await appendItems(
        feedConfig.id,
        feed.title,
        feed.description,
        feed.link,
        translatedItems
      );
    }

    return { feedId: feedConfig.id, processed: translatedItems.length };
  } catch (error) {
    console.error(`Error processing feed ${feedConfig.name}:`, error);
    return { feedId: feedConfig.id, processed: 0, error: String(error) };
  }
}

export async function GET(request: NextRequest) {
  // 验证Cron密钥（可选但推荐）
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  console.log('Starting cron job...');

  const feeds = getEnabledFeeds();
  const results = [];

  // 顺序处理每个feed（避免并发过多API调用）
  for (const feed of feeds) {
    const result = await processFeed(feed);
    results.push(result);
  }

  console.log('Cron job completed:', results);

  return NextResponse.json({
    success: true,
    timestamp: new Date().toISOString(),
    results,
  });
}
