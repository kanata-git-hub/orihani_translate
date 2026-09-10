// X sometimes shares a URL inside text instead of the share sheet's URL field.
export function extractChiikawaPost(values: string[]): string | null {
  for (const value of values) {
    if (typeof value !== 'string' || value.length > 8192) continue;
    const candidates = value.match(/https:\/\/[^\s<>"'「」]+/gi) || [];
    for (const candidate of candidates) {
      try {
        const url = new URL(candidate.replace(/[)\]。.,!?]+$/, ''));
        if (url.protocol !== 'https:' || url.username || url.password || url.port) continue;
        if (!['x.com', 'www.x.com', 'twitter.com', 'www.twitter.com', 'mobile.twitter.com'].includes(url.hostname)) continue;
        const match = url.pathname.match(/^\/ngnchiikawa\/status\/(\d{10,25})(?:\/photo\/([1-4]))?\/?$/i);
        if (match) return `https://x.com/ngnchiikawa/status/${match[1]}${match[2] ? `/photo/${match[2]}` : ''}`;
      } catch { /* Ignore invalid URLs and try another shared field. */ }
    }
  }
  return null;
}

export function readSharedPost(search: string, hash: string): string | null {
  if (search.length + hash.length > 16384) return null;
  const params = new URLSearchParams(search);
  let shortcutInput = hash.slice(1);
  try { shortcutInput = decodeURIComponent(shortcutInput); } catch { /* Malformed input will fail URL validation. */ }
  return extractChiikawaPost([params.get('url') || '', params.get('text') || '', params.get('title') || '', shortcutInput]);
}
