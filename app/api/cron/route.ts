import { NextRequest, NextResponse } from 'next/server';
import { getEnabledFeeds, FeedConfig } from '@/config/feeds';
import { parseFeed, ParsedItem } from '@/lib/rss-parser';
import { translateBatch, TranslationInput } from '@/lib/translator';
import {
  appendItems,
  getExistingStatus,
  saveRecentIndex,
  computeRetryState,
  ItemStatus,
  TranslatedItem,
} from '@/lib/storage';
import { needsFetch, fetchArticleContent } from '@/lib/article-fetcher';
import { truncateAtParagraph } from '@/lib/utils';

// Vercel Cron需要的配置
export const maxDuration = 300; // Pro 版最大 300 秒
export const dynamic = 'force-dynamic';

// 每批处理的 feed 数量（减少到 5 以确保在 300s 内完成）
const FEEDS_PER_BATCH = 5;
// 每个 feed 最多翻译的文章数（降到 2 以适配长文 feed 在 300s 内完成）
const MAX_ITEMS_PER_FEED = 2;
// 超过此长度的文章在翻译前段落边界截断，避免单调用耗时超过 API_CALL_TIMEOUT_MS
const MAX_CONTENT_CHARS_FOR_TRANSLATION = 30_000;

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

  // 第一步：并行获取所有 feeds 的新文章（包括未翻译且到达重试时间的）
  console.log(`Fetching ${feedsToProcess.length} feeds...`);
  const feedsWithItems: FeedWithItems[] = [];
  const allItemsToTranslate: TranslationInput[] = [];
  // guid → 历史 status，在保存阶段用来累加 attempts
  const priorStatus = new Map<string, ItemStatus>();
  const now = Date.now();

  await Promise.all(feedsToProcess.map(async (feedConfig) => {
    try {
      const feed = await parseFeed(feedConfig.url);
      const statusMap = await getExistingStatus(feedConfig.id);

      const newItems = feed.items
        .filter(item => {
          const status = statusMap.get(item.guid);
          if (status === undefined) return true; // 新文章
          if (status.translated) return false; // 已成功
          if (status.permanentlyFailed) return false; // 触顶放弃，人工 reset 才会再试
          if (status.nextRetryAt && now < new Date(status.nextRetryAt).getTime()) return false;
          return true; // 到达重试时间
        })
        .slice(0, MAX_ITEMS_PER_FEED);

      // 记录每个 item 的上轮 attempts 数，用于失败时 computeRetryState
      for (const item of newItems) {
        const prior = statusMap.get(item.guid);
        if (prior) priorStatus.set(item.guid, prior);
      }

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

  // 保留截断前的完整原文（给存档用 originalContent），避免后续 truncate 丢失
  const fullOriginalContentMap = new Map<string, string>();
  for (const item of itemsForTranslation) fullOriginalContentMap.set(item.id, item.content);

  // 超长文章段落边界截断；避免单次 MiniMax 调用 >100s 被 abort
  let truncatedCount = 0;
  for (const item of itemsForTranslation) {
    if (item.content.length > MAX_CONTENT_CHARS_FOR_TRANSLATION) {
      const before = item.content.length;
      item.content = truncateAtParagraph(item.content, MAX_CONTENT_CHARS_FOR_TRANSLATION);
      console.log(`Truncated ${item.id}: ${before} → ${item.content.length} chars`);
      truncatedCount++;
    }
  }
  if (truncatedCount > 0) console.log(`Truncated ${truncatedCount} long article(s)`);

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
      const succeeded = !!translation;

      // 失败路径：累加 attempts 并算下一次重试时间；成功则清空这些字段
      let retryFields: Pick<TranslatedItem, 'attempts' | 'nextRetryAt' | 'permanentlyFailed'> = {};
      if (!succeeded) {
        const prior = priorStatus.get(item.guid)?.attempts ?? 0;
        const next = computeRetryState(prior);
        retryFields = {
          attempts: next.attempts,
          nextRetryAt: next.nextRetryAt,
          permanentlyFailed: next.permanentlyFailed || undefined,
        };
      }

      const translatedItem: TranslatedItem = {
        guid: item.guid,
        originalTitle: item.title,
        translatedTitle: translation?.translatedTitle || item.title,
        originalContent: fullOriginalContentMap.get(item.guid) || enrichedContentMap.get(item.guid) || item.content,
        translatedContent: translation?.translatedContent || (enrichedContentMap.get(item.guid) || item.content),
        link: item.link,
        pubDate: item.pubDate,
        author: item.author,
        categories: item.categories,
        translatedAt: new Date().toISOString(),
        translated: succeeded,
        ...retryFields,
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

  // dry-run 时回传翻译样本 + 诊断信息，用于人眼验证和排查
  const samples = dryRun
    ? allTranslatedItems.slice(0, 10).map(i => ({
        feedId: i.sourceFeedId,
        translated: i.translated,
        attempts: i.attempts,
        permanentlyFailed: i.permanentlyFailed,
        originalChars: i.originalContent.length,
        translatedChars: i.translatedContent.length,
        // originalContent 是截断前的完整版；>30K 说明本轮翻译用了截断版
        hitTruncation: i.originalContent.length > MAX_CONTENT_CHARS_FOR_TRANSLATION,
        originalTitle: i.originalTitle,
        translatedTitle: i.translatedTitle,
        translatedContentSnippet: i.translatedContent.slice(0, 240),
      }))
    : undefined;
  const diagnostics = dryRun
    ? {
        truncatedCount,
        deferredByEnrichFailure: enrichFailedIds.size,
        enrichedCount: enrichedContentMap.size,
      }
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
    diagnostics,
    nextBatchUrl: nextBatch !== null ? `/api/cron?batch=${nextBatch}` : null,
    warning,
  });
}
