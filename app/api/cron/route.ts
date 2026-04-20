import { NextRequest, NextResponse } from 'next/server';
import { getEnabledFeeds, FeedConfig } from '@/config/feeds';
import { parseFeed, ParsedItem } from '@/lib/rss-parser';
import { translateBatch, TranslationInput } from '@/lib/translator';
import { appendItems, getExistingGuids, saveRecentIndex, TranslatedItem } from '@/lib/storage';
import { needsFetch, fetchArticleContent } from '@/lib/article-fetcher';

// Vercel Cron需要的配置
export const maxDuration = 300; // Pro 版最大 300 秒
export const dynamic = 'force-dynamic';

// 每批处理的 feed 数量（减少到 5 以确保在 300s 内完成）
const FEEDS_PER_BATCH = 5;
// 每个 feed 最多翻译的文章数（降到 2 以适配长文 feed 在 300s 内完成）
const MAX_ITEMS_PER_FEED = 2;

interface FeedWithItems {
  config: FeedConfig;
  feedTitle: string;
  feedDescription?: string;
  feedLink?: string;
  items: ParsedItem[];
}

export async function GET(request: NextRequest) {
  // 验证Cron密钥
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // 获取批次参数
  const { searchParams } = new URL(request.url);
  const batchParam = searchParams.get('batch');
  const batch = batchParam !== null ? parseInt(batchParam, 10) : 0;
  // dryRun=1 时只跑翻译流程，不写 Blob，结果直接回包，便于在 preview 验证
  const dryRun = searchParams.get('dryRun') === '1';

  const startTime = Date.now();
  // 220s deadline（300s 限制 - 80s 缓冲：RSS 抓取 + 在飞 abort 收尾 + 保存）
  const deadline = startTime + 220 * 1000;

  console.log(`Starting cron job, batch ${batch}...`);

  const feeds = await getEnabledFeeds();
  const totalBatches = Math.ceil(feeds.length / FEEDS_PER_BATCH);

  // 批次溢出警告
  const warning = totalBatches > 19
    ? `Warning: ${totalBatches} batches needed but only 19 configured. Feeds ${19 * FEEDS_PER_BATCH + 1}+ are not covered.`
    : undefined;

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
      warning,
    });
  }

  // 第一步：并行获取所有 feeds 的新文章（包括未翻译的重试）
  console.log(`Fetching ${feedsToProcess.length} feeds...`);
  const feedsWithItems: FeedWithItems[] = [];
  const allItemsToTranslate: TranslationInput[] = [];

  await Promise.all(feedsToProcess.map(async (feedConfig) => {
    try {
      const feed = await parseFeed(feedConfig.url);
      const guidStatus = await getExistingGuids(feedConfig.id);

      const newItems = feed.items
        .filter(item => {
          const status = guidStatus.get(item.guid);
          return status === undefined || status === false; // 新文章或未翻译
        })
        .slice(0, MAX_ITEMS_PER_FEED);

      if (newItems.length > 0) {
        console.log(`Found ${newItems.length} new/untranslated items for ${feedConfig.name}`);
        feedsWithItems.push({
          config: feedConfig,
          feedTitle: feed.title,
          feedDescription: feed.description,
          feedLink: feed.link,
          items: newItems,
        });

        // 收集需要翻译的文章
        for (const item of newItems) {
          allItemsToTranslate.push({
            id: item.guid,
            title: item.title,
            content: item.content,
            link: item.link,
          });
        }
      } else {
        console.log(`No new items for ${feedConfig.name}`);
      }
    } catch (error) {
      console.error(`Error fetching feed ${feedConfig.name}:`, error);
    }
  }));

  if (allItemsToTranslate.length === 0) {
    return NextResponse.json({
      success: true,
      timestamp: new Date().toISOString(),
      batch,
      totalBatches,
      nextBatch: batch + 1 < totalBatches ? batch + 1 : null,
      message: 'No new items to translate',
      totalFeeds: feeds.length,
      processedFeeds: feedsToProcess.length,
      warning,
    });
  }

  // 第 1.5 步：对内容不足的文章抓取原文网页（整体 15s 超时，使用 AbortController）
  const enrichedContentMap = new Map<string, string>();
  const enrichFailedIds = new Set<string>();
  const itemsNeedingFetch = allItemsToTranslate.filter(item => needsFetch(item.content));
  if (itemsNeedingFetch.length > 0) {
    console.log(`Fetching full content for ${itemsNeedingFetch.length} articles...`);
    const fetchController = new AbortController();
    const fetchTimeout = setTimeout(() => fetchController.abort(), 15000);
    try {
      await Promise.all(
        itemsNeedingFetch.map(async (item) => {
          if (fetchController.signal.aborted) return;
          const result = await fetchArticleContent(item.link || '');
          if (result.content) {
            item.content = result.content;
            enrichedContentMap.set(item.id, result.content);
          } else if (result.attempted) {
            // 真正抓取失败：跳过本轮，不用 snippet 强翻以致永久低质量
            enrichFailedIds.add(item.id);
          }
        })
      );
    } catch (error) {
      console.error('Article fetch error:', error);
    } finally {
      clearTimeout(fetchTimeout);
    }
    console.log(
      `Article fetch done. Enriched ${enrichedContentMap.size}/${itemsNeedingFetch.length}, skipped ${enrichFailedIds.size}.`
    );
  }

  // enrich 失败的 item 本轮不翻译，等下次 cron 重试
  const itemsForTranslation = allItemsToTranslate.filter(i => !enrichFailedIds.has(i.id));

  // 第二步：批量翻译所有文章（自动分批避免超出上下文限制）
  console.log(`Translating ${itemsForTranslation.length} articles (${enrichFailedIds.size} deferred)...`);
  const translations = await translateBatch(itemsForTranslation, deadline);

  // 计算实际 API 调用次数
  const MAX_ARTICLES_PER_API_CALL = 3;
  const apiCalls = Math.ceil(allItemsToTranslate.length / MAX_ARTICLES_PER_API_CALL);

  // 第三步：保存翻译结果到各自的 feed
  let totalProcessed = 0;
  const results = [];
  const allTranslatedItems: TranslatedItem[] = [];

  for (const feedData of feedsWithItems) {
    const translatedItems: TranslatedItem[] = [];

    for (const item of feedData.items) {
      const translation = translations.get(item.guid);

      const translatedItem: TranslatedItem = {
        guid: item.guid,
        originalTitle: item.title,
        translatedTitle: translation?.translatedTitle || item.title,
        originalContent: enrichedContentMap.get(item.guid) || item.content,
        translatedContent: translation?.translatedContent || (enrichedContentMap.get(item.guid) || item.content),
        link: item.link,
        pubDate: item.pubDate,
        author: item.author,
        categories: item.categories,
        translatedAt: new Date().toISOString(),
        translated: !!translation,
        sourceFeedId: feedData.config.id,
        sourceFeedName: feedData.config.name,
      };

      translatedItems.push(translatedItem);
    }

    if (translatedItems.length > 0) {
      if (!dryRun) {
        await appendItems(
          feedData.config.id,
          feedData.feedTitle,
          feedData.feedDescription,
          feedData.feedLink,
          translatedItems
        );
      }
      totalProcessed += translatedItems.length;
      allTranslatedItems.push(...translatedItems);
    }

    results.push({
      feedId: feedData.config.id,
      feedName: feedData.config.name,
      processed: translatedItems.length,
      translated: translatedItems.filter(i => i.translated).length,
    });
  }

  // 更新聚合索引（写当前批次的分片，避免 3 批并发写同一文件）
  if (totalProcessed > 0 && !dryRun) {
    await saveRecentIndex(allTranslatedItems, batch);
  }

  console.log(`Batch ${batch} completed${dryRun ? ' [DRY RUN]' : ''}. Processed: ${totalProcessed} items with ${apiCalls} API call(s)`);

  const nextBatch = batch + 1 < totalBatches ? batch + 1 : null;

  // dry-run 时回传翻译样本（截断），用于人眼验证是否真的翻成了中文
  const samples = dryRun
    ? allTranslatedItems.slice(0, 5).map(i => ({
        feedId: i.sourceFeedId,
        translated: i.translated,
        originalTitle: i.originalTitle,
        translatedTitle: i.translatedTitle,
        translatedContentSnippet: i.translatedContent.slice(0, 240),
      }))
    : undefined;

  return NextResponse.json({
    success: true,
    dryRun,
    timestamp: new Date().toISOString(),
    batch,
    totalBatches,
    nextBatch,
    totalFeeds: feeds.length,
    processedFeeds: feedsToProcess.length,
    feedRange: `${startIndex + 1}-${endIndex}`,
    totalItems: totalProcessed,
    apiCalls,
    results,
    samples,
    nextBatchUrl: nextBatch !== null ? `/api/cron?batch=${nextBatch}` : null,
    warning,
  });
}
