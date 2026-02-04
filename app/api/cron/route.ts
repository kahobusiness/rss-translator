import { NextRequest, NextResponse } from 'next/server';
import { getEnabledFeeds, FeedConfig } from '@/config/feeds';
import { parseFeed } from '@/lib/rss-parser';
import { translateContent } from '@/lib/translator';
import { appendItems, getExistingGuids, TranslatedItem } from '@/lib/storage';

// Vercel Cron需要的配置
export const maxDuration = 300; // Pro 版最大 300 秒
export const dynamic = 'force-dynamic';

// 每批处理的 feed 数量（Pro 版可以处理更多）
const FEEDS_PER_BATCH = 15;
// 每个 feed 最多翻译的文章数
const MAX_ITEMS_PER_FEED = 3;

async function processFeed(feedConfig: FeedConfig) {
  console.log(`Processing feed: ${feedConfig.name}`);

  try {
    // 解析RSS源
    const feed = await parseFeed(feedConfig.url);

    // 获取已翻译的文章guid，避免重复翻译
    const existingGuids = await getExistingGuids(feedConfig.id);

    // 过滤出新文章
    const newItems = feed.items
      .filter(item => !existingGuids.has(item.guid))
      .slice(0, MAX_ITEMS_PER_FEED);

    if (newItems.length === 0) {
      console.log(`No new items for ${feedConfig.name}`);
      return { feedId: feedConfig.id, feedName: feedConfig.name, processed: 0 };
    }

    console.log(`Found ${newItems.length} new items for ${feedConfig.name}`);

    // 顺序翻译新文章（避免并发过多）
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

  // 获取批次参数
  const { searchParams } = new URL(request.url);
  const batchParam = searchParams.get('batch');
  const batch = batchParam !== null ? parseInt(batchParam, 10) : 0;

  console.log(`Starting cron job, batch ${batch}...`);

  const feeds = await getEnabledFeeds();
  const totalBatches = Math.ceil(feeds.length / FEEDS_PER_BATCH);

  // 计算当前批次要处理的 feeds
  const startIndex = batch * FEEDS_PER_BATCH;
  const endIndex = Math.min(startIndex + FEEDS_PER_BATCH, feeds.length);
  const feedsToProcess = feeds.slice(startIndex, endIndex);

  if (feedsToProcess.length === 0) {
    return NextResponse.json({
      success: true,
      message: `Batch ${batch} is empty. Total batches: ${totalBatches}`,
      batch,
      totalBatches,
      totalFeeds: feeds.length,
    });
  }

  const results = [];
  let totalProcessed = 0;

  // 顺序处理每个 feed（避免超时）
  for (const feed of feedsToProcess) {
    const result = await processFeed(feed).catch(err => ({
      feedId: feed.id,
      feedName: feed.name,
      processed: 0,
      error: String(err),
    }));
    results.push(result);
    totalProcessed += result.processed;
  }

  console.log(`Batch ${batch} completed. Processed: ${totalProcessed} items`);

  const nextBatch = batch + 1 < totalBatches ? batch + 1 : null;

  return NextResponse.json({
    success: true,
    timestamp: new Date().toISOString(),
    batch,
    totalBatches,
    nextBatch,
    totalFeeds: feeds.length,
    processedFeeds: feedsToProcess.length,
    feedRange: `${startIndex + 1}-${endIndex}`,
    totalItems: totalProcessed,
    results,
    // 下一批的 URL（方便连续调用）
    nextBatchUrl: nextBatch !== null ? `/api/cron?batch=${nextBatch}` : null,
  });
}
