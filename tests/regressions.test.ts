import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { registerChiikawa } from '../chiikawa.ts';
import { validBox, eraseTextInk, fitInPolygon, lineSpan, insidePolygon } from '../src/utils/imageLayout.ts';
import { playAudioChunk, resetAudioQueue, setHoldPlayback } from '../src/audio.ts';

test('recording clears playing and scheduled audio; held audio stays silent', () => {
  const sources: any[] = [];
  const context: any = { currentTime: 0, destination: {},
    createBuffer: () => ({ duration: 1, getChannelData: () => new Float32Array(1) }),
    createBufferSource: () => {
      const source = { connect() {}, disconnect() {}, start() {}, stopped: false, stop() { this.stopped = true; } };
      sources.push(source); return source;
    },
  };
  setHoldPlayback(false, context);
  playAudioChunk(context, 'AAA='); playAudioChunk(context, 'AAA=');
  resetAudioQueue();
  assert.ok(sources.every(source => source.stopped));
  setHoldPlayback(true, context); playAudioChunk(context, 'AAA=');
  assert.equal(sources.length, 2);
  setHoldPlayback(false, context); assert.equal(sources.length, 3);
  resetAudioQueue();
});

test('invalid OCR boxes cannot cover arbitrary image regions', () => {
  assert.equal(validBox([0, 0, 1000, 1000]), true);
  for (const box of [[0, 0, 1001, 5], [50, 0, 40, 10], [0, NaN, 5, 10], [0, 2, 5]]) assert.equal(validBox(box), false);
});

test('ink removal preserves surrounding character pixels and a colored background', () => {
  const width = 20, height = 20;
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < pixels.length; i += 4) pixels.set([245, 225, 160, 255], i);
  // Original text and a separate character silhouette outside the OCR region.
  pixels.set([20, 20, 20, 255], (5 * width + 5) * 4);
  for (let y = 10; y < 18; y++) for (let x = 10; x < 18; x++) pixels.set([70, 130, 150, 255], (y * width + x) * 4);
  const result = eraseTextInk(pixels, width, height, [[150, 150, 400, 400]]);
  assert.deepEqual([...result.slice((5 * width + 5) * 4, (5 * width + 5) * 4 + 4)], [245, 225, 160, 255]);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if (x >= 3 && x < 8 && y >= 3 && y < 8) continue;
    const i = (y * width + x) * 4;
    assert.deepEqual(result.slice(i, i + 4), pixels.slice(i, i + 4));
  }
});

test('long translation stays inside a narrowing speech balloon without losing characters', () => {
  const polygon: [number, number][] = [[30, 0], [90, 0], [120, 40], [120, 120], [80, 150], [30, 130], [0, 70]];
  const text = '맛있었으니까 다음에 먹고 싶은 걸 생각하고 있었어!!';
  const result = fitInPolygon(text, polygon, 28, (s, size) => Array.from(s).length * size * 0.8);
  assert.equal(result.lines.map(line => line.text).join('').replace(/\s/g, ''), text.replace(/\s/g, ''));
  assert.ok(result.size > 2);
  for (const line of result.lines) {
    assert.ok(insidePolygon(line.x, line.y, polygon));
    const span = lineSpan(polygon, line.y - result.size * 0.5, line.y + result.size * 0.5, 0);
    assert.ok(span && Array.from(line.text).length * result.size * 0.8 <= span[1] - span[0]);
  }
});

test('gallery has an explicit unconfigured state and refuses image fetches', async () => {
  const previous = process.env.X_BEARER_TOKEN;
  delete process.env.X_BEARER_TOKEN;
  const app = express(); registerChiikawa(app);
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const address = server.address() as { port: number };
  try {
    const res = await fetch(`http://127.0.0.1:${address.port}/api/chiikawa/photos`);
    assert.deepEqual(await res.json(), { configured: false, photos: [] });
    assert.equal((await fetch(`http://127.0.0.1:${address.port}/api/chiikawa/image/arbitrary`)).status, 503);
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
    if (previous !== undefined) process.env.X_BEARER_TOKEN = previous;
  }
});

test('gallery filters photos, sorts newest first, limits to nine, and shares cached requests', async () => {
  const previous = process.env.X_BEARER_TOKEN;
  process.env.X_BEARER_TOKEN = 'test-only';
  const realFetch = globalThis.fetch;
  let apiCalls = 0;
  globalThis.fetch = (async (input: any, init: any) => {
    const url = String(input);
    if (!url.startsWith('https://api.x.com/')) return realFetch(input, init);
    apiCalls++;
    if (url.includes('by/username')) return Response.json({ data: { id: '123' } });
    return Response.json({
      data: Array.from({ length: 12 }, (_, i) => ({ id: `${i}`, created_at: `2026-09-${String(i + 1).padStart(2, '0')}T00:00:00Z`, attachments: { media_keys: [`m${i}`] } })),
      includes: { media: Array.from({ length: 12 }, (_, i) => ({ media_key: `m${i}`, type: i === 11 ? 'video' : 'photo', url: `https://pbs.twimg.com/media/test${i}.jpg` })) },
    });
  }) as typeof fetch;
  const app = express(); registerChiikawa(app);
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  try {
    const [first, second] = await Promise.all([realFetch(`${base}/api/chiikawa/photos`), realFetch(`${base}/api/chiikawa/photos`)]);
    const result = await first.json();
    assert.equal(result.photos.length, 9);
    assert.equal(result.photos[0].id, '10_m10');
    assert.deepEqual(await second.json(), result);
    assert.equal(apiCalls, 2);
    assert.equal((await realFetch(`${base}/api/chiikawa/image/not-in-feed`)).status, 404);
  } finally {
    globalThis.fetch = realFetch;
    if (previous === undefined) delete process.env.X_BEARER_TOKEN; else process.env.X_BEARER_TOKEN = previous;
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
