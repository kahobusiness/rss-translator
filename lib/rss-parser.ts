import Parser from 'rss-parser';
import { createHash } from 'crypto';

export interface ParsedItem {
  guid: string;
  title: string;
  link: string;
  content: string;
  contentSnippet?: string;
  pubDate: string;
  author?: string;
  categories?: string[];
}

export interface ParsedFeed {
  title: string;
  description?: string;
  link?: string;
  items: ParsedItem[];
}

const parser = new Parser();

// 无 guid/link/title 的极端场景，用内容特征派生稳定 ID，防止多条空串互相覆盖
function stableFallbackGuid(feedUrl: string, title: string, pubDate: string, content: string): string {
  const seed = `${feedUrl}\x00${title}\x00${pubDate}\x00${content.slice(0, 256)}`;
  return 'gen:' + createHash('sha1').update(seed).digest('hex').slice(0, 16);
}

async function parseFeedInner(feedUrl: string): Promise<ParsedFeed> {
  const response = await fetch(feedUrl, {
    headers: { 'User-Agent': 'RSS-Translator/2.0', Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9' },
    signal: AbortSignal.timeout(20_000), cache: 'no-store',
  });
  if (!response.ok) throw new Error(`RSS fetch HTTP ${response.status}: ${feedUrl}`);
  const xml = await response.text();
  if (xml.length > 10_000_000) throw new Error('RSS exceeds 10 MB limit');
  const feed = await parser.parseString(xml);

  return {
    title: feed.title || 'Untitled Feed',
    description: feed.description,
    link: feed.link,
    items: feed.items.map(item => {
      const title = item.title || 'Untitled';
      const link = item.link || '';
      const content = item['content:encoded'] || item.content || item.contentSnippet || '';
      const candidate = item.isoDate || item.pubDate;
      const pubDate = candidate && Number.isFinite(Date.parse(candidate)) ? new Date(candidate).toISOString() : '1970-01-01T00:00:00.000Z';
      const guid = item.guid || item.link || item.title || stableFallbackGuid(feedUrl, title, pubDate, content);
      return {
        guid,
        title,
        link,
        content,
        contentSnippet: item.contentSnippet,
        pubDate,
        author: item.creator || item.author,
        categories: item.categories,
      };
    }),
  };
}

export async function parseFeed(url: string): Promise<ParsedFeed> {
  try {
    return await parseFeedInner(url);
  } catch (error) {
    console.error(`Error parsing feed ${url}:`, error);
    throw error;
  }
}
