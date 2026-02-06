import { parseStringPromise } from 'xml2js';

export interface OPMLOutline {
  id: string;
  title: string;
  text: string;
  xmlUrl: string;
  htmlUrl?: string;
  type?: string;
}

export interface OPMLFeed {
  title: string;
  outlines: OPMLOutline[];
}

// 将标题转换为URL友好的ID
function titleToId(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .substring(0, 50);
}

export async function parseOPML(content: string): Promise<OPMLFeed> {
  const result = await parseStringPromise(content, {
    explicitArray: false,
    mergeAttrs: true,
  });

  const opml = result.opml;
  const title = opml.head?.title || 'Imported Feeds';
  const outlines: OPMLOutline[] = [];

  function extractOutlines(node: unknown) {
    if (!node) return;

    // 处理单个outline对象或outline数组
    const items = Array.isArray(node) ? node : [node];

    for (const item of items) {
      if (item.xmlUrl) {
        // 这是一个RSS源
        outlines.push({
          id: titleToId(item.title || item.text || 'feed'),
          title: item.title || item.text || 'Untitled',
          text: item.text || item.title || 'Untitled',
          xmlUrl: item.xmlUrl,
          htmlUrl: item.htmlUrl,
          type: item.type,
        });
      }

      // 递归处理子outline
      if (item.outline) {
        extractOutlines(item.outline);
      }
    }
  }

  extractOutlines(opml.body?.outline);

  // 确保ID唯一
  const seenIds = new Map<string, number>();
  for (const outline of outlines) {
    const baseId = outline.id;
    const count = seenIds.get(baseId) || 0;
    if (count > 0) {
      outline.id = `${baseId}-${count}`;
    }
    seenIds.set(baseId, count + 1);
  }

  return { title, outlines };
}

export async function fetchOPML(url: string): Promise<OPMLFeed> {
  // 对于GitHub Gist，使用API获取内容
  if (url.includes('gist.githubusercontent.com')) {
    const gistMatch = url.match(/gist\.githubusercontent\.com\/([^/]+)\/([^/]+)/);
    if (gistMatch) {
      const gistId = gistMatch[2];
      const apiUrl = `https://api.github.com/gists/${gistId}`;
      const headers: Record<string, string> = {
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'RSS-Translator/1.0',
      };
      if (process.env.GITHUB_TOKEN) {
        headers['Authorization'] = `token ${process.env.GITHUB_TOKEN}`;
      }
      const response = await fetch(apiUrl, { headers });

      if (!response.ok) {
        throw new Error(`Failed to fetch gist: ${response.status}`);
      }

      const gist = await response.json();
      // 找到OPML文件
      const opmlFile = Object.values(gist.files).find(
        (file: unknown) => (file as { filename: string }).filename.endsWith('.opml')
      ) as { content: string } | undefined;

      if (!opmlFile) {
        throw new Error('No OPML file found in gist');
      }

      return parseOPML(opmlFile.content);
    }
  }

  // 普通URL直接获取
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'RSS-Translator/1.0',
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch OPML: ${response.status}`);
  }

  const content = await response.text();
  return parseOPML(content);
}
