import { metric } from '@vercel/functions';
import { emitOriginMetrics, originTelemetry, type RssOriginObservation } from './rss-observability.ts';

export async function monitoredRss(request: Request, feedId: string, run: () => Promise<Response>) {
  if (process.env.VERCEL !== '1' || request.method !== 'GET') return run();
  const start = performance.now();
  const event: RssOriginObservation = { feedId, userAgent: request.headers.get('user-agent') || '',
    status: 500, items: 0, durationMs: 0 };
  try {
    const response = await run();
    event.status = response.status;
    event.items = Number(response.headers.get('X-RSS-Item-Count')) || 0;
    return response;
  } finally {
    event.durationMs = Math.round(performance.now() - start);
    try {
      console.info(JSON.stringify(originTelemetry(event)));
      // Querying custom metrics requires Observability Plus. No paid feature
      // is enabled automatically; CDN Requests and logs work without this flag.
      if (process.env.RSS_CUSTOM_METRICS_ENABLED === 'true') emitOriginMetrics(event, metric);
    } catch {
      console.error('RSS_OBSERVABILITY_EMIT_FAILED');
    }
  }
}
