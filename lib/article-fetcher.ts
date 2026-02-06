import { extract } from '@extractus/article-extractor';

const MIN_CONTENT_LENGTH = 1000;

export function needsFetch(content: string): boolean {
  return content.trim().length < MIN_CONTENT_LENGTH;
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([
    promise,
    new Promise<null>((resolve) => setTimeout(() => resolve(null), ms)),
  ]);
}

export async function fetchArticleContent(url: string): Promise<string | null> {
  try {
    const article = await withTimeout(
      extract(url, {}, { signal: AbortSignal.timeout(5000) }),
      6000
    );
    return article?.content || null;
  } catch {
    return null;
  }
}
