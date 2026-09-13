import {test} from 'node:test';
import assert from 'node:assert/strict';
import {safeNetworkError} from '../scripts/voice-benchmark/network.mjs';
import {diagnose} from '../scripts/voice-benchmark/diagnose.mjs';
import {generateSyntheticInput} from '../scripts/voice-benchmark/synthetic.mjs';

test('diagnostics retain known nested error codes without exposing messages or unknown codes', () => {
  const error = new Error('private-key-value');
  error.code = 'private-key-value';
  error.cause = new AggregateError([{code: 'ENETUNREACH'}, {code: 'ETIMEDOUT', message: 'private-key-value'}]);
  error.cause.cause = error;
  assert.equal(safeNetworkError(error), 'ENETUNREACH, ETIMEDOUT');
  assert.equal(safeNetworkError({code: 'private-key-value', message: 'private-key-value'}), 'NETWORK_ERROR_UNCLASSIFIED');
  assert.equal(safeNetworkError({name: 'TimeoutError'}), 'TIMEOUT_OR_ABORT');
});

test('connection probes send no keys, ignore curl configuration and discard response bodies', async () => {
  let cancelled = false;
  const result = await diagnose({env: {OPENAI_API_KEY: 'private-key-value', GEMINI_API_KEY: 'private-gemini-value', HTTPS_PROXY: 'https://user:private-proxy-value@example.invalid'},
    fetchImpl: async (url, options) => {
      assert.equal(url, 'https://api.openai.com/v1/models');
      assert.equal(options.method, 'GET');
      assert.equal(options.headers, undefined);
      return {status: 401, body: {cancel: async () => { cancelled = true; }}};
    }, curlRun: async (command, args, options) => {
      assert.equal(command, 'curl');
      assert.equal(args[0], '--disable');
      assert.equal(args.includes('--location'), false);
      assert.equal(options.env.OPENAI_API_KEY, undefined);
      assert.equal(options.env.GEMINI_API_KEY, undefined);
      return {stdout: '401', stderr: 'private-proxy-value'};
    }});
  assert.equal(cancelled, true);
  assert.equal(result.nodeConnection.httpStatus, 401);
  assert.equal(result.curlConnection.httpStatus, 401);
  assert.equal(result.callsPaidModels, false);
  assert.equal(result.proxyConfigured, true);
  assert.equal(JSON.stringify(result).includes('private-'), false);
});

test('failed probes hide raw curl output and preserve a fetch timeout cause', async () => {
  const result = await diagnose({env: {}, fetchImpl: async () => { throw {cause: {code: 'UND_ERR_CONNECT_TIMEOUT'}, message: 'private-key-value'}; },
    curlRun: async () => { throw {code: 28, stderr: 'private-proxy-value', stdout: 'private-key-value'}; }});
  assert.equal(result.nodeConnection.error, 'UND_ERR_CONNECT_TIMEOUT');
  assert.equal(result.curlConnection.exitCode, 28);
  assert.equal(JSON.stringify(result).includes('private-'), false);
});

test('synthetic key character checks precede requests and network failures do not leak the key', async () => {
  let calls = 0;
  const fetchImpl = async () => { calls++; throw {cause: {code: 'ECONNRESET'}, message: 'private-key-value'}; };
  await assert.rejects(generateSyntheticInput({source: 'ko', key: '잘못 복사한 키', fetchImpl}), /요청은 보내지 않았습니다/);
  assert.equal(calls, 0);
  await assert.rejects(generateSyntheticInput({source: 'ko', key: 'private-key-value', fetchImpl}), error => error.message.includes('ECONNRESET') && !error.message.includes('private-key-value'));
  assert.equal(calls, 1);
});
