import type { RequestHandler } from 'express';

// Public Firebase app configuration. Server credentials never enter the browser.
const WEB_KEY = 'AIzaSyCtEbU2W0VZdxN45JVOdYtaxwe5tSg2bjY';
const DATABASE = 'ai-studio-17ef26a9-06ef-4913-97a0-d4e053a01777';
export const ACCESS_POLICY = 'approved' as string;
const OWNER = 'kanata840@gmail.com';
export type AppUser = { uid: string; email: string };

export async function verifyAppUser(token: unknown, request: typeof fetch = fetch): Promise<AppUser> {
  if (typeof token !== 'string' || token.length < 20 || token.length > 8192) throw Error('AUTH_REQUIRED');
  const lookup = await request(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${WEB_KEY}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ idToken: token }),
    signal: AbortSignal.timeout(8000), redirect: 'error',
  });
  if (!lookup.ok) throw Error(lookup.status >= 500 || lookup.status === 429 ? 'AUTH_UNAVAILABLE' : 'AUTH_REQUIRED');
  const account = (await lookup.json()).users?.[0];
  if (typeof account?.localId !== 'string' || typeof account.email !== 'string' || account.disabled || account.emailVerified !== true) throw Error('AUTH_REQUIRED');
  const user = { uid: account.localId, email: account.email };
  if (account.email === OWNER || ACCESS_POLICY === 'signed-in') return user;
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
  const base = `https://firestore.googleapis.com/v1/projects/gen-lang-client-0165298283/databases/${DATABASE}/documents`;
  if (ACCESS_POLICY === 'users') {
    // Keep support for both email document IDs and the older auto-ID records.
    const direct = await request(`${base}/users/${encodeURIComponent(account.email.toLowerCase().trim())}`, {
      headers, signal: AbortSignal.timeout(8000), redirect: 'error',
    });
    if (direct.ok) {
      const role = (await direct.json()).fields?.role?.stringValue;
      if (role === 'admin' || role === 'user') return user;
    } else if (![403, 404].includes(direct.status)) throw Error('AUTH_UNAVAILABLE');
  }
  const collectionId = ACCESS_POLICY === 'users' ? 'users' : 'approved_users';
  const response = await request(`${base}:runQuery`, {
    method: 'POST', headers,
    body: JSON.stringify({ structuredQuery: { from: [{ collectionId }],
      where: { fieldFilter: { field: { fieldPath: 'email' }, op: 'EQUAL', value: { stringValue: account.email } } }, limit: 1 } }),
    signal: AbortSignal.timeout(8000), redirect: 'error',
  });
  if (!response.ok) throw Error(response.status === 403 ? 'APPROVAL_REQUIRED' : 'AUTH_UNAVAILABLE');
  const rows = await response.json();
  const approved = Array.isArray(rows) && rows.some(row => row.document?.fields?.email?.stringValue === account.email &&
    (ACCESS_POLICY !== 'users' || ['admin', 'user'].includes(row.document?.fields?.role?.stringValue)));
  if (!approved) throw Error('APPROVAL_REQUIRED');
  return user;
}

// Checked before large JSON bodies or any paid model call. Preserve each app's existing access policy.
export function authenticatedApi(verify = verifyAppUser): RequestHandler {
  const buckets = new Map<string, { start: number; count: number; active: number }>();
  let verifying = 0;
  return async (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    const token = req.headers.authorization?.match(/^Bearer ([^\s]+)$/i)?.[1];
    if (!token) { res.status(401).json({ error: '로그인 후 사용해주세요.' }); return; }
    if (verifying >= 64) { res.status(429).json({ error: '요청이 많습니다. 잠시 후 다시 시도해주세요.' }); return; }
    verifying++;
    let user: AppUser;
    try { user = await verify(token); }
    catch (error) {
      const reason = error instanceof Error ? error.message : '';
      const status = reason === 'AUTH_REQUIRED' ? 401 : reason === 'APPROVAL_REQUIRED' ? 403 : 503;
      res.status(status).json({ error: status === 403 ? '사용 권한이 없습니다.' : status === 401 ? '로그인을 다시 확인해주세요.' : '로그인 확인 서비스에 일시적으로 연결할 수 없습니다.' });
      return;
    } finally { verifying--; }
    const now = Date.now();
    for (const [uid, bucket] of buckets) if (!bucket.active && now - bucket.start >= 60000) buckets.delete(uid);
    let bucket = buckets.get(user.uid);
    if (!bucket) {
      if (buckets.size >= 4096) { res.status(503).json({ error: '잠시 후 다시 시도해주세요.' }); return; }
      bucket = { start: now, count: 0, active: 0 }; buckets.set(user.uid, bucket);
    }
    if (now - bucket.start >= 60000) { bucket.start = now; bucket.count = 0; }
    // Generous burst allowance retains multi-agent, image and document batch generation.
    if (bucket.count >= 600 || bucket.active >= 32) {
      res.set('Retry-After', '5').status(429).json({ error: '진행 중인 요청을 마친 후 다시 시도해주세요.' }); return;
    }
    bucket.count++; bucket.active++;
    let released = false;
    const release = () => { if (!released) { released = true; bucket!.active--; } };
    res.once('finish', release); res.once('close', release);
    res.locals.uid = user.uid;
    next();
  };
}
export const requireUser = authenticatedApi();
