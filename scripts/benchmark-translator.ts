// Small reproducible quality/cost smoke test using the configured real model.
// It does not change provider or claim that this sample ranks all models.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { list, del } from '@vercel/blob';
import { writeFile } from 'node:fs/promises';
import { translateArticle, MODEL_NAME, defaultProvider } from '../lib/translator.ts';
import { hashGuid } from '../lib/chunk-cache.ts';
import { stateBlobOptions } from '../lib/json-store.ts';
import { createTranslationPlan } from '../lib/translation-plan.ts';

const id = `translation-smoke-${randomUUID()}`;
const code = '<pre><code>' + 'const value = "do not translate";\n'.repeat(600) + '</code></pre>';
const long = process.argv.includes('--long');
const prose = Array.from({ length: 18 }, (_, i) => `<p>Section ${i + 1}. A reliable RSS pipeline separates discovery from translation and publication. ` +
  'Each article has a stable identifier and a durable record of completed work. ' +
  'Workers may stop when their time budget is exhausted, then resume without translating the same fragments again. ' +
  'Conditional writes prevent concurrent workers from silently replacing newer records. ' +
  'A larger context window helps keep related paragraphs together, but output generation still takes time. ' +
  'Only complete translations should appear in the public feed; partial results remain private checkpoints.</p>').join('');
const input = { id, title: 'Resumable RSS translation', content: '<article><p>Retries must preserve completed work. ' +
  'Only publish an article after every fragment is translated.</p>' + (long ? prose : '') + code +
  '<p>The final paragraph must also be translated.</p><img src="https://example.com/chart.png" alt="Queue progress"></article>' };
const started = Date.now();
try {
  const result = await translateArticle(input, { maxChunks: long ? 4 : 2, deadline: Date.now() + (long ? 220_000 : 110_000),
    provider: async (chunk, signal) => {
      const start = Date.now();
      const result = await defaultProvider(chunk, signal);
      console.log(JSON.stringify({ chunk: chunk.index, elapsedMs: Date.now() - start,
        inputTokens: result.inputTokens, outputTokens: result.outputTokens }));
      return result;
    } });
  assert.equal(result.complete, true, result.error);
  assert.ok(result.result!.translatedContent.includes(code));
  assert.ok(result.result!.translatedContent.includes('src="https://example.com/chart.png"'));
  assert.match(result.result!.translatedTitle, /[\u3400-\u9fff]/);
  assert.ok(!result.result!.translatedContent.includes('The final paragraph must also be translated.'));
  assert.equal((result.result!.translatedContent.match(/<p>/g) || []).length, long ? 20 : 2);
  if (long) assert.ok(!result.result!.translatedContent.includes('A reliable RSS pipeline separates'));
  const report = { model: MODEL_NAME, checkedAt: new Date().toISOString(), originalCharacters: input.content.length,
    proseCharacters: long ? prose.length : 0,
    oldBudgetChunks: createTranslationPlan(input, 1800).chunks.length,
    elapsedMs: Date.now() - started, chunks: result.totalChunks, usage: result.usage,
    translatedTitle: result.result!.translatedTitle,
    translatedTail: result.result!.translatedContent.slice(-350),
    codeAndLinksPreserved: true, complete: true,
    note: 'Single configured-model smoke test; model quality ranking requires a multi-model blind review.' };
  await writeFile('/tmp/rss-translation-smoke.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
} finally {
  const prefix = `feeds/_chunks/v3/${hashGuid(id)}/`;
  let cursor: string | undefined;
  do {
    const page = await list({ ...stateBlobOptions(), prefix, cursor });
    if (page.blobs.length) await del(page.blobs.map(b => b.pathname), stateBlobOptions());
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
}
