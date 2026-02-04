import Anthropic from '@anthropic-ai/sdk';

// Zenmux API 配置
// 文档: https://zenmux.ai/docs/api/anthropic/create-messages-new.html
const ZENMUX_BASE_URL = process.env.API_BASE_URL || 'https://api.zenmux.ai';

const anthropic = new Anthropic({
  apiKey: process.env.API_KEY || process.env.ANTHROPIC_API_KEY,
  baseURL: ZENMUX_BASE_URL,
});

// 可配置的模型名称
const MODEL_NAME = process.env.MODEL_NAME || 'claude-sonnet-4-20250514';

export interface TranslationResult {
  translatedTitle: string;
  translatedContent: string;
}

export async function translateContent(
  title: string,
  content: string
): Promise<TranslationResult> {
  // 限制内容长度以避免token超限
  const maxContentLength = 4000;
  const truncatedContent = content.length > maxContentLength
    ? content.substring(0, maxContentLength) + '...'
    : content;

  const prompt = `请将以下RSS文章翻译成中文。保持原文的格式和结构，翻译要自然流畅。

标题: ${title}

内容:
${truncatedContent}

请按以下JSON格式返回翻译结果（不要包含markdown代码块标记）:
{
  "translatedTitle": "翻译后的标题",
  "translatedContent": "翻译后的内容"
}`;

  try {
    const message = await anthropic.messages.create({
      model: MODEL_NAME,
      max_tokens: 2048,
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

    // 解析JSON响应
    const result = JSON.parse(responseText);

    return {
      translatedTitle: result.translatedTitle || title,
      translatedContent: result.translatedContent || content,
    };
  } catch (error) {
    console.error('Translation error:', error);
    // 翻译失败时返回原文
    return {
      translatedTitle: title,
      translatedContent: content,
    };
  }
}

export async function translateBatch(
  items: Array<{ title: string; content: string }>
): Promise<TranslationResult[]> {
  // 并行翻译，但限制并发数以避免API限制
  const batchSize = 3;
  const results: TranslationResult[] = [];

  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    const batchResults = await Promise.all(
      batch.map(item => translateContent(item.title, item.content))
    );
    results.push(...batchResults);
  }

  return results;
}
