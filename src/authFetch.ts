import { auth } from './lib/firebaseUtils';

// Refresh Firebase ID tokens automatically, without changing the existing login flow.
export async function authFetch(path: string, init: RequestInit = {}): Promise<Response> {
  if (!path.startsWith('/api/') || path.startsWith('//')) throw Error('Invalid API path');
  await auth.authStateReady();
  const user = auth.currentUser;
  if (!user) throw Error('로그인 후 사용해주세요.');
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${await user.getIdToken()}`);
  return fetch(path, { ...init, headers, credentials: 'same-origin' });
}
