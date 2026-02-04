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

// 从响应文本中提取 JSON（处理 markdown 代码块包裹的情况）
function extractJSON(text: string): string {
  // 移除可能的 markdown 代码块标记
  let cleaned = text.trim();

  // 匹配 ```json ... ``` 或 ``` ... ``` 格式
  const codeBlockMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) {
    cleaned = codeBlockMatch[1].trim();
  }

  // 如果还是不是以 { 开头，尝试找到第一个 { 和最后一个 }
  if (!cleaned.startsWith('{')) {
    const startIndex = cleaned.indexOf('{');
    const endIndex = cleaned.lastIndexOf('}');
    if (startIndex !== -1 && endIndex !== -1 && endIndex > startIndex) {
      cleaned = cleaned.substring(startIndex, endIndex + 1);
    }
  }

  return cleaned;
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

  const prompt = `将以下RSS文章翻译成中文。保持原文的格式和结构，翻译要自然流畅。

标题: ${title}

内容:
${truncatedContent}

直接返回JSON格式（不要用代码块包裹）:
{"translatedTitle": "翻译后的标题", "translatedContent": "翻译后的内容"}`;

  try {
    const message = await anthropic.messages.create({
      model: MODEL_NAME,
      max_tokens: 4096,
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
    const result = JSON.parse(jsonText);

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
