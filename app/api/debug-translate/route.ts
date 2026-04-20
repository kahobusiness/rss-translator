import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { parseFeed } from '@/lib/rss-parser';
import { needsFetch, fetchArticleContent } from '@/lib/article-fetcher';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

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

  // 用真实 feed 的前 N 条（与 cron 完全一致），定位 batch 失败的真实原因
  const feedUrl = request.nextUrl.searchParams.get('feed') || 'https://krebsonsecurity.com/feed/';
  const n = Math.min(parseInt(request.nextUrl.searchParams.get('n') || '3', 10), 5);
  const enrich = request.nextUrl.searchParams.get('enrich') !== '0';
  let items: { title: string; content: string; link?: string }[];
  try {
    const feed = await parseFeed(feedUrl);
    items = feed.items.slice(0, n).map(i => ({ title: i.title, content: i.content, link: i.link }));
  } catch (e) {
    return NextResponse.json({ ok: false, meta, fetchError: (e as Error).message });
  }
  // 模拟 cron：对短文抓全文
  const enrichInfo: { id: number; before: number; after: number; fetched: boolean }[] = [];
  if (enrich) {
    for (let idx = 0; idx < items.length; idx++) {
      const it = items[idx];
      const before = it.content.length;
      let fetched = false;
      if (needsFetch(it.content) && it.link) {
        const full = await fetchArticleContent(it.link);
        if (full) { it.content = full; fetched = true; }
      }
      enrichInfo.push({ id: idx + 1, before, after: it.content.length, fetched });
    }
  }
  const inputCharsList = items.map(i => i.title.length + i.content.length);
  const articlesText = items.map((it, i) => `---文章${i + 1}---\n标题: ${it.title}\n内容: ${it.content}`).join('\n\n');
  const formatExample = items.map((_, i) => {
    const t = `ARTICLE_${i + 1}`;
    return `<${t}_TITLE>\n翻译后的标题\n</${t}_TITLE>\n<${t}_CONTENT>\n翻译后的内容\n</${t}_CONTENT>`;
  }).join('\n');
  const userPrompt = `将以下${items.length}篇RSS文章翻译成中文。保持原文的HTML格式，翻译要自然流畅。\n\n${articlesText}\n\n请严格按以下格式返回每篇文章的翻译结果：\n${formatExample}`;
  const SYSTEM_PROMPT = `你是一位专业的英中翻译。请遵循以下规则：\n- 翻译 RSS 文章的标题和正文为中文\n- 保持原文的 HTML 标签和结构不变\n- 代码块、命令行、变量名保持原文不翻译\n- 技术术语首次出现时使用"中文（English）"格式，后续直接使用中文\n- URL 和链接地址保持原文不变\n- 图片的 alt 文本需要翻译\n- 译文应自然流畅，不要翻译腔`;

  try {
    const t0 = Date.now();
    const msg = await client.messages.create({
      model,
      max_tokens: 50000,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userPrompt }],
    });
    const elapsedMs = Date.now() - t0;
    const block = msg.content.find(b => b.type === 'text');
    const text = block && 'text' in block ? block.text : '';
    const tagsFound: Record<string, { title: boolean; content: boolean }> = {};
    for (let i = 1; i <= items.length; i++) {
      tagsFound[`ARTICLE_${i}`] = {
        title: new RegExp(`<ARTICLE_${i}_TITLE>[\\s\\S]*?</ARTICLE_${i}_TITLE>`).test(text),
        content: new RegExp(`<ARTICLE_${i}_CONTENT>[\\s\\S]*?</ARTICLE_${i}_CONTENT>`).test(text),
      };
    }
    return NextResponse.json({
      ok: true,
      meta,
      feedUrl,
      itemCount: items.length,
      enrichInfo,
      inputCharsList,
      stopReason: msg.stop_reason,
      usage: msg.usage,
      elapsedMs,
      textLen: text.length,
      tagsFound,
      tail: text.slice(-400),
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
