// Firebase's web API key and database ID are public app configuration.
const WEB_KEY = 'AIzaSyCtEbU2W0VZdxN45JVOdYtaxwe5tSg2bjY';
const DATABASE = 'projects/gen-lang-client-0165298283/databases/ai-studio-17ef26a9-06ef-4913-97a0-d4e053a01777';

export async function verifyVoiceUser(token: unknown, request = fetch): Promise<string> {
  if (typeof token !== 'string' || token.length < 20 || token.length > 8192) throw Error('AUTH_REQUIRED');
  const lookup = await request(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${WEB_KEY}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ idToken: token }),
    signal: AbortSignal.timeout(8000), redirect: 'error',
  });
  if (!lookup.ok) throw Error('AUTH_REQUIRED');
  const account = (await lookup.json()).users?.[0];
  if (typeof account?.localId !== 'string' || typeof account.email !== 'string' || account.disabled || account.emailVerified !== true) throw Error('AUTH_REQUIRED');
  if (account.email === 'kanata840@gmail.com') return account.localId;
  // Use the same approved_users collection and owner exception as AuthContext.
  // The user's Firebase token is evaluated by Firestore rules; no admin key is needed.
  const response = await request(`https://firestore.googleapis.com/v1/${DATABASE}/documents:runQuery`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ structuredQuery: { from: [{ collectionId: 'approved_users' }],
      where: { fieldFilter: { field: { fieldPath: 'email' }, op: 'EQUAL', value: { stringValue: account.email } } }, limit: 1 } }),
    signal: AbortSignal.timeout(8000), redirect: 'error',
  });
  if (!response.ok) throw Error('AUTH_REQUIRED');
  const rows = await response.json();
  if (!Array.isArray(rows) || !rows.some(row => row.document?.fields?.email?.stringValue === account.email)) throw Error('APPROVAL_REQUIRED');
  return account.localId;
}
