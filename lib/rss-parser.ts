import Parser from 'rss-parser';
import { createHash } from 'crypto';
import { withTimeout } from '@/lib/article-fetcher';

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

const parser = new Parser({
  timeout: 10000,
  headers: {
    'User-Agent': 'RSS-Translator/1.0',
  },
});

// 无 guid/link/title 的极端场景，用内容特征派生稳定 ID，防止多条空串互相覆盖
function stableFallbackGuid(feedUrl: string, title: string, pubDate: string, content: string): string {
  const seed = `${feedUrl}\x00${title}\x00${pubDate}\x00${content.slice(0, 256)}`;
  return 'gen:' + createHash('sha1').update(seed).digest('hex').slice(0, 16);
}

async function parseFeedInner(feedUrl: string): Promise<ParsedFeed> {
  const feed = await parser.parseURL(feedUrl);

  return {
    title: feed.title || 'Untitled Feed',
    description: feed.description,
    link: feed.link,
    items: feed.items.map(item => {
      const title = item.title || 'Untitled';
      const link = item.link || '';
      const content = item.content || item['content:encoded'] || item.contentSnippet || '';
      const pubDate = item.pubDate || item.isoDate || new Date().toISOString();
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
    const result = await withTimeout(parseFeedInner(url), 15000);
    if (!result) throw new Error(`Feed parse timeout: ${url}`);
    return result;
  } catch (error) {
    console.error(`Error parsing feed ${url}:`, error);
    throw error;
  }
}
