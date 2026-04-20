import { extract } from '@extractus/article-extractor';

const MIN_CONTENT_LENGTH = 1000;

export function needsFetch(content: string): boolean {
  return content.trim().length < MIN_CONTENT_LENGTH;
}

export function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([
    promise,
    new Promise<null>((resolve) => setTimeout(() => resolve(null), ms)),
  ]);
}

// attempted=false 表示根本没尝试（link 缺失等）；attempted=true + content=null 才是真抓取失败
export interface FetchResult {
  content: string | null;
  attempted: boolean;
}

export async function fetchArticleContent(url: string): Promise<FetchResult> {
  if (!url) return { content: null, attempted: false };
  try {
    const article = await withTimeout(
      extract(url, {}, { signal: AbortSignal.timeout(5000) }),
      6000
    );
    return { content: article?.content || null, attempted: true };
  } catch {
    return { content: null, attempted: true };
  }
}
