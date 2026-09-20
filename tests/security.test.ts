import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { verifyAppUser, authenticatedApi, ACCESS_POLICY } from '../serverSecurity.ts';

const token = 'synthetic-firebase-token-for-local-tests';
const account = { localId: 'user-one', email: 'member@example.test', emailVerified: true };
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

test('rejects missing, invalid, disabled and unverified identities before access checks', async () => {
  let calls = 0;
  await assert.rejects(verifyAppUser(undefined, async () => { calls++; return reply({}); }), /AUTH_REQUIRED/);
  assert.equal(calls, 0);
  await assert.rejects(verifyAppUser(token, async () => reply({}, 400)), /AUTH_REQUIRED/);
  for (const change of [{ disabled: true }, { emailVerified: false }, { localId: null }]) {
    await assert.rejects(verifyAppUser(token, async () => reply({ users: [{ ...account, ...change }] })), /AUTH_REQUIRED/);
  }
});

test('owner and existing approved/signed-in users retain access', async () => {
  const owner = await verifyAppUser(token, async () => reply({ users: [{ ...account, email: 'kanata840@gmail.com' }] }));
  assert.equal(owner.uid, 'user-one');
  const requests: string[] = [];
  const user = await verifyAppUser(token, async (url, options) => {
    requests.push(String(url));
    assert.equal(options?.redirect, 'error');
    if (String(url).includes('accounts:lookup')) return reply({ users: [account] });
    assert.equal((options!.headers as Record<string, string>).Authorization, `Bearer ${token}`);
    if (String(url).includes('/users/')) return reply({}, 404);
    return reply([{ document: { fields: { email: { stringValue: account.email }, role: { stringValue: 'user' } } } }]);
  });
  assert.equal(user.uid, 'user-one');
  assert.equal(requests.length, ACCESS_POLICY === 'signed-in' ? 1 : ACCESS_POLICY === 'users' ? 3 : 2);
});

test('unapproved accounts fail closed and identity outages do not grant access', async () => {
  await assert.rejects(verifyAppUser(token, async () => reply({}, 503)), /AUTH_UNAVAILABLE/);
  if (ACCESS_POLICY !== 'signed-in') {
    await assert.rejects(verifyAppUser(token, async url => String(url).includes('accounts:lookup') ? reply({ users: [account] }) : String(url).includes('/users/') ? reply({}, 404) : reply([])), /APPROVAL_REQUIRED/);
  }
});

test('real HTTP middleware blocks unauthenticated calls before body parsing and preserves authorized JSON', async () => {
  const app = express(); let paidCalls = 0;
  app.use('/api', authenticatedApi(async value => {
    if (value === 'bad') throw Error('AUTH_REQUIRED');
    if (value === 'unapproved') throw Error('APPROVAL_REQUIRED');
    if (value === 'offline') throw Error('AUTH_UNAVAILABLE');
    return { uid: 'user-one', email: account.email };
  }));
  app.use(express.json());
  app.post('/api/generate', (req, res) => { paidCalls++; res.json({ input: req.body, uid: res.locals.uid }); });
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const url = `http://127.0.0.1:${(server.address() as any).port}/api/generate`;
  try {
    const missing = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{invalid-json' });
    assert.equal(missing.status, 401);
    for (const [value, expected] of [['bad', 401], ['unapproved', 403], ['offline', 503]] as const) {
      assert.equal((await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${value}` } })).status, expected);
    }
    assert.equal(paidCalls, 0);
    const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ prompt: '기존 프롬프트', image: 'unchanged' }) });
    assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await response.json(), { input: { prompt: '기존 프롬프트', image: 'unchanged' }, uid: 'user-one' });
    assert.equal(paidCalls, 1);
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
});
