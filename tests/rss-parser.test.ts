import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseFeed } from '../lib/rss-parser.ts';

test('prefer full encoded content; missing dates and identifiers stay stable across polls', async t => {
  const xml = '<?xml version="1.0"?><rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/"><channel><title>Example</title>' +
    '<item><title>Article</title><description>Short summary</description><content:encoded><![CDATA[<p>Full original body</p>]]></content:encoded></item>' +
    '<item><description>anonymous body</description></item></channel></rss>';
  t.mock.method(globalThis, 'fetch', async () => new Response(xml));
  const first = await parseFeed('https://example.com/rss');
  const second = await parseFeed('https://example.com/rss');
  assert.equal(first.items[0].content, '<p>Full original body</p>');
  assert.deepEqual(first.items, second.items);
  assert.equal(first.items[0].pubDate, '1970-01-01T00:00:00.000Z');
  assert.notEqual(first.items[0].guid, first.items[1].guid);
});
