// Only allow known diagnostic codes; never expose error messages, headers, URLs or key values.
const CODES = new Set(['ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED', 'ECONNRESET', 'ENETUNREACH', 'EHOSTUNREACH', 'ETIMEDOUT', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT', 'UND_ERR_SOCKET', 'CERT_HAS_EXPIRED', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY', 'DEPTH_ZERO_SELF_SIGNED_CERT', 'SELF_SIGNED_CERT_IN_CHAIN', 'ERR_TLS_CERT_ALTNAME_INVALID', 'ERR_INVALID_CHAR', 'ERR_INVALID_ARG_TYPE', 'ERR_NETWORK_ACCESS_DENIED']);

export function safeNetworkError(error) {
  const queue = [error], seen = new Set(), codes = new Set();
  for (let i = 0; queue.length && i < 20; i++) {
    const item = queue.shift();
    if (!item || typeof item !== 'object' || seen.has(item)) continue;
    seen.add(item);
    if (CODES.has(item.code)) codes.add(item.code);
    if (item.name === 'TimeoutError' || item.name === 'AbortError') codes.add('TIMEOUT_OR_ABORT');
    if (item.cause) queue.push(item.cause);
    if (Array.isArray(item.errors)) queue.push(...item.errors.slice(0, 8));
  }
  return codes.size ? [...codes].join(', ') : 'NETWORK_ERROR_UNCLASSIFIED';
}
