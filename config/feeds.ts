export interface FeedConfig {
  id: string;
  name: string;
  url: string;
  enabled: boolean;
}

// 在这里配置你要翻译的RSS源
export const feedConfigs: FeedConfig[] = [
  {
    id: 'hacker-news',
    name: 'Hacker News',
    url: 'https://hnrss.org/frontpage',
    enabled: true,
  },
  {
    id: 'techcrunch',
    name: 'TechCrunch',
    url: 'https://techcrunch.com/feed/',
    enabled: true,
  },
  {
    id: 'ars-technica',
    name: 'Ars Technica',
    url: 'https://feeds.arstechnica.com/arstechnica/index',
    enabled: true,
  },
  // 添加更多RSS源...
];

export function getFeedConfig(id: string): FeedConfig | undefined {
  return feedConfigs.find(feed => feed.id === id);
}

export function getEnabledFeeds(): FeedConfig[] {
  return feedConfigs.filter(feed => feed.enabled);
}
