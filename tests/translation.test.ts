import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assembleTranslation, createTranslationPlan, estimateTokens, parseTranslationResponse, translationVersion } from '../lib/translation-plan.ts';
import { translateArticle } from '../lib/translator.ts';
import { memoryStore } from './memory-store.ts';
import type { ChunkProvider } from '../lib/translator.ts';
import { CHUNK_TOKEN_BUDGET } from '../lib/translation-plan.ts';
import { modelProfile } from '../lib/model-config.ts';

test('long HTML is covered without truncation; code and markup remain exact', () => {
  const content = '<article><h1>Hello</h1><p>' + 'Long text with words. '.repeat(3000) +
    '</p><pre><code>const x = "<tag>";\n' + 'code();\n'.repeat(3000) + '</code></pre><img src="https://example.com/a.png" alt="An image"><p>THE END</p></article>';
  const input = { id: 'long', title: 'Title', content };
  const plan = createTranslationPlan(input);
  assert.ok(plan.chunks.length > 3);
  assert.ok(plan.chunks.every(c => c.units.reduce((n, u) => n + estimateTokens(u.text) + 20, 0) <= CHUNK_TOKEN_BUDGET + 20));
  assert.ok(plan.units.every(u => !u.text.includes('const x')));
  const identity = Object.fromEntries(plan.units.map(u => [u.id, u.text]));
  assert.equal(assembleTranslation(input, plan, identity).translatedContent, content);
  const hostile = { ...identity, [plan.units[1].id]: '<script>alert(1)</script>' };
  const result = assembleTranslation(input, plan, hostile).translatedContent;
  assert.ok(result.includes('&lt;script&gt;'));
  assert.ok(result.includes('<img src="https://example.com/a.png"'));
});

test('Flash uses low reasoning with bounded output and legacy models retain their budgets', () => {
  assert.deepEqual(modelProfile('MiniMax-M3.1-Flash-Preview').output_config, { effort: 'low' });
  assert.equal(modelProfile('MiniMax-M3.1-Flash-Preview').chunkTokens, 3600);
  assert.equal(modelProfile('MiniMax-M2.7').chunkTokens, 1800);
  assert.equal(modelProfile('MiniMax-M2.7').output_config, undefined);
});

test('cache versions include title, body, model, endpoint and prompt revision', () => {
  const base = translationVersion('title', 'body', 'model-a', 'https://api.example.com');
  assert.notEqual(base, translationVersion('changed', 'body', 'model-a', 'https://api.example.com'));
  assert.notEqual(base, translationVersion('title', 'changed', 'model-a', 'https://api.example.com'));
  assert.notEqual(base, translationVersion('title', 'body', 'model-b', 'https://api.example.com'));
  assert.notEqual(base, translationVersion('title', 'body', 'model-a', 'https://other.example.com'));
  const old = process.env.TRANSLATION_PROMPT_VERSION;
  process.env.TRANSLATION_PROMPT_VERSION = 'changed';
  assert.notEqual(base, translationVersion('title', 'body', 'model-a', 'https://api.example.com'));
  if (old === undefined) delete process.env.TRANSLATION_PROMPT_VERSION; else process.env.TRANSLATION_PROMPT_VERSION = old;
});

test('reject incomplete, duplicate and empty model responses', () => {
  const chunk = createTranslationPlan({ id: 'one', title: 'Hi', content: '<p>Hello</p>' }).chunks[0];
  assert.throws(() => parseTranslationResponse('{"translations":[]}', chunk));
  assert.throws(() => parseTranslationResponse('{"translations":[{"id":"title","text":""}]}', chunk));
  assert.throws(() => parseTranslationResponse('{"translations":[{"id":"title","text":"好"},{"id":"title","text":"好"}]}', chunk));
});

test('numeric IDs match only exact expected integers and cannot conceal duplicates', () => {
  const chunk = createTranslationPlan({ id: 'ids', title: 'Title', content: '<p>Hello</p>' }).chunks[0];
  assert.deepEqual(parseTranslationResponse(JSON.stringify({ translations: [
    { id: 'title', text: '标题' }, { id: 1, text: '你好' },
  ] }), chunk), { title: '标题', '1': '你好' });
  for (const id of [1.1, null, {}, '01', 9007199254740992]) {
    assert.throws(() => parseTranslationResponse(JSON.stringify({ translations: [
      { id: 'title', text: '标题' }, { id, text: '你好' },
    ] }), chunk));
  }
  assert.throws(() => parseTranslationResponse(JSON.stringify({ translations: [
    { id: 'title', text: '标题' }, { id: 1, text: '你好' }, { id: '1', text: '重复' },
  ] }), chunk), /Duplicate/);
});

test('dense inline markup has bounded fragment count without losing any source text', () => {
  const input = { id: 'inline', title: 'Links', content: '<p>' +
    Array.from({ length: 180 }, (_, i) => `Some <a href="/${i}">linked words ${i}</a> between links. `).join('') + '</p>' };
  const plan = createTranslationPlan(input);
  assert.ok(plan.chunks.every(c => c.units.length <= 32));
  assert.equal(assembleTranslation(input, plan, Object.fromEntries(plan.units.map(u => [u.id, u.text]))).translatedContent, input.content);
});

test('partial work resumes using immutable chunks and never returns a partial article', async () => {
  const store = memoryStore();
  const input = { id: 'resume', title: 'Title', content: '<p>' + 'Very long article. '.repeat(2000) + '</p>' };
  let calls = 0;
  const provider: ChunkProvider = async chunk => {
    calls++;
    return { texts: Object.fromEntries(chunk.units.map(u => [u.id, `译文 ${u.text}`])), inputTokens: 100, outputTokens: 100 };
  };
  const first = await translateArticle(input, { store, provider, maxChunks: 1 });
  assert.equal(first.complete, false);
  assert.equal(first.result, undefined);
  assert.equal(first.completedChunks, 1);
  const second = await translateArticle(input, { store, provider, maxChunks: Infinity });
  assert.equal(second.complete, true);
  assert.equal(calls, second.totalChunks);
  assert.ok(second.result!.translatedContent.endsWith('</p>'));
  const third = await translateArticle(input, { store, provider, maxChunks: Infinity });
  assert.equal(third.usage.calls, 0);
  assert.equal(third.usage.cacheHits, second.totalChunks);
});

test('expired deadline performs no provider calls', async () => {
  const progress = await translateArticle({ id: 'deadline', title: 'Hi', content: '<p>Hello</p>' }, {
    store: memoryStore(), deadline: Date.now() - 1, provider: async () => { throw new Error('must not run'); },
  });
  assert.equal(progress.complete, false);
  assert.equal(progress.usage.calls, 0);
});

test('provider policy rejection wrapped in HTTP 500 is classified and never immediately retried', async () => {
  let calls = 0;
  const progress = await translateArticle({ id: 'policy', title: 'Title', content: '<p>Original article.</p>' }, {
    store: memoryStore(), provider: async () => {
      calls++;
      throw Object.assign(new Error('500 input new_sensitive (1026)'), { status: 500 });
    },
  });
  assert.equal(calls, 1);
  assert.equal(progress.errorCode, 'provider_content_policy');
  assert.equal(progress.result, undefined);
});
