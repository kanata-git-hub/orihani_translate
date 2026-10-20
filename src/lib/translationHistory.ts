import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { TextBlock, ImageLayoutMode } from '../utils/imageLayout';

export interface TextTranslation {
  kind: 'text';
  original: string;
  translation: string;
  pronunciation: string;
  sourceLang: string;
  targetLang: string;
}

export interface ImageTranslation {
  kind: 'image';
  originalImage: Blob;
  translatedImage?: Blob;
  blocks: TextBlock[];
  layoutMode: ImageLayoutMode;
  category: string | null;
  extractedData: {
    amount?: number | null;
    currency?: string | null;
    location_keyword?: string | null;
    search_keyword?: string | null;
    summary?: string | null;
    brand_notes?: unknown;
    wordplay_notes?: unknown;
  } | null;
  targetLang: string;
}

export type TranslationContent = TextTranslation | ImageTranslation;
export interface HistorySummary {
  id: string;
  ownerId: string;
  kind: TranslationContent['kind'];
  createdAt: number;
  title: string;
  preview: string;
  targetLang: string;
  thumbnail?: Blob;
}
export interface HistoryRecord extends HistorySummary {
  content: TranslationContent;
}

interface HistoryDB extends DBSchema {
  entries: {
    key: string;
    value: HistorySummary;
    indexes: { 'by-owner-date': [string, number, string] };
  };
  contents: { key: string; value: { id: string; content: TranslationContent } };
}

let connection: Promise<IDBPDatabase<HistoryDB>> | undefined;
function getDB() {
  if (!connection) {
    connection = openDB<HistoryDB>('orihani-translation-history', 1, {
      upgrade(db) {
        const entries = db.createObjectStore('entries', { keyPath: 'id' });
        entries.createIndex('by-owner-date', ['ownerId', 'createdAt', 'id']);
        db.createObjectStore('contents', { keyPath: 'id' });
      },
      blocking() { void connection?.then(db => db.close()); connection = undefined; },
      terminated() { connection = undefined; },
    }).catch(error => { connection = undefined; throw error; });
  }
  return connection;
}

// Metadata and full images are separate so opening the list does not load every image.
export async function saveTranslation(ownerId: string, content: TranslationContent, title?: string): Promise<string> {
  if (!ownerId) throw new Error('로그인이 필요합니다.');
  const id = crypto.randomUUID();
  const preview = content.kind === 'text' ? content.translation : content.blocks.map(b => b.translation).join(' ');
  const summary: HistorySummary = {
    id, ownerId, kind: content.kind, createdAt: Date.now(),
    title: (title || (content.kind === 'text' ? content.original : '이미지 번역')).slice(0, 120),
    preview: preview.slice(0, 180), targetLang: content.targetLang,
  };
  const db = await getDB();
  const tx = db.transaction(['entries', 'contents'], 'readwrite');
  try {
    await tx.objectStore('entries').put(summary);
    await tx.objectStore('contents').put({ id, content });
    await tx.done;
  } catch (error) {
    try { tx.abort(); } catch { /* It may already have aborted due to quota. */ }
    await tx.done.catch(() => {});
    throw error;
  }
  return id;
}

export async function listTranslations(ownerId: string, before?: HistorySummary, limit = 30): Promise<HistorySummary[]> {
  if (!ownerId) return [];
  const db = await getDB();
  const range = IDBKeyRange.bound(
    [ownerId, 0, ''],
    [ownerId, before?.createdAt ?? Number.MAX_SAFE_INTEGER, before?.id ?? '\uffff'],
    false, Boolean(before),
  );
  const entries: HistorySummary[] = [];
  let cursor = await db.transaction('entries').store.index('by-owner-date').openCursor(range, 'prev');
  while (cursor && entries.length < limit) {
    entries.push(cursor.value);
    cursor = await cursor.continue();
  }
  return entries;
}

export async function getTranslation(ownerId: string, id: string): Promise<HistoryRecord | null> {
  const db = await getDB();
  const tx = db.transaction(['entries', 'contents']);
  const summary = await tx.objectStore('entries').get(id);
  if (!ownerId || summary?.ownerId !== ownerId) return null;
  const payload = await tx.objectStore('contents').get(id);
  return payload ? { ...summary, content: payload.content } : null;
}

// Cache the actual composed image. A late render must never recreate a deleted record.
export async function saveRenderedTranslation(ownerId: string, id: string, image: Blob, thumbnail?: Blob): Promise<void> {
  const db = await getDB();
  const tx = db.transaction(['entries', 'contents'], 'readwrite');
  const summary = await tx.objectStore('entries').get(id);
  if (!ownerId || summary?.ownerId !== ownerId) return;
  const payload = await tx.objectStore('contents').get(id);
  if (payload?.content.kind !== 'image') return;
  payload.content.translatedImage = image;
  await Promise.all([
    tx.objectStore('contents').put(payload),
    thumbnail ? tx.objectStore('entries').put({ ...summary, thumbnail }) : Promise.resolve(),
    tx.done,
  ]);
}

export async function deleteTranslation(ownerId: string, id: string): Promise<void> {
  const db = await getDB();
  const tx = db.transaction(['entries', 'contents'], 'readwrite');
  const summary = await tx.objectStore('entries').get(id);
  if (!ownerId || summary?.ownerId !== ownerId) return;
  await Promise.all([tx.objectStore('entries').delete(id), tx.objectStore('contents').delete(id), tx.done]);
}

export async function clearTranslations(ownerId: string): Promise<void> {
  if (!ownerId) return;
  const db = await getDB();
  const tx = db.transaction(['entries', 'contents'], 'readwrite');
  const range = IDBKeyRange.bound([ownerId, 0, ''], [ownerId, Number.MAX_SAFE_INTEGER, '\uffff']);
  let cursor = await tx.objectStore('entries').index('by-owner-date').openCursor(range);
  while (cursor) {
    await tx.objectStore('contents').delete(cursor.value.id);
    await cursor.delete();
    cursor = await cursor.continue();
  }
  await tx.done;
}

export function imageBlob(mimeType: string, base64: string): Blob {
  return new Blob([Uint8Array.from(atob(base64), c => c.charCodeAt(0))], { type: mimeType });
}

export function imageTranslationContent(originalImage: Blob, data: any, targetLang: string): ImageTranslation {
  return {
    kind: 'image', originalImage, blocks: Array.isArray(data.blocks) ? data.blocks : [], targetLang,
    layoutMode: data.layout_mode === 'comic' ? 'comic' : data.layout_mode === 'photo' || ['price', 'product', 'long_text', 'location'].includes(data.category) ? 'photo' : 'comic',
    category: data.category || null, extractedData: data.extracted_data || null,
  };
}

export async function createHistoryThumbnail(blob: Blob): Promise<Blob | undefined> {
  const url = URL.createObjectURL(blob);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const scale = Math.min(1, 160 / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    canvas.getContext('2d')?.drawImage(image, 0, 0, canvas.width, canvas.height);
    return await new Promise(resolve => canvas.toBlob(blob => resolve(blob || undefined), 'image/jpeg', 0.7));
  } catch { return undefined; }
  finally { URL.revokeObjectURL(url); }
}

export function historyErrorMessage(error: unknown): string {
  return (error as { name?: string })?.name === 'QuotaExceededError'
    ? '기기 저장 공간이 부족해 기록을 저장하지 못했습니다. 히스토리에서 필요 없는 기록을 삭제해 주세요.'
    : '브라우저 저장소를 사용할 수 없어 기록을 저장하지 못했습니다. 현재 번역 결과는 계속 볼 수 있습니다.';
}

export function languageLabel(language: string): string {
  return ({ ko: '한국어', Korean: '한국어', ja: '일본어', en: '영어', zh: '중국어', es: '스페인어', fr: '프랑스어', de: '독일어', it: '이탈리아어', nl: '네덜란드어' } as Record<string, string>)[language] || language;
}
