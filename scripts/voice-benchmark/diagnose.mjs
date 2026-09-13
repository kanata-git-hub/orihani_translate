import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
import {safeNetworkError} from './network.mjs';

const URL = 'https://api.openai.com/v1/models';
const runFile = promisify(execFile);

export async function diagnose({fetchImpl = fetch, curlRun = runFile, env = process.env} = {}) {
  const info = {nodeVersion: process.version, sendsApiKey: false, callsPaidModels: false,
    proxyConfigured: ['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy', 'ALL_PROXY', 'all_proxy'].some(name => Boolean(env[name])),
    note: '키 없이 연결만 검사합니다. HTTP 401은 키를 보내지 않아 예상되는 응답이며, 이 검사로 키의 유효성이나 모델 권한을 판단하지 않습니다.'};
  const curlEnv = {...env};
  delete curlEnv.OPENAI_API_KEY; delete curlEnv.GEMINI_API_KEY;
  const probes = await Promise.allSettled([
    (async () => {
      const start = performance.now();
      try {
        const response = await fetchImpl(URL, {method: 'GET', redirect: 'error', signal: AbortSignal.timeout(15000)});
        await response.body?.cancel();
        return {httpStatus: response.status, elapsedMs: Math.round(performance.now() - start)};
      } catch (error) { return {error: safeNetworkError(error), elapsedMs: Math.round(performance.now() - start)}; }
    })(),
    (async () => {
      // --disable must be first: ignore any user curl configuration (including saved headers).
      const args = ['--disable', '--silent', '--show-error', '--connect-timeout', '8', '--max-time', '15', '--output', '/dev/null', '--write-out', '%{http_code}', URL];
      try {
        const result = await curlRun('curl', args, {env: curlEnv, timeout: 17000, maxBuffer: 4096});
        const status = /^\d{3}$/.test(result.stdout.trim()) ? Number(result.stdout.trim()) : null;
        return {exitCode: 0, httpStatus: status};
      } catch (error) {
        // curl stderr can contain a proxy URL or configuration details, so do not print it.
        return {exitCode: Number.isInteger(error.code) ? error.code : null,
          error: error.code === 'ENOENT' ? 'CURL_NOT_INSTALLED' : 'CURL_CONNECTION_FAILED'};
      }
    })(),
  ]);
  for (let i = 0; i < probes.length; i++) {
    info[i === 0 ? 'nodeConnection' : 'curlConnection'] = probes[i].status === 'fulfilled' ? probes[i].value : {error: 'PROBE_FAILED'};
  }
  return info;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  diagnose().then(result => console.log(JSON.stringify(result, null, 2))).catch(() => { console.error('연결 검사를 완료하지 못했습니다.'); process.exitCode = 1; });
}
