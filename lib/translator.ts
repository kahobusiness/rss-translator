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
}

// 从响应文本中提取 JSON（处理 markdown 代码块包裹的情况）
function extractJSON(text: string): string {
  let cleaned = text.trim();

  // 匹配 ```json ... ``` 或 ``` ... ``` 格式
  const codeBlockMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) {
    cleaned = codeBlockMatch[1].trim();
  }

  // 找到第一个 [ 或 { 和对应的结束符
  const arrayStart = cleaned.indexOf('[');
  const objectStart = cleaned.indexOf('{');

  if (arrayStart !== -1 && (objectStart === -1 || arrayStart < objectStart)) {
    // 返回数组
    const endIndex = cleaned.lastIndexOf(']');
    if (endIndex > arrayStart) {
      cleaned = cleaned.substring(arrayStart, endIndex + 1);
    }
  } else if (objectStart !== -1) {
    // 返回对象
    const endIndex = cleaned.lastIndexOf('}');
    if (endIndex > objectStart) {
      cleaned = cleaned.substring(objectStart, endIndex + 1);
    }
  }

  return cleaned;
}

// 每次 API 调用的最大文章数（避免超出上下文限制）
const MAX_ARTICLES_PER_API_CALL = 8;
// 每篇文章内容的最大字符数
const MAX_CONTENT_LENGTH = 1500;

// 单次 API 调用翻译一批文章
async function translateSingleBatch(
  items: TranslationInput[]
): Promise<Map<string, TranslationResult>> {
  if (items.length === 0) {
    return new Map();
  }

  // 构建批量翻译的 prompt
  const articlesText = items.map((item, index) => {
    const truncatedContent = item.content.length > MAX_CONTENT_LENGTH
      ? item.content.substring(0, MAX_CONTENT_LENGTH) + '...'
      : item.content;

    return `---文章${index + 1} (ID: ${item.id})---
标题: ${item.title}
内容: ${truncatedContent}`;
  }).join('\n\n');

  const prompt = `将以下${items.length}篇RSS文章翻译成中文。保持原文格式，翻译要自然流畅。

${articlesText}

直接返回JSON数组（不要用代码块包裹）:
[{"id": "文章ID", "translatedTitle": "翻译后的标题", "translatedContent": "翻译后的内容"}, ...]`;

  try {
    const message = await anthropic.messages.create({
      model: MODEL_NAME,
      max_tokens: 8192,
      messages: [
        {
          role: 'user',
          content: prompt,
        },
      ],
    });

    const responseText = message.content[0].type === 'text'
      ? message.content[0].text
      : '';

    // 提取并解析JSON响应
    const jsonText = extractJSON(responseText);
    const results = JSON.parse(jsonText) as Array<{
      id: string;
      translatedTitle: string;
      translatedContent: string;
    }>;

    // 转换为 Map
    const resultMap = new Map<string, TranslationResult>();
    for (const result of results) {
      resultMap.set(result.id, {
        translatedTitle: result.translatedTitle,
        translatedContent: result.translatedContent,
      });
    }

    return resultMap;
  } catch (error) {
    console.error('Single batch translation error:', error);
    return new Map();
  }
}

// 批量翻译多篇文章（自动分批避免超出上下文限制）
export async function translateBatch(
  items: TranslationInput[]
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
    const start = i * MAX_ARTICLES_PER_API_CALL;
    const end = Math.min(start + MAX_ARTICLES_PER_API_CALL, totalArticles);
    const batchItems = items.slice(start, end);

    console.log(`  Sub-batch ${i + 1}/${numBatches}: translating articles ${start + 1}-${end}`);

    const batchResults = await translateSingleBatch(batchItems);

    // 合并结果
    for (const [id, result] of batchResults) {
      allResults.set(id, result);
    }
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
