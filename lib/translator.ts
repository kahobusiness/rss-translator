import Anthropic from '@anthropic-ai/sdk';

// Zenmux API 配置
// 文档: https://zenmux.ai/docs/api/anthropic/create-messages-new.html
const ZENMUX_BASE_URL = process.env.API_BASE_URL || 'https://zenmux.ai/api/anthropic';

const anthropic = new Anthropic({
  apiKey: process.env.API_KEY || process.env.ANTHROPIC_API_KEY,
  baseURL: ZENMUX_BASE_URL,
});

// 可配置的模型名称（Zenmux 格式: anthropic/claude-sonnet-4.5）
const MODEL_NAME = process.env.MODEL_NAME || 'anthropic/claude-sonnet-4.5';

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

// 每篇文章内容的最大字符数
const MAX_CONTENT_LENGTH = 40000;
// 每次 API 调用的最大文章数
const MAX_ARTICLES_PER_API_CALL = 3;

// 从响应文本中按分隔符提取翻译结果
function parseDelimiterResponse(
  responseText: string,
  items: TranslationInput[]
): Map<string, TranslationResult> {
  const resultMap = new Map<string, TranslationResult>();

  for (let i = 0; i < items.length; i++) {
    const tag = `ARTICLE_${i + 1}`;
    const titleRegex = new RegExp(`<${tag}_TITLE>\\s*([\\s\\S]*?)\\s*</${tag}_TITLE>`);
    const contentRegex = new RegExp(`<${tag}_CONTENT>\\s*([\\s\\S]*?)\\s*</${tag}_CONTENT>`);

    const titleMatch = responseText.match(titleRegex);
    const contentMatch = responseText.match(contentRegex);

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

// 单次 API 调用翻译一批文章（使用分隔符格式避免 JSON 解析问题）
async function translateSingleBatch(
  items: TranslationInput[]
): Promise<Map<string, TranslationResult>> {
  if (items.length === 0) {
    return new Map();
  }

  const articlesText = items.map((item, index) => {
    const truncatedContent = item.content.length > MAX_CONTENT_LENGTH
      ? item.content.substring(0, MAX_CONTENT_LENGTH) + '...'
      : item.content;

    return `---文章${index + 1}---
标题: ${item.title}
内容: ${truncatedContent}`;
  }).join('\n\n');

  // 构建期望的输出格式示例
  const formatExample = items.map((_, index) => {
    const tag = `ARTICLE_${index + 1}`;
    return `<${tag}_TITLE>\n翻译后的标题\n</${tag}_TITLE>\n<${tag}_CONTENT>\n翻译后的内容\n</${tag}_CONTENT>`;
  }).join('\n');

  const prompt = `将以下${items.length}篇RSS文章翻译成中文。保持原文的HTML格式，翻译要自然流畅。

${articlesText}

请严格按以下格式返回每篇文章的翻译结果：
${formatExample}`;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 90000);

    const message = await anthropic.messages.create(
      {
        model: MODEL_NAME,
        max_tokens: 16384,
        messages: [{ role: 'user', content: prompt }],
      },
      { signal: controller.signal }
    );

    clearTimeout(timeout);

    const responseText = message.content[0].type === 'text'
      ? message.content[0].text
      : '';

    return parseDelimiterResponse(responseText, items);
  } catch (error) {
    console.error('Batch translation error:', error);
    return new Map();
  }
}

// 批量翻译多篇文章（自动分批避免超出上下文限制）
export async function translateBatch(
  items: TranslationInput[],
  deadline?: number
): Promise<Map<string, TranslationResult>> {
  if (items.length === 0) {
    return new Map();
  }

  const totalArticles = items.length;
  const numBatches = Math.ceil(totalArticles / MAX_ARTICLES_PER_API_CALL);

  console.log(`Translating ${totalArticles} articles in ${numBatches} API call(s)...`);

  const allResults = new Map<string, TranslationResult>();

  // 顺序处理每个子批次（避免并发导致的 API 限流）
  for (let i = 0; i < numBatches; i++) {
    // 检查是否即将超时
    if (deadline && Date.now() > deadline) {
      console.warn(`Deadline reached after ${i}/${numBatches} sub-batches. Returning partial results.`);
      break;
    }

    const start = i * MAX_ARTICLES_PER_API_CALL;
    const end = Math.min(start + MAX_ARTICLES_PER_API_CALL, totalArticles);
    const batchItems = items.slice(start, end);

    console.log(`  Sub-batch ${i + 1}/${numBatches}: translating articles ${start + 1}-${end}`);

    const batchResults = await translateSingleBatch(batchItems);

    // 合并结果
    batchResults.forEach((result, id) => {
      allResults.set(id, result);
    });
  }

  console.log(`Successfully translated ${allResults.size}/${totalArticles} articles`);
  return allResults;
}

// 单篇翻译（保留作为备用）
export async function translateContent(
  title: string,
  content: string
): Promise<TranslationResult> {
  const results = await translateBatch([{ id: '0', title, content }]);
  return results.get('0') || { translatedTitle: title, translatedContent: content };
}
