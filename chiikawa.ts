import type { Express } from 'express';

interface Photo { id: string; imageUrl: string; postUrl: string; alt: string; createdAt: string }
const account = 'ngnchiikawa';
const ttl = 15 * 60 * 1000;
export function registerChiikawa(app: Express) {
  let cache: { photos: Photo[]; expires: number } | undefined;
  let pending: Promise<Photo[]> | undefined;
  let userId: string | undefined;
  const api = async (path: string) => {
    const response = await fetch(`https://api.x.com/2/${path}`, {
      headers: { Authorization: `Bearer ${process.env.X_BEARER_TOKEN}` },
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw new Error(`X API ${response.status}`);
    return response.json();
  };
  const load = async () => {
    if (cache && cache.expires > Date.now()) return cache.photos;
    if (pending) return pending;
    pending = (async () => {
      if (!userId) userId = (await api(`users/by/username/${account}`)).data?.id;
      if (!userId || !/^\d+$/.test(userId)) throw new Error('Account unavailable');
      const photos: Photo[] = [];
      let token: string | undefined;
      for (let page = 0; page < 3 && photos.length < 9; page++) {
        const params = new URLSearchParams({ max_results: '100', exclude: 'retweets', 'tweet.fields': 'created_at,attachments', expansions: 'attachments.media_keys', 'media.fields': 'url,type,alt_text' });
        if (token) params.set('pagination_token', token);
        const data = await api(`users/${userId}/tweets?${params}`);
        if (data.errors?.length) throw new Error('Incomplete X response');
        const media = new Map<string, any>((data.includes?.media || []).map((m: any) => [m.media_key, m]));
        for (const post of data.data || []) {
          for (const key of post.attachments?.media_keys || []) {
            const item = media.get(key);
            if (item?.type !== 'photo' || typeof item.url !== 'string') continue;
            const url = new URL(item.url);
            if (url.protocol !== 'https:' || url.hostname !== 'pbs.twimg.com' || !url.pathname.startsWith('/media/')) continue;
            photos.push({ id: `${post.id}_${key}`, imageUrl: url.href, postUrl: `https://x.com/${account}/status/${post.id}`, alt: item.alt_text || '', createdAt: post.created_at });
          }
        }
        token = data.meta?.next_token;
        if (!token) break;
      }
      photos.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      cache = { photos: photos.slice(0, 9), expires: Date.now() + ttl };
      return cache.photos;
    })().finally(() => { pending = undefined; });
    return pending;
  };
  app.get('/api/chiikawa/photos', async (_req, res) => {
    if (!process.env.X_BEARER_TOKEN) { res.json({ configured: false, photos: [] }); return; }
    try { res.json({ configured: true, photos: await load() }); }
    catch { res.status(502).json({ error: '최신 사진을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.' }); }
  });
  // Only IDs in the server's official-account feed can be fetched, never arbitrary URLs.
  app.get('/api/chiikawa/image/:id', async (req, res) => {
    if (!process.env.X_BEARER_TOKEN) { res.sendStatus(503); return; }
    try {
      const photo = (await load()).find(photo => photo.id === req.params.id);
      if (!photo) { res.sendStatus(404); return; }
      const response = await fetch(photo.imageUrl, { redirect: 'error', signal: AbortSignal.timeout(15000) });
      const type = response.headers.get('content-type')?.split(';')[0];
      if (!response.ok || !['image/jpeg', 'image/png', 'image/webp'].includes(type || '')) throw new Error('Invalid image');
      const reader = response.body!.getReader();
      const chunks: Uint8Array[] = []; let size = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > 12 * 1024 * 1024) { await reader.cancel(); throw new Error('Image too large'); }
        chunks.push(value);
      }
      res.type(type!).send(Buffer.concat(chunks));
    } catch { res.sendStatus(502); }
  });
}
