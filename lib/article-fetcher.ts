import { extract } from '@extractus/article-extractor';

const MIN_CONTENT_LENGTH = 1000;

export function needsFetch(content: string): boolean {
  return content.trim().length < MIN_CONTENT_LENGTH;
}

export async function fetchArticleContent(url: string): Promise<string | null> {
  try {
    const article = await extract(url, {}, { signal: AbortSignal.timeout(8000) });
    return article?.content || null;
  } catch {
    return null;
  }
}
