import { extract } from '@extractus/article-extractor';
import { Parser } from 'htmlparser2';

export const needsFetch = (content: string) => content.trim().length < 1000;

export async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([promise, new Promise<null>(resolve => { timer = setTimeout(() => resolve(null), ms); })]);
  } finally { if (timer) clearTimeout(timer); }
}

// These legacy publisher URLs still occur in persisted RSS jobs. Prefer the
// author's canonical edition; never follow arbitrary links from article text.
export function articleUrls(url: string, sourceContent = ''): string[] {
  const original = new URL(url);
  const candidates: string[] = [];
  if (original.hostname === 'gwern.substack.com') {
    const parser = new Parser({ onopentag(name, attrs) {
      if (name !== 'a' || !attrs.href) return;
      try {
        const link = new URL(attrs.href);
        if (/^(www\.)?gwern\.net$/.test(link.hostname) && /^\/newsletter\/\d{4}\/\d{2}$/.test(link.pathname)) {
          link.hostname = 'gwern.net'; candidates.push(link.href);
        }
      } catch { /* Ignore malformed links. */ }
    } });
    parser.end(sourceContent);
    if (original.pathname === '/p/november-newsletter') candidates.push('https://gwern.net/newsletter/2020/11');
    if (original.pathname === '/p/october-2020-news') candidates.push('https://gwern.net/newsletter/2020/10');
  }
  if (original.hostname === 'fabiensanglard.net' && original.pathname === '/more_doom3_documentation/index.php') {
    candidates.push('https://fabiensanglard.net/doom3_documentation/index.php');
  }
  candidates.push(original.href);
  if (/\/index\.(html|php)$/.test(original.pathname)) {
    const directory = new URL(original); directory.pathname = directory.pathname.replace(/index\.(html|php)$/, '');
    candidates.push(directory.href);
  }
  return [...new Set(candidates)];
}

export interface FetchResult { content: string | null; attempted: boolean; error?: string; url?: string }
export async function fetchArticleContent(url: string, signal?: AbortSignal, sourceContent = ''): Promise<FetchResult> {
  if (!url) return { content: null, attempted: false };
  try {
    const deadline = AbortSignal.timeout(12_000);
    const combined = signal ? AbortSignal.any([signal, deadline]) : deadline;
    let failure = 'Article extractor returned no content';
    for (const candidate of articleUrls(url, sourceContent)) {
      if (combined.aborted) break;
      try {
        const article = await extract(candidate, {}, { signal: combined });
        if (article?.content) return { content: article.content, attempted: true, url: candidate };
      } catch (error) { failure = error instanceof Error ? error.message : 'Article extraction failed'; }
    }
    return { content: null, attempted: true, error: combined.aborted ? 'Article extraction timed out' : failure };
  } catch (error) {
    return { content: null, attempted: true, error: error instanceof Error ? error.message : 'Article extraction failed' };
  }
}
