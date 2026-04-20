export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function stripHtmlTags(html: string): string {
  return html.replace(/<[^>]*>/g, '').trim();
}

// 超长文章段落边界截断；用于长文 feed（gwern/dwarkesh 等）控制翻译单次耗时
// 优先在 </p>/</div>/</li>/双换行/最后一个空格 处断开，最后才硬切
export function truncateAtParagraph(html: string, maxChars: number): string {
  if (html.length <= maxChars) return html;

  const window = html.slice(0, maxChars);
  const boundaries = [
    window.lastIndexOf('</p>'),
    window.lastIndexOf('</div>'),
    window.lastIndexOf('</li>'),
    window.lastIndexOf('\n\n'),
  ];
  // 在最后 20% 窗口内找到的边界才算有效，避免把长文砍到开头
  const minCut = Math.floor(maxChars * 0.8);
  const boundary = boundaries
    .filter(idx => idx >= minCut)
    .reduce((max, idx) => Math.max(max, idx), -1);

  let cutAt: number;
  if (boundary > 0) {
    // 边界本身包含闭标签末尾，把它保留
    const closer = window.slice(boundary).match(/^<\/(?:p|div|li)>/);
    cutAt = closer ? boundary + closer[0].length : boundary;
  } else {
    // fallback：最后一个空格处断（避免砍在词中间）
    const sp = window.lastIndexOf(' ');
    cutAt = sp > minCut ? sp : maxChars;
  }
  const truncated = html.slice(0, cutAt);
  return `${truncated}\n<!-- truncated at ${cutAt} of ${html.length} chars -->`;
}
