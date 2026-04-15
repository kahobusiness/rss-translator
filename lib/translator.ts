import Anthropic from '@anthropic-ai/sdk';

// MiniMax Anthropic 兼容 API 配置
const API_BASE_URL = process.env.API_BASE_URL || process.env.ANTHROPIC_BASE_URL || 'https://api.minimaxi.com/anthropic';

const anthropic = new Anthropic({
  apiKey: process.env.API_KEY || process.env.ANTHROPIC_API_KEY,
  baseURL: API_BASE_URL,
});

const MODEL_NAME = process.env.MODEL_NAME || 'MiniMax-M2.7';

// 上下文窗口 204,800 tokens 下的预算分配
const INPUT_BUDGET_PER_CALL = 140_000;
const SINGLE_CHUNK_LIMIT = 50_000;
const OUTPUT_MAX = 50_000;
const CONCURRENCY = 5;
const API_CALL_TIMEOUT_MS = 90_000;
const MAX_RETRIES = 3;
const RETRY_DELAYS_MS = [500, 1500, 4000];

export interface TranslationResult {
  translatedTitle: string;
  translatedContent: string;
}

export interface TranslationInput {
  id: string;
  title: string;
  content: string;
  link?: string;
}

interface Chunk extends TranslationInput {
  originalId: string;
  chunkIndex: number;
  chunkTotal: number;
}

// 粗略 token 估算：ASCII 约 3 字符/token，非 ASCII（CJK 等）约 1 字符/1.2 token
// 保守偏大，触发切分更早
function estimateTokens(text: string): number {
  let ascii = 0;
  let other = 0;
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) < 128) ascii++;
    else other++;
  }
  return Math.ceil(ascii / 3 + other * 1.2);
}

// HTML-safe 切片：按块级标签 / 段落边界拆分，保持标签完整
const BLOCK_BOUNDARY_RE = /(<\/(?:p|h[1-6]|li|ul|ol|pre|blockquote|div|section|article|table|tr)>|<br\s*\/?>|\n{2,})/gi;

function splitByBoundary(content: string, maxTokens: number, re: RegExp): string[] {
  const segments: string[] = [];
  let lastIdx = 0;
  for (const m of content.matchAll(re)) {
    const end = m.index! + m[0].length;
    segments.push(content.slice(lastIdx, end));
    lastIdx = end;
  }
  if (lastIdx < content.length) segments.push(content.slice(lastIdx));

  const parts: string[] = [];
  let current = '';
  for (const seg of segments) {
    if (current && estimateTokens(current + seg) > maxTokens) {
      parts.push(current);
      current = seg;
    } else {
      current += seg;
    }
  }
  if (current) parts.push(current);
  return parts;
}

function splitByCharCount(text: string, maxTokens: number): string[] {
  const approxChars = maxTokens * 2;
  const parts: string[] = [];
  for (let i = 0; i < text.length; i += approxChars) {
    parts.push(text.slice(i, i + approxChars));
  }
  return parts;
}

function splitArticle(content: string, maxTokens: number): string[] {
  if (estimateTokens(content) <= maxTokens) return [content];

  const blockParts = splitByBoundary(content, maxTokens, BLOCK_BOUNDARY_RE);
  const result: string[] = [];
  for (const p of blockParts) {
    if (estimateTokens(p) <= maxTokens) {
      result.push(p);
      continue;
    }
    // 回落 1：按句末标点
    const sentenceRe = /([.!?。！？]+[\s"'」』）)])/g;
    const sentenceParts = splitByBoundary(p, maxTokens, sentenceRe);
    for (const sp of sentenceParts) {
      if (estimateTokens(sp) <= maxTokens) {
        result.push(sp);
      } else {
        // 回落 2：按字符硬切（罕见：单句超 50K token）
        result.push(...splitByCharCount(sp, maxTokens));
      }
    }
  }
  return result;
}

// 按 token 预算贪心打包
function packBatches(chunks: Chunk[], budget: number): Chunk[][] {
  const batches: Chunk[][] = [];
  let current: Chunk[] = [];
  let currentTokens = 0;
  for (const c of chunks) {
    const t = estimateTokens(c.title) + estimateTokens(c.content);
    if (current.length > 0 && currentTokens + t > budget) {
      batches.push(current);
      current = [];
      currentTokens = 0;
    }
    current.push(c);
    currentTokens += t;
  }
  if (current.length > 0) batches.push(current);
  return batches;
}

// 并发控制（池式 worker）
async function runWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}

// 指数退避 + 抖动，仅对 429/5xx 重试
async function withRetry<T>(fn: () => Promise<T>, label: string): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      const status = (e as { status?: number })?.status;
      const retriable = status === 429 || status === 529 || (typeof status === 'number' && status >= 500);
      if (attempt === MAX_RETRIES || !retriable) throw e;
      const base = RETRY_DELAYS_MS[attempt];
      const wait = Math.round(base * (0.7 + Math.random() * 0.6));
      console.warn(`[${label}] ${status} — retry ${attempt + 1}/${MAX_RETRIES} after ${wait}ms`);
      await new Promise((r) => setTimeout(r, wait));
    }
  }
  throw lastErr;
}

// 从响应文本中按分隔符提取翻译结果
function parseDelimiterResponse(
  responseText: string,
  items: TranslationInput[],
): Map<string, TranslationResult> {
  const resultMap = new Map<string, TranslationResult>();
  for (let i = 0; i < items.length; i++) {
    const tag = `ARTICLE_${i + 1}`;
    const titleMatch = responseText.match(new RegExp(`<${tag}_TITLE>\\s*([\\s\\S]*?)\\s*</${tag}_TITLE>`));
    const contentMatch = responseText.match(new RegExp(`<${tag}_CONTENT>\\s*([\\s\\S]*?)\\s*</${tag}_CONTENT>`));
    if (titleMatch && contentMatch) {
      resultMap.set(items[i].id, {
        translatedTitle: titleMatch[1].trim(),
        translatedContent: contentMatch[1].trim(),
      });
    } else {
      console.warn(`Failed to parse translation for article ${i + 1} (${items[i].id})`);
    }
  }
  return resultMap;
}

const SYSTEM_PROMPT = `你是一位专业的英中翻译。请遵循以下规则：
- 翻译 RSS 文章的标题和正文为中文
- 保持原文的 HTML 标签和结构不变
- 代码块、命令行、变量名保持原文不翻译
- 技术术语首次出现时使用"中文（English）"格式，后续直接使用中文
- URL 和链接地址保持原文不变
- 图片的 alt 文本需要翻译
- 译文应自然流畅，不要翻译腔`;

async function translateSingleBatch(
  batch: Chunk[],
  batchId: number,
): Promise<Map<string, TranslationResult>> {
  if (batch.length === 0) return new Map();

  const articlesText = batch
    .map((item, idx) => `---文章${idx + 1}---\n标题: ${item.title}\n内容: ${item.content}`)
    .join('\n\n');

  const formatExample = batch
    .map((_, idx) => {
      const tag = `ARTICLE_${idx + 1}`;
      return `<${tag}_TITLE>\n翻译后的标题\n</${tag}_TITLE>\n<${tag}_CONTENT>\n翻译后的内容\n</${tag}_CONTENT>`;
    })
    .join('\n');

  const prompt = `将以下${batch.length}篇RSS文章翻译成中文。保持原文的HTML格式，翻译要自然流畅。

${articlesText}

请严格按以下格式返回每篇文章的翻译结果：
${formatExample}`;

  const inputTokens = estimateTokens(prompt) + estimateTokens(SYSTEM_PROMPT);
  const maxTokens = Math.min(Math.ceil(inputTokens * 1.2) + 500, OUTPUT_MAX);
  const label = `batch ${batchId}`;

  try {
    const message = await withRetry(async () => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), API_CALL_TIMEOUT_MS);
      try {
        return await anthropic.messages.create(
          {
            model: MODEL_NAME,
            max_tokens: maxTokens,
            system: SYSTEM_PROMPT,
            messages: [{ role: 'user', content: prompt }],
          },
          { signal: controller.signal },
        );
      } finally {
        clearTimeout(timer);
      }
    }, label);

    const textBlock = message.content.find((b) => b.type === 'text');
    const responseText = textBlock && 'text' in textBlock ? textBlock.text : '';
    console.log(`[${label}] ok — ${batch.length} items, input≈${inputTokens} tok, max_out=${maxTokens}`);
    return parseDelimiterResponse(responseText, batch);
  } catch (e) {
    console.error(`[${label}] failed:`, e);
    return new Map();
  }
}

export async function translateBatch(
  items: TranslationInput[],
  deadline?: number,
): Promise<Map<string, TranslationResult>> {
  if (items.length === 0) return new Map();

  // 1. 单篇切片（长文 → 多 chunk）
  const chunks: Chunk[] = [];
  for (const item of items) {
    const tokens = estimateTokens(item.content);
    if (tokens <= SINGLE_CHUNK_LIMIT) {
      chunks.push({ ...item, originalId: item.id, chunkIndex: 0, chunkTotal: 1 });
      continue;
    }
    const parts = splitArticle(item.content, SINGLE_CHUNK_LIMIT);
    console.log(`Article ${item.id} split into ${parts.length} chunks (≈${tokens} tok)`);
    parts.forEach((part, idx) => {
      chunks.push({
        id: `${item.id}#${idx}`,
        originalId: item.id,
        chunkIndex: idx,
        chunkTotal: parts.length,
        title: idx === 0 ? item.title : `[PART ${idx + 1}/${parts.length}]`,
        content: part,
        link: item.link,
      });
    });
  }

  // 2. 动态打包
  const batches = packBatches(chunks, INPUT_BUDGET_PER_CALL);
  console.log(
    `Translating ${items.length} article(s), ${chunks.length} chunk(s) → ${batches.length} batch(es), concurrency=${CONCURRENCY}`,
  );

  // 3. 并发执行各批次
  const chunkResults = new Map<string, TranslationResult>();
  const tasks = batches.map((batch, i) => ({ batch, batchId: i }));
  await runWithConcurrency(tasks, CONCURRENCY, async ({ batch, batchId }) => {
    if (deadline && Date.now() > deadline) {
      console.warn(`[batch ${batchId}] deadline reached, skipping`);
      return;
    }
    const results = await translateSingleBatch(batch, batchId);
    results.forEach((r, id) => chunkResults.set(id, r));
  });

  // 4. 按原文章 id 合并 chunks
  const final = new Map<string, TranslationResult>();
  for (const item of items) {
    const itemChunks = chunks
      .filter((c) => c.originalId === item.id)
      .sort((a, b) => a.chunkIndex - b.chunkIndex);
    const parts: string[] = [];
    let title = '';
    let complete = true;
    for (const c of itemChunks) {
      const r = chunkResults.get(c.id);
      if (!r) {
        complete = false;
        break;
      }
      if (c.chunkIndex === 0) title = r.translatedTitle;
      parts.push(r.translatedContent);
    }
    if (complete) {
      final.set(item.id, { translatedTitle: title, translatedContent: parts.join('') });
    }
  }

  console.log(`Successfully translated ${final.size}/${items.length} articles`);
  return final;
}

export const _internals = { estimateTokens, splitArticle, packBatches };

// 单篇翻译（保留作为备用）
export async function translateContent(
  title: string,
  content: string,
): Promise<TranslationResult> {
  const results = await translateBatch([{ id: '0', title, content }]);
  return results.get('0') || { translatedTitle: title, translatedContent: content };
}
