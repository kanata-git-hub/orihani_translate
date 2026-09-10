import type { Express } from 'express';

interface Photo { id: string; imageUrl: string; postUrl: string; alt: string; createdAt: string }
const account = 'ngnchiikawa';
const ttl = 15 * 60 * 1000;
export function registerChiikawa(app: Express) {
  registerPublicChiikawa(app);
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

export function parseChiikawaPostUrl(value: unknown): { id: string; photoIndex?: number } | null {
  if (typeof value !== 'string' || value.length > 2048) return null;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== 'https:' || url.username || url.password || url.port || !['x.com', 'www.x.com', 'twitter.com', 'www.twitter.com', 'mobile.twitter.com'].includes(url.hostname)) return null;
    const match = url.pathname.match(/^\/ngnchiikawa\/status\/(\d{10,25})(?:\/photo\/([1-4]))?\/?$/i);
    return match ? { id: match[1], ...(match[2] ? { photoIndex: Number(match[2]) - 1 } : {}) } : null;
  } catch { return null; }
}

interface PublicPhoto { postId: string; index: number; postUrl: string; thumbnailUrl: string; createdAt: string }
class PublicPostError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}
async function readLimited(response: Response, limit: number): Promise<Buffer> {
  if (Number(response.headers.get('content-length')) > limit) throw new Error('Response too large');
  const reader = response.body?.getReader(); if (!reader) throw new Error('Empty response');
  const parts: Uint8Array[] = []; let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      length += value.length; if (length > limit) throw new Error('Response too large'); parts.push(value);
    }
  } catch (error) { await reader.cancel().catch(() => {}); throw error; }
  return Buffer.concat(parts);
}

// Public embed data for a user-selected post. This does not enumerate a timeline,
// use a developer key, or access private/login-only content.
function registerPublicChiikawa(app: Express) {
  type Post = { photos: { url: string; view: PublicPhoto }[]; expires: number };
  const cache = new Map<string, Post>();
  const pending = new Map<string, Promise<Post>>();
  let cooldownUntil = 0;
  let windowStart = 0, lookups = 0;
  const loadPost = async (id: string): Promise<Post> => {
    const cached = cache.get(id); if (cached && cached.expires > Date.now()) return cached;
    const inFlight = pending.get(id); if (inFlight) return inFlight;
    if (Date.now() < cooldownUntil) throw new PublicPostError(429, 'X가 잠시 요청을 제한하고 있어요. 조금 뒤에 다시 시도해 주세요.');
    if (Date.now() - windowStart > 60000) { windowStart = Date.now(); lookups = 0; }
    if (++lookups > 30 || pending.size >= 4) throw new PublicPostError(429, '잠시 뒤에 다시 불러와 주세요.');
    const request = (async () => {
      const url = new URL('https://cdn.syndication.twimg.com/tweet-result');
      url.searchParams.set('id', id); url.searchParams.set('lang', 'ko');
      // Public embed checksum, also used by vercel/react-tweet (MIT).
      url.searchParams.set('token', ((Number(id) / 1e15) * Math.PI).toString(36).replace(/(0+|\.)/g, ''));
      const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(15000) });
      if (response.status === 429) { cooldownUntil = Date.now() + 60000; throw new PublicPostError(429, 'X가 잠시 요청을 제한하고 있어요. 조금 뒤에 다시 시도해 주세요.'); }
      if (!response.ok) throw new PublicPostError(response.status === 404 ? 404 : 502, 'X에서 공개 게시물을 불러오지 못했어요.');
      const data = JSON.parse((await readLimited(response, 1024 * 1024)).toString('utf8'));
      if (data.__typename !== 'Tweet' || data.id_str !== id || data.user?.screen_name?.toLowerCase() !== account) throw new PublicPostError(404, '작가의 공개 게시물인지 확인해 주세요. 삭제되거나 비공개인 글은 불러올 수 없어요.');
      const photos: Post['photos'] = [];
      for (const media of (Array.isArray(data.mediaDetails) ? data.mediaDetails : []).slice(0, 4)) {
        if (media.type !== 'photo' || typeof media.media_url_https !== 'string') continue;
        const image = new URL(media.media_url_https);
        if (image.protocol !== 'https:' || image.hostname !== 'pbs.twimg.com' || image.port || image.username || image.password || !/^\/media\/[A-Za-z0-9_-]+\.(jpg|png|webp)$/.test(image.pathname)) continue;
        const index = photos.length;
        photos.push({ url: image.href, view: { postId: id, index, postUrl: `https://x.com/${account}/status/${id}/photo/${index + 1}`, thumbnailUrl: `/api/chiikawa/public-image/${id}/${index}?size=thumb`, createdAt: typeof data.created_at === 'string' ? data.created_at : '' } });
      }
      if (!photos.length) throw new PublicPostError(404, '이 게시물에는 가져올 사진이 없어요.');
      if (cache.size >= 100) cache.delete(cache.keys().next().value!);
      const result = { photos, expires: Date.now() + 10 * 60000 }; cache.set(id, result); return result;
    })().finally(() => pending.delete(id));
    pending.set(id, request); return request;
  };
  const fail = (res: any, error: unknown) => res.status(error instanceof PublicPostError ? error.status : 502).json({ error: error instanceof PublicPostError ? error.message : '사진을 불러오지 못했어요. 링크를 확인하거나 이미지를 직접 선택해 주세요.' });
  app.get('/api/chiikawa/post', async (req, res) => {
    const parsed = parseChiikawaPostUrl(req.query.url);
    if (!parsed) { res.status(400).json({ error: '작가의 게시물 링크를 넣어 주세요. 예: x.com/ngnchiikawa/status/…' }); return; }
    try {
      const post = await loadPost(parsed.id);
      const photos = post.photos.map(p => p.view);
      if (parsed.photoIndex !== undefined && !photos[parsed.photoIndex]) throw new PublicPostError(404, '선택한 사진이 없어요.');
      res.set('Cache-Control', 'no-store').json({ photos, selectedIndex: parsed.photoIndex });
    } catch (error) { fail(res, error); }
  });
  app.get('/api/chiikawa/public-image/:postId/:index', async (req, res) => {
    if (!/^\d{10,25}$/.test(req.params.postId) || !/^[0-3]$/.test(req.params.index)) { res.sendStatus(400); return; }
    try {
      const post = await loadPost(req.params.postId);
      const photo = post.photos[Number(req.params.index)]; if (!photo) throw new PublicPostError(404, '사진이 없어요.');
      const url = new URL(photo.url); url.searchParams.set('name', req.query.size === 'thumb' ? 'small' : 'orig');
      const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(20000) });
      const type = response.headers.get('content-type')?.split(';')[0];
      if (!response.ok || !['image/jpeg', 'image/png', 'image/webp'].includes(type || '')) throw new Error('Invalid image response');
      const data = await readLimited(response, 12 * 1024 * 1024);
      res.set('Cache-Control', 'private, max-age=300').set('X-Content-Type-Options', 'nosniff').type(type!).send(data);
    } catch (error) { fail(res, error); }
  });
}
