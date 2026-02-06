import Parser from 'rss-parser';
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

async function parseFeedInner(url: string): Promise<ParsedFeed> {
  const feed = await parser.parseURL(url);

  return {
    title: feed.title || 'Untitled Feed',
    description: feed.description,
    link: feed.link,
    items: feed.items.map(item => ({
      guid: item.guid || item.link || item.title || '',
      title: item.title || 'Untitled',
      link: item.link || '',
      content: item.content || item['content:encoded'] || item.contentSnippet || '',
      contentSnippet: item.contentSnippet,
      pubDate: item.pubDate || item.isoDate || new Date().toISOString(),
      author: item.creator || item.author,
      categories: item.categories,
    })),
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
