// Full translations can exceed Vercel's buffered response size limit. Stream
// UTF-8 bytes with backpressure rather than dropping articles or truncating XML.
export function rssResponse(xml: string, itemCount?: number): Response {
  const bytes = new TextEncoder().encode(xml);
  let offset = 0;
  return new Response(new ReadableStream<Uint8Array>({
    pull(controller) {
      const end = Math.min(offset + 64 * 1024, bytes.length);
      if (offset < end) controller.enqueue(bytes.subarray(offset, end));
      offset = end;
      if (offset === bytes.length) controller.close();
    },
  }), { headers: {
    'Content-Type': 'application/rss+xml; charset=utf-8',
    'Cache-Control': 'public, max-age=300, s-maxage=300',
    ...(itemCount !== undefined ? { 'X-RSS-Item-Count': String(itemCount) } : {}),
  } });
}
