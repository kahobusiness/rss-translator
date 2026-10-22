import assert from 'node:assert/strict';
import { test } from 'node:test';
import { articleUrls } from '../lib/article-fetcher.ts';

test('resolve legacy publisher paths and explicit canonical newsletter links', () => {
  assert.deepEqual(articleUrls('https://fabiensanglard.net/dc/index.html'),
    ['https://fabiensanglard.net/dc/index.html', 'https://fabiensanglard.net/dc/']);
  assert.equal(articleUrls('https://fabiensanglard.net/more_doom3_documentation/index.php')[0],
    'https://fabiensanglard.net/doom3_documentation/index.php');
  assert.equal(articleUrls('https://gwern.substack.com/p/may-gwernnet-newsletter',
    '<a href="https://www.gwern.net/newsletter/2020/05">canonical edition</a>')[0],
    'https://gwern.net/newsletter/2020/05');
  assert.equal(articleUrls('https://gwern.substack.com/p/november-newsletter')[0],
    'https://gwern.net/newsletter/2020/11');
  assert.deepEqual(articleUrls('https://example.com/article', '<a href="https://evil.example/">canonical</a>'),
    ['https://example.com/article']);
  assert.equal(articleUrls('https://gwern.substack.com/p/other', '<a href="http://localhost/private">canonical</a>').length, 1);
});
