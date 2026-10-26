// Public homepage only. Never send monitoring/API URLs, query parameters,
// fragments, credentials, or arbitrary clipboard content to Web Analytics.
export function publicAnalyticsEvent<T extends { url: string }>(event: T): T | null {
  try {
    const url = new URL(event.url);
    if (!['https:', 'http:'].includes(url.protocol) || url.pathname !== '/') return null;
    return { ...event, url: `${url.origin}/` };
  } catch { return null; }
}

export function subscriptionCopyProperties(path: string) {
  const match = /^\/api\/feed\/([a-z0-9-]{1,80})$/.exec(path);
  if (!match) return null;
  return { feed_id: match[1], feed_type: match[1] === 'all' ? 'aggregate' : 'single' };
}
