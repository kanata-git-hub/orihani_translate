import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RealtimeVoice } from '../src/voice/RealtimeVoice.ts';

async function fixture(t: any, delayedPermission = false) {
  const sockets: Socket[] = [], worklets: Worklet[] = [], captures: Context[] = [];
  const events: any[] = [];
  const track = { stopped: false, onended: null, stop() { this.stopped = true; } };
  const stream = { getTracks: () => [track] };
  let allow!: (value: any) => void;
  const permission = delayedPermission ? new Promise(resolve => { allow = resolve; }) : Promise.resolve(stream);
  class Socket {
    static OPEN = 1;
    readyState = 0; bufferedAmount = 0; sent: any[] = [];
    onopen: any; onmessage: any; onerror: any; onclose: any;
    url: string;
    constructor(url: string) { this.url = url; sockets.push(this); }
    send(raw: string) { this.sent.push(JSON.parse(raw)); }
    close() { this.readyState = 3; this.onclose?.(); }
    open() { this.readyState = 1; this.onopen?.(); }
    receive(value: object) { this.onmessage?.({ data: JSON.stringify(value) }); }
  }
  class Node { connect() {} disconnect() {} }
  class Worklet extends Node {
    port = { onmessage: null as any, posted: [] as string[], postMessage: (value: string) => { this.port.posted.push(value); } };
    constructor(..._args: any[]) { super(); worklets.push(this); }
    emit(value: object) { this.port.onmessage?.({ data: value }); }
  }
  class Context {
    destination = {}; closed = false;
    audioWorklet = { addModule: async (_path: string) => {} };
    constructor() { captures.push(this); }
    resume() { return Promise.resolve(); }
    close() { this.closed = true; return Promise.resolve(); }
    createMediaStreamSource() { return new Node(); }
    createAnalyser() { return Object.assign(new Node(), { fftSize: 64, frequencyBinCount: 32, getByteFrequencyData: () => {} }); }
  }
  const replacements = { window: { AudioContext: Context }, location: { protocol: 'https:', host: 'app.example' },
    navigator: { mediaDevices: { getUserMedia: () => permission } }, WebSocket: Socket, AudioWorkletNode: Worklet };
  const originals = Object.fromEntries(Object.keys(replacements).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(replacements)) Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
  const controller = new RealtimeVoice({ role: 'user', foreignerLang: 'ja', ttsEnabled: true, opponentText: '', token: async () => 'fake-token',
    levels: () => {}, stopped: () => events.push({ type: 'stopped', micStopped: track.stopped }),
    audio: value => events.push({ type: 'audio', value, micStopped: track.stopped }),
    text: (input, output) => events.push({ type: 'text', input, output }),
    guide: value => events.push({ type: 'guide', value }), done: () => events.push({ type: 'done' }), error: code => events.push({ type: 'error', code }),
  });
  t.after(() => {
    controller.cancel();
    for (const [key, descriptor] of Object.entries(originals)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete (globalThis as any)[key];
    }
  });
  const settle = async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); };
  await settle();
  const ready = () => { sockets[0].open(); sockets[0].receive({ type: 'ready', maxSeconds: 300 }); };
  return { controller, sockets, worklets, captures, events, track, ready, settle, allow: async () => { allow(stream); await settle(); } };
}

test('stop closes the mic, preserves the final partial PCM, and commits once after recorder acknowledgment', async t => {
  const f = await fixture(t); f.ready();
  const first = new Uint8Array(9600).fill(1), tail = new Uint8Array(640).fill(2);
  f.worklets[0].emit({ pcm: first });
  f.controller.stop(); f.controller.stop();
  assert.equal(f.track.stopped, true);
  assert.deepEqual(f.worklets[0].port.posted, ['stop']);
  assert.equal(f.sockets[0].sent.some(e => e.type === 'stop'), false);
  f.worklets[0].emit({ pcm: tail }); f.worklets[0].emit({ stopped: true });
  const sent = f.sockets[0].sent;
  assert.deepEqual(sent.map(e => e.type), ['auth', 'pcm', 'pcm', 'stop']);
  assert.deepEqual(Buffer.concat(sent.filter(e => e.type === 'pcm').map(e => Buffer.from(e.audio, 'base64'))), Buffer.concat([first, tail]));
  assert.equal(f.captures[0].closed, true);
  f.sockets[0].receive({ type: 'audio', audio: 'AAAA' });
  assert.deepEqual(f.events.find(e => e.type === 'audio'), { type: 'audio', value: 'AAAA', micStopped: true });
  f.sockets[0].receive({ type: 'done', input: '원문', output: '翻訳' });
  assert.equal(f.events.at(-1).type, 'done');
  f.sockets[0].receive({ type: 'guide', pronunciation: '혼야쿠' });
  assert.equal(f.events.at(-1).value, '혼야쿠');
});

test('speech and stop during connection preparation are buffered and submitted intact once ready', async t => {
  const f = await fixture(t);
  f.worklets[0].emit({ pcm: new Uint8Array(9600) });
  f.controller.stop(); f.worklets[0].emit({ stopped: true });
  assert.equal(f.sockets[0].sent.length, 0);
  f.ready();
  assert.deepEqual(f.sockets[0].sent.map(e => e.type), ['auth', 'pcm', 'stop']);
  assert.equal(f.events.some(e => e.type === 'error'), false);
});

test('early upstream audio is rejected and never played into an active microphone', async t => {
  const f = await fixture(t); f.ready();
  f.sockets[0].receive({ type: 'audio', audio: 'AAAA' });
  assert.equal(f.events.some(e => e.type === 'audio'), false);
  assert.equal(f.events.at(-1).type, 'error'); assert.equal(f.track.stopped, true);
});

test('reset/unmount cancels capture and ignores late text, pronunciation and audio', async t => {
  const f = await fixture(t); f.ready(); f.controller.cancel();
  const count = f.events.length;
  for (const event of [{ type: 'text', input: 'old', output: 'old' }, { type: 'audio', audio: 'AAAA' }, { type: 'guide', pronunciation: 'old' }]) f.sockets[0].receive(event);
  assert.equal(f.events.length, count); assert.equal(f.track.stopped, true);
  assert.equal(f.sockets[0].sent.at(-1).type, 'cancel');
});

test('stopping before microphone permission resolves cannot leave a late microphone recording', async t => {
  const f = await fixture(t, true);
  f.controller.stop(); await f.allow();
  assert.equal(f.track.stopped, true); assert.equal(f.worklets.length, 0);
  assert.equal(f.captures[0].closed, true);
  assert.equal(f.sockets[0].sent.some(e => e.type === 'stop'), false);
});

test('five-minute timer stops once; ten seconds of silence does not auto-stop', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const f = await fixture(t); f.ready();
  f.worklets[0].emit({ pcm: new Uint8Array(9600) });
  t.mock.timers.tick(10000);
  assert.equal(f.track.stopped, false);
  t.mock.timers.tick(290000);
  assert.equal(f.track.stopped, true);
  assert.equal(f.events.filter(e => e.type === 'stopped').length, 1);
  f.worklets[0].emit({ stopped: true });
  assert.equal(f.sockets[0].sent.filter(e => e.type === 'stop').length, 1);
});
