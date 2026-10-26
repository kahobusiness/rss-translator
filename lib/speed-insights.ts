// Measure public pages without transmitting article GUIDs or other URL parameters.
export function publicPerformanceEvent<T extends { url: string }>(event: T): T | null {
  try {
    const url = new URL(event.url);
    if (!['https:', 'http:'].includes(url.protocol) ||
        (url.pathname !== '/' && !/^\/read\/[a-z0-9-]{1,80}\/?$/.test(url.pathname))) return null;
    return { ...event, url: `${url.origin}${url.pathname}` };
  } catch { return null; }
}
