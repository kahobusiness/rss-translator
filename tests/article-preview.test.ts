import assert from 'node:assert/strict';
import { test } from 'node:test';
import { latestTranslation, articleExcerpt, readableArticleHtml, articleDate } from '../lib/article-preview.ts';
import type { TranslatedItem } from '../lib/storage.ts';

test('preview picks latest published success from the individual archive', () => {
  const item = (pubDate: string, translated = true) => ({ pubDate, translated, translatedTitle: '译文', translatedContent: '<p>正文</p>' }) as TranslatedItem;
  assert.equal(latestTranslation([item('2026-01-01'), item('2026-01-03', false), item('2026-01-02')])?.pubDate, '2026-01-02');
  assert.equal(latestTranslation([]), undefined);
});

test('excerpt decodes entities, separates paragraphs and skips executable content', () => {
  assert.equal(articleExcerpt('<p>你好 &amp; 世界</p><script>hidden</script><p>正文</p>'), '你好 & 世界 正文');
  assert.equal(articleExcerpt('<p>你好世界</p>', 3), '你好世…');
  assert.equal(articleDate('1970-01-01'), null);
  assert.equal(articleDate('invalid'), null);
});

test('reading HTML preserves article structure while removing active content and unsafe URLs', () => {
  const result = readableArticleHtml('<p onclick="bad()">正文 <strong>重点</strong></p><script>bad()</script>' +
    '<iframe src="https://evil.test"></iframe><a href="javascript:bad()">bad</a>' +
    '<a href="/post">原文</a><img src="/photo.jpg" onerror="bad()"><pre>&lt;code&gt;</pre>' +
    '<svg><a href="https://evil.test">hidden</a></svg>', 'https://example.com/article');
  assert.ok(result.includes('<strong>重点</strong>'));
  assert.ok(result.includes('href="https://example.com/post"'));
  assert.ok(result.includes('src="https://example.com/photo.jpg"'));
  assert.ok(result.includes('<pre>&lt;code&gt;</pre>'));
  assert.doesNotMatch(result, /onclick|onerror|javascript:|iframe|script|svg|hidden|bad\(\)/);
});
