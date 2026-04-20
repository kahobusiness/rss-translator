import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// 临时调试端点：直接打 MiniMax，返回原始响应/错误，定位 auth vs format
export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  const auth = request.headers.get('authorization');
  if (cronSecret && auth !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const baseURL = process.env.API_BASE_URL || process.env.ANTHROPIC_BASE_URL || 'https://api.minimaxi.com/anthropic';
  const key = process.env.API_KEY || process.env.ANTHROPIC_API_KEY || '';
  const model = process.env.MODEL_NAME || 'MiniMax-M2.7';
  const isOfficial = /(^|\.)anthropic\.com$/i.test(new URL(baseURL).hostname);

  const meta = {
    baseURL,
    model,
    keyLen: key.length,
    keyPrefix: key.slice(0, 6),
    isOfficial,
    authStrategy: isOfficial ? 'apiKey/x-api-key' : 'authToken/Authorization Bearer',
  };

  const client = new Anthropic({
    ...(isOfficial ? { apiKey: key } : { authToken: key }),
    baseURL,
  });

  try {
    const msg = await client.messages.create({
      model,
      max_tokens: 200,
      system: 'You are a translator. Output only Chinese.',
      messages: [{ role: 'user', content: 'Translate to Chinese: hello world' }],
    });
    const block = msg.content.find(b => b.type === 'text');
    const text = block && 'text' in block ? block.text : '';
    return NextResponse.json({
      ok: true,
      meta,
      stopReason: msg.stop_reason,
      usage: msg.usage,
      text,
    });
  } catch (e) {
    const err = e as { status?: number; message?: string; error?: unknown };
    return NextResponse.json({
      ok: false,
      meta,
      status: err.status,
      message: err.message?.slice(0, 800),
      error: err.error,
    });
  }
}
