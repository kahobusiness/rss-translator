import Anthropic from '@anthropic-ai/sdk';
import { getChunkCache, setCachedChunk } from './chunk-cache.ts';
import { assembleTranslation, createTranslationPlan, parseTranslationResponse, SYSTEM_PROMPT } from './translation-plan.ts';
import type { TranslationChunk, TranslationInput } from './translation-plan.ts';
import type { JsonStore } from './json-store.ts';
import { API_BASE_URL, MODEL_NAME, modelProfile } from './model-config.ts';
export { MODEL_NAME } from './model-config.ts';
export type { TranslationInput } from './translation-plan.ts';

export interface TranslationResult { translatedTitle: string; translatedContent: string }
export interface Usage { calls: number; cacheHits: number; inputTokens: number; outputTokens: number }
export type ChunkProvider = (chunk: TranslationChunk, signal: AbortSignal) => Promise<{
  texts: Record<string, string>; inputTokens: number; outputTokens: number;
}>;
export interface ArticleProgress {
  complete: boolean;
  completedChunks: number;
  totalChunks: number;
  version: string;
  usage: Usage;
  result?: TranslationResult;
  error?: string;
  errorCode?: string;
}

let client: Anthropic | undefined;

export const defaultProvider: ChunkProvider = async (chunk, signal) => {
  const key = process.env.API_KEY || process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error('Translation API credentials are missing');
  const official = /(^|\.)anthropic\.com$/i.test(new URL(API_BASE_URL).hostname);
  client ??= new Anthropic({ ...(official ? { apiKey: key } : { authToken: key }),
    baseURL: API_BASE_URL, maxRetries: 0 });
  const profile = modelProfile();
  // MiniMax's documented extension is structurally passed through the SDK.
  const message = await client.messages.create({
    ...(profile.output_config ? { output_config: profile.output_config } : {}),
    model: MODEL_NAME, max_tokens: profile.maxOutputTokens, system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: JSON.stringify({ fragments: chunk.units.map(({ id, text }) => ({ id, text })) }) }],
  }, { signal });
  if (message.stop_reason !== 'end_turn') throw new Error(`Incomplete model output: ${message.stop_reason}`);
  const text = message.content.filter(block => block.type === 'text').map(block => 'text' in block ? block.text : '').join('');
  return { texts: parseTranslationResponse(text, chunk), inputTokens: message.usage.input_tokens +
    (message.usage.cache_read_input_tokens || 0) + (message.usage.cache_creation_input_tokens || 0),
    outputTokens: message.usage.output_tokens };
};

export async function translateArticle(input: TranslationInput, options: {
  deadline?: number; maxChunks?: number; budget?: { remaining: number };
  store?: JsonStore; provider?: ChunkProvider;
} = {}): Promise<ArticleProgress> {
  const plan = createTranslationPlan(input);
  const deadline = options.deadline ?? Date.now() + 220_000;
  const provider = options.provider ?? defaultProvider;
  const usage: Usage = { calls: 0, cacheHits: 0, inputTokens: 0, outputTokens: 0 };
  const texts: Record<string, string> = {};
  const cache = await getChunkCache(input.id, plan.version, options.store);
  let completedChunks = 0;
  let launched = 0;
  let failure: { error?: string; errorCode?: string } = {};
  // Continue looking up cached chunks even after the launch budget is exhausted,
  // so progress and completion remain correct when resuming a very long article.
  for (const chunk of plan.chunks) {
    if (Date.now() >= deadline - 5000) break;
    const cached = cache[`${chunk.index}-${chunk.hash}`];
    if (cached) {
      Object.assign(texts, cached.texts); completedChunks++; usage.cacheHits++; continue;
    }
    if (launched >= (options.maxChunks ?? 2) || (options.budget && options.budget.remaining <= 0)) continue;
    launched++;
    try {
      let result: Awaited<ReturnType<ChunkProvider>> | undefined;
      for (let attempt = 0; attempt < 2; attempt++) {
        const remaining = deadline - Date.now() - 5000;
        if (remaining <= 0) break;
        const signal = AbortSignal.timeout(Math.min(modelProfile().timeoutMs, remaining));
        if (options.budget && options.budget.remaining <= 0) break;
        if (options.budget) options.budget.remaining--;
        usage.calls++;
        try { result = await provider(chunk, signal); break; }
        catch (error) {
          const status = (error as { status?: number }).status;
          if (attempt || !(status === 429 || (status && status >= 500)) || remaining < 10_000) throw error;
          await new Promise(resolve => setTimeout(resolve, 500 + Math.random() * 500));
        }
      }
      if (!result) break;
      // Validate even injected/test providers before persisting or publishing.
      for (const unit of chunk.units) if (!result.texts[unit.id]?.trim()) throw new Error(`Missing translation: ${unit.id}`);
      usage.inputTokens += result.inputTokens;
      usage.outputTokens += result.outputTokens;
      await setCachedChunk(input.id, plan.version, chunk.index, chunk.hash,
        { ...result, cachedAt: new Date().toISOString() }, options.store);
      Object.assign(texts, result.texts); completedChunks++;
    } catch (error) {
      if (Date.now() >= deadline - 5000) break;
      failure = { error: error instanceof Error ? error.message.slice(0, 300) : 'Translation failed',
        errorCode: String((error as { status?: number }).status || (error as { name?: string }).name || 'translation_error') };
      break;
    }
  }
  const complete = completedChunks === plan.chunks.length;
  return { complete, completedChunks, totalChunks: plan.chunks.length, version: plan.version, usage,
    ...(complete ? { result: assembleTranslation(input, plan, texts) } : failure) };
}

export async function translateBatch(items: TranslationInput[], deadline?: number) {
  const results = new Map<string, TranslationResult>();
  for (const item of items) {
    const progress = await translateArticle(item, { deadline, maxChunks: Infinity });
    if (progress.result) results.set(item.id, progress.result);
  }
  return results;
}
