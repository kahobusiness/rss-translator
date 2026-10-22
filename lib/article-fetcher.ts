import { extract } from '@extractus/article-extractor';

export const needsFetch = (content: string) => content.trim().length < 1000;

export async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([promise, new Promise<null>(resolve => { timer = setTimeout(() => resolve(null), ms); })]);
  } finally { if (timer) clearTimeout(timer); }
}

export interface FetchResult { content: string | null; attempted: boolean; error?: string }
export async function fetchArticleContent(url: string, signal?: AbortSignal): Promise<FetchResult> {
  if (!url) return { content: null, attempted: false };
  try {
    const deadline = AbortSignal.timeout(12_000);
    const article = await extract(url, {}, { signal: signal ? AbortSignal.any([signal, deadline]) : deadline });
    return { content: article?.content || null, attempted: true,
      ...(!article?.content ? { error: 'Article extractor returned no content' } : {}) };
  } catch (error) {
    return { content: null, attempted: true, error: error instanceof Error ? error.message : 'Article extraction failed' };
  }
}
