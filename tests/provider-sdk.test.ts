import assert from 'node:assert/strict';
import { test } from 'node:test';
import { defaultProvider } from '../lib/translator.ts';
import { createTranslationPlan } from '../lib/translation-plan.ts';

test('native-fetch SDK preserves translation tool request, authentication and response parsing', async t => {
  const previous = process.env.API_KEY;
  process.env.API_KEY = 'test-only-sdk-key';
  t.after(() => { if (previous === undefined) delete process.env.API_KEY; else process.env.API_KEY = previous; });
  const chunk = createTranslationPlan({ id: 'sdk-test', title: 'Hello', content: '<p>World</p>' }).chunks[0];
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    calls++;
    const request = new Request(input, init);
    assert.ok(request.url.endsWith('/messages'));
    assert.ok(request.headers.get('authorization') === 'Bearer test-only-sdk-key' ||
      request.headers.get('x-api-key') === 'test-only-sdk-key');
    const body = await request.json();
    assert.equal(body.tool_choice.name, 'submit_translation');
    assert.deepEqual(body.tools[0].input_schema.properties.translations.required, chunk.units.map(u => u.id));
    return Response.json({ id: 'msg_test', type: 'message', role: 'assistant', model: body.model,
      content: [{ type: 'tool_use', id: 'tool_test', name: 'submit_translation',
        input: { translations: Object.fromEntries(chunk.units.map(u => [u.id, '译文'])) } }],
      stop_reason: 'tool_use', stop_sequence: null, usage: { input_tokens: 12, output_tokens: 8 } });
  });
  const result = await defaultProvider(chunk, AbortSignal.timeout(5000));
  assert.equal(calls, 1);
  assert.equal(result.inputTokens, 12);
  assert.equal(result.outputTokens, 8);
  assert.equal(Object.keys(result.texts).length, chunk.units.length);
});
