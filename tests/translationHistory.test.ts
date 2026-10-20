import 'fake-indexeddb/auto';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDB } from 'idb';
import { clearTranslations, deleteTranslation, getTranslation, historyErrorMessage, imageBlob, imageTranslationContent, listTranslations, saveRenderedTranslation, saveTranslation, type TextTranslation } from '../src/lib/translationHistory.ts';

const text: TextTranslation = { kind: 'text', original: 'こんにちは', translation: '안녕하세요', pronunciation: '안녕하세요', sourceLang: 'ja', targetLang: 'ko' };

test('text and images share newest-first history; records survive reopening the database', async () => {
  const owner = 'order-and-reload';
  const oldNow = Date.now;
  let first: string, second: string;
  try {
    Date.now = () => 100;
    first = await saveTranslation(owner, text);
    Date.now = () => 200;
    second = await saveTranslation(owner, imageTranslationContent(imageBlob('image/png', 'AQID'), {
      blocks: [{ original: 'モナ王', translation: '모나왕', box: [0, 0, 100, 100] }],
      category: 'product', extracted_data: { brand_notes: [{ original: 'モナ王', explanation: '아이스크림 상품 이름' }], wordplay_notes: [{ original: '王', explanation: '왕을 뜻합니다' }] },
    }, 'Korean'), '사진.png');
  } finally { Date.now = oldNow; }
  const list = await listTranslations(owner);
  assert.deepEqual(list.map(r => r.id), [second!, first!]);
  assert.ok(list.every(r => !('content' in r)), 'listing should not load full images');
  const connection = await openDB('orihani-translation-history', 1);
  const persisted = await connection.get('contents', second!);
  assert.equal(persisted.content.extractedData.brand_notes[0].original, 'モナ王');
  assert.equal(persisted.content.extractedData.wordplay_notes.length, 1);
  assert.deepEqual([...new Uint8Array(await persisted.content.originalImage.arrayBuffer())], [1, 2, 3]);
  connection.close();
  assert.deepEqual((await getTranslation(owner, first!))?.content, text);
});

test('equal-timestamp records paginate without loss or duplication', async () => {
  const owner = 'pagination';
  const oldNow = Date.now;
  try {
    Date.now = () => 500;
    await Promise.all(Array.from({ length: 35 }, (_, i) => saveTranslation(owner, text, `기록 ${i}`)));
  } finally { Date.now = oldNow; }
  const first = await listTranslations(owner);
  const second = await listTranslations(owner, first.at(-1));
  assert.equal(first.length, 30);
  assert.equal(second.length, 5);
  assert.equal(new Set([...first, ...second].map(r => r.id)).size, 35);
});

test('account isolation covers listing, reading, cached-image writes and deletion', async () => {
  const id = await saveTranslation('owner-a', imageTranslationContent(new Blob(['original']), { blocks: [] }, 'ko'));
  assert.equal(await getTranslation('owner-b', id), null);
  assert.deepEqual(await listTranslations('owner-b'), []);
  await saveRenderedTranslation('owner-b', id, new Blob(['wrong account']));
  await deleteTranslation('owner-b', id);
  await clearTranslations('owner-b');
  const saved = await getTranslation('owner-a', id);
  assert.ok(saved);
  assert.equal(saved.content.kind === 'image' && saved.content.translatedImage, undefined);
});

test('opening cached images preserves results and time without network requests', async () => {
  const id = await saveTranslation('cached', imageTranslationContent(new Blob(['source']), { blocks: [] }, 'ko'));
  const before = await getTranslation('cached', id);
  await saveRenderedTranslation('cached', id, new Blob(['translated-pixels'], { type: 'image/png' }), new Blob(['thumb']));
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () => { throw new Error('History must not use a network API'); };
  try {
    const record = await getTranslation('cached', id);
    assert.equal(record?.createdAt, before?.createdAt);
    assert.equal(record?.content.kind === 'image' && await record.content.translatedImage?.text(), 'translated-pixels');
    assert.equal(await (await listTranslations('cached'))[0].thumbnail?.text(), 'thumb');
  } finally { globalThis.fetch = originalFetch; }
});

test('deletion removes image data and metadata; late renders cannot resurrect it', async () => {
  const owner = 'deletion';
  const id = await saveTranslation(owner, imageTranslationContent(new Blob(['source']), { blocks: [] }, 'ko'));
  await deleteTranslation(owner, id);
  await saveRenderedTranslation(owner, id, new Blob(['late render']));
  assert.equal(await getTranslation(owner, id), null);
  assert.deepEqual(await listTranslations(owner), []);
  const connection = await openDB('orihani-translation-history', 1);
  assert.equal(await connection.get('contents', id), undefined);
  connection.close();
});

test('clear history deletes only that account, including full image payloads', async () => {
  const ids = await Promise.all([saveTranslation('clear-me', text), saveTranslation('clear-me', text)]);
  const survivor = await saveTranslation('keep-me', text);
  await clearTranslations('clear-me');
  assert.deepEqual(await listTranslations('clear-me'), []);
  assert.ok(await getTranslation('keep-me', survivor));
  const connection = await openDB('orihani-translation-history', 1);
  for (const id of ids) assert.equal(await connection.get('contents', id), undefined);
  connection.close();
});

test('failed writes do not leave partial records and storage errors are actionable', async () => {
  await assert.rejects(saveTranslation('failed', { ...text, invalid: () => {} } as TextTranslation));
  assert.deepEqual(await listTranslations('failed'), []);
  await assert.rejects(saveTranslation('', text));
  assert.match(historyErrorMessage({ name: 'QuotaExceededError' }), /저장 공간.*삭제/);
  assert.match(historyErrorMessage(new Error()), /현재 번역 결과는 계속 볼 수/);
});
