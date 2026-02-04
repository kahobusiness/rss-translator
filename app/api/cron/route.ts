import { NextRequest, NextResponse } from 'next/server';
import { getEnabledFeeds, FeedConfig } from '@/config/feeds';
import { parseFeed } from '@/lib/rss-parser';
import { translateContent } from '@/lib/translator';
import { appendItems, getExistingGuids, TranslatedItem } from '@/lib/storage';

// Vercel Cron需要的配置
export const maxDuration = 300; // 5分钟最大执行时间
export const dynamic = 'force-dynamic';

async function processFeed(feedConfig: FeedConfig) {
  console.log(`Processing feed: ${feedConfig.name}`);

  try {
    // 解析RSS源
    const feed = await parseFeed(feedConfig.url);

    // 获取已翻译的文章guid，避免重复翻译
    const existingGuids = await getExistingGuids(feedConfig.id);

    // 过滤出新文章（只处理最近5篇新文章，因为源很多）
    const newItems = feed.items
      .filter(item => !existingGuids.has(item.guid))
      .slice(0, 5);

    if (newItems.length === 0) {
      console.log(`No new items for ${feedConfig.name}`);
      return { feedId: feedConfig.id, feedName: feedConfig.name, processed: 0 };
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
          sourceFeedId: feedConfig.id,
          sourceFeedName: feedConfig.name,
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

    return { feedId: feedConfig.id, feedName: feedConfig.name, processed: translatedItems.length };
  } catch (error) {
    console.error(`Error processing feed ${feedConfig.name}:`, error);
    return { feedId: feedConfig.id, feedName: feedConfig.name, processed: 0, error: String(error) };
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

  const feeds = await getEnabledFeeds();
  const results = [];
  let totalProcessed = 0;

  // 处理每个feed（限制并发以避免过多API调用）
  // 由于源很多，每次只处理一部分
  const batchSize = 10;
  const maxFeeds = 30; // 每次最多处理30个源
  const feedsToProcess = feeds.slice(0, maxFeeds);

  for (let i = 0; i < feedsToProcess.length; i += batchSize) {
    const batch = feedsToProcess.slice(i, i + batchSize);

    // 并行处理这一批
    const batchResults = await Promise.all(
      batch.map(feed => processFeed(feed).catch(err => ({
        feedId: feed.id,
        feedName: feed.name,
        processed: 0,
        error: String(err),
      })))
    );

    results.push(...batchResults);
    totalProcessed += batchResults.reduce((sum, r) => sum + r.processed, 0);

    // 批次间添加小延迟
    if (i + batchSize < feedsToProcess.length) {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }

  console.log(`Cron job completed. Total processed: ${totalProcessed}`);

  return NextResponse.json({
    success: true,
    timestamp: new Date().toISOString(),
    totalFeeds: feeds.length,
    processedFeeds: feedsToProcess.length,
    totalItems: totalProcessed,
    results,
  });
}
