import { Parser } from 'htmlparser2';
import { escapeHtml } from './utils.ts';
import type { TranslatedItem } from './storage.ts';

export function publishedTranslations(items: TranslatedItem[]): TranslatedItem[] {
  return items.filter(item => item.translated !== false && item.translatedTitle.trim() && item.translatedContent.trim())
    .sort((a, b) => (Date.parse(b.pubDate) || 0) - (Date.parse(a.pubDate) || 0));
}

export function latestTranslation(items: TranslatedItem[]): TranslatedItem | undefined {
  return publishedTranslations(items)[0];
}

export function adjacentTranslations(items: TranslatedItem[], guid: string) {
  const articles = publishedTranslations(items);
  const index = articles.findIndex(item => item.guid === guid);
  return { previous: index > 0 ? articles[index - 1] : undefined,
    next: index >= 0 ? articles[index + 1] : undefined };
}

export function articleExcerpt(html: string, limit = 220): string {
  let text = '';
  let hidden = 0;
  const parser = new Parser({
    onopentag(tag) { if (['script', 'style', 'svg'].includes(tag)) hidden++; },
    ontext(value) { if (!hidden) text += value; },
    onclosetag(tag) {
      if (['script', 'style', 'svg'].includes(tag)) hidden--;
      if (['p', 'div', 'li', 'br', 'h1', 'h2', 'h3', 'pre'].includes(tag)) text += ' ';
    },
  }, { decodeEntities: true });
  parser.end(html);
  const characters = Array.from(text.replace(/\s+/g, ' ').trim());
  return characters.slice(0, limit).join('') + (characters.length > limit ? '…' : '');
}

// Feed HTML comes from external publishers. Only render a small, inert subset
// on our own origin; discard embedded documents, event handlers and inline CSS.
export function readableArticleHtml(html: string, baseUrl: string): string {
  const tags = new Set(['p', 'div', 'br', 'hr', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'ul', 'ol', 'li', 'blockquote', 'pre', 'code', 'strong', 'b', 'em', 'i', 's',
    'table', 'thead', 'tbody', 'tr', 'th', 'td', 'figure', 'figcaption', 'a', 'img']);
  const blocked = new Set(['script', 'style', 'iframe', 'object', 'svg', 'math', 'form', 'template']);
  let hidden = 0;
  let output = '';
  const safeUrl = (value: string) => {
    try { const url = new URL(value, baseUrl); return ['https:', 'http:'].includes(url.protocol) ? escapeHtml(url.href) : ''; }
    catch { return ''; }
  };
  const parser = new Parser({
    onopentag(tag, attrs) {
      if (blocked.has(tag)) hidden++;
      if (hidden || !tags.has(tag)) return;
      let attributes = '';
      if (tag === 'a' && attrs.href) {
        const href = safeUrl(attrs.href);
        if (href) attributes = ` href="${href}" target="_blank" rel="noopener noreferrer"`;
      }
      if (tag === 'img') {
        const src = safeUrl(attrs.src || '');
        if (!attrs.src || !src) return;
        attributes = ` src="${src}" alt="${escapeHtml(attrs.alt || '')}" loading="lazy" referrerpolicy="no-referrer"`;
      }
      output += `<${tag}${attributes}>`;
    },
    ontext(text) { if (!hidden) output += escapeHtml(text); },
    onclosetag(tag) {
      if (blocked.has(tag)) { hidden--; return; }
      if (!hidden && tags.has(tag) && !['br', 'hr', 'img'].includes(tag)) output += `</${tag}>`;
    },
  }, { decodeEntities: true });
  parser.end(html);
  return output;
}

export function articleDate(value: string): string | null {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime()) || date.getUTCFullYear() < 1971) return null;
  return new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', year: 'numeric', month: 'long', day: 'numeric' }).format(date);
}
