# 브라우저 번역 히스토리 (2026-10-20)

- 메인 화면의 현지 검색 옆에 히스토리 버튼을 추가했습니다. 글·음성 번역 결과와 단일/여러 장 이미지 번역 결과를 완료 시 저장하고, 최신순으로 표시합니다.
- IndexedDB에 로그인 계정별로 원문·번역문·이미지·기존 해설을 보관합니다. 완성 이미지는 Blob으로 저장하며, 목록은 작은 미리보기만 읽고 30건씩 불러옵니다.
- 기록 열람은 번역 API나 TTS를 호출하지 않습니다. 완성 이미지 캐시가 없으면 보관된 원본과 번역문으로 기기에서 다시 그립니다. 읽어도 번역 시각이나 목록 순서는 바뀌지 않습니다.
- 개별/전체 삭제 및 저장 공간 부족 안내를 제공합니다. 서버 동기화는 하지 않으며 사이트 데이터 삭제 시 기록도 삭제됩니다. 기능 추가 이전에 저장하지 않았던 결과는 복구하지 않습니다.
- 검증: `npm run test:history`, TypeScript, 기존 보안·이미지·해설 회귀 검사, production 빌드, npm audit. 실제 휴대폰 화면 조작 검사는 수행하지 않았습니다.

import React, { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Check, Copy, History, Image as ImageIcon, Loader2, MessageSquareText, Trash2, X } from 'lucide-react';
import { clearTranslations, deleteTranslation, getTranslation, languageLabel, listTranslations, type HistoryRecord, type HistorySummary } from '../lib/translationHistory';
import { ImageTranslateModal } from './ImageTranslateModal';

function Thumbnail({ blob }: { blob?: Blob }) {
  const [src, setSrc] = useState('');
  useEffect(() => {
    if (!blob) { setSrc(''); return; }
    const url = URL.createObjectURL(blob);
    setSrc(url);
    return () => URL.revokeObjectURL(url);
  }, [blob]);
  return src ? <img src={src} alt="" className="h-16 w-14 rounded-lg object-contain bg-stone-100" /> : <ImageIcon className="h-7 w-7 text-[#a86614]" />;
}

export function TranslationHistoryModal({ ownerId, onClose }: { ownerId: string; onClose: () => void }) {
  const [entries, setEntries] = useState<HistorySummary[]>([]);
  const [selected, setSelected] = useState<HistoryRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const alive = useRef(true);
  const currentOwner = useRef(ownerId);
  currentOwner.current = ownerId;

  const load = async (more = false) => {
    setLoading(true); setError('');
    try {
      const next = await listTranslations(ownerId, more ? entries.at(-1) : undefined);
      if (!alive.current || currentOwner.current !== ownerId) return;
      setEntries(previous => more ? [...previous, ...next] : next);
      setHasMore(next.length === 30);
    } catch { if (alive.current && currentOwner.current === ownerId) setError('기록을 불러오지 못했습니다. 브라우저 저장소 설정을 확인한 뒤 다시 시도해 주세요.'); }
    finally { if (alive.current && currentOwner.current === ownerId) setLoading(false); }
  };

  useEffect(() => {
    alive.current = true;
    setSelected(null); setEntries([]);
    void load();
    return () => { alive.current = false; };
  }, [ownerId]);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialogRef.current?.focus();
    return () => previous?.focus();
  }, [selected?.id]);

  const openEntry = async (id: string) => {
    setBusy(true); setError(''); setCopied(false);
    try {
      const record = await getTranslation(ownerId, id);
      if (!alive.current || currentOwner.current !== ownerId) return;
      if (record) setSelected(record);
      else { setError('삭제되었거나 찾을 수 없는 기록입니다.'); await load(); }
    } catch { if (alive.current && currentOwner.current === ownerId) setError('이 기록을 열지 못했습니다. 다시 시도해 주세요.'); }
    finally { if (alive.current && currentOwner.current === ownerId) setBusy(false); }
  };

  const remove = async (id?: string) => {
    if (!window.confirm(id ? '이 번역 기록을 삭제하시겠습니까?' : '이 브라우저에 저장된 내 번역 기록을 모두 삭제하시겠습니까?')) return;
    setBusy(true); setError('');
    try {
      if (id) await deleteTranslation(ownerId, id);
      else await clearTranslations(ownerId);
      setSelected(null);
      await load();
    } catch { setError('기록을 삭제하지 못했습니다. 다시 시도해 주세요.'); }
    finally { setBusy(false); }
  };

  const back = () => selected ? setSelected(null) : onClose();
  const text = selected?.content.kind === 'text' ? selected.content : null;
  const date = (time: number) => new Date(time).toLocaleString('ko-KR', { year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') { event.stopPropagation(); back(); }
    if (event.key === 'Tab') {
      const buttons = [...(dialogRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], [tabindex="0"]') || [])];
      if (!buttons.length) { event.preventDefault(); return; }
      const first = buttons[0], last = buttons.at(-1)!;
      if (event.shiftKey && (document.activeElement === first || document.activeElement === dialogRef.current)) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialogRef.current)) { event.preventDefault(); first.focus(); }
    }
  };

  if (selected?.content.kind === 'image') return <div ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-label="이미지 번역 기록" onKeyDown={handleKeyDown} className="fixed inset-0 z-[150] outline-none">
    <ImageTranslateModal isOpen file={null} targetLang={selected.targetLang} savedRecord={selected} onClose={() => setSelected(null)} />
  </div>;

  return <div className="fixed inset-0 z-[150] bg-black/55 backdrop-blur-sm flex items-center justify-center p-2 sm:p-4">
    <div ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-label="번역 히스토리" className="w-full max-w-xl h-[92dvh] rounded-3xl bg-[#fffcf6] text-[#552c24] shadow-2xl flex flex-col overflow-hidden outline-none"
      onKeyDown={handleKeyDown}>
      <header className="flex items-center gap-2 p-4 border-b border-[#552c24]/10 bg-white">
        {selected ? <button onClick={back} aria-label="기록 목록으로" className="p-2 rounded-full hover:bg-stone-100"><ArrowLeft size={21} /></button> : <History size={23} />}
        <div className="flex-1 min-w-0"><h2 className="text-lg font-bold">{selected ? '번역 기록' : '히스토리'}</h2><p className="text-xs text-stone-500">{selected ? date(selected.createdAt) : '최근 번역부터 · 이 브라우저에 저장'}</p></div>
        {!selected && entries.length > 0 && <button disabled={busy || loading} onClick={() => void remove()} className="text-xs px-2 py-2 text-stone-500 disabled:opacity-40">전체 삭제</button>}
        <button onClick={onClose} aria-label="히스토리 닫기" className="p-2 rounded-full hover:bg-stone-100"><X size={23} /></button>
      </header>
      <div className="flex-1 overflow-y-auto overscroll-contain p-4">
        {error && <div role="alert" className="rounded-xl bg-red-50 text-red-800 p-3 text-sm mb-3">{error}<button onClick={() => void load()} className="ml-2 underline">다시 시도</button></div>}
        {text ? <div className="space-y-4">
          <section className="rounded-2xl border border-stone-200 bg-white p-4"><h3 className="text-xs font-bold text-stone-500 mb-2">원문 · {languageLabel(text.sourceLang)}</h3><p className="whitespace-pre-wrap break-words text-base select-text">{text.original}</p></section>
          <section className="rounded-2xl border border-[#e9be56] bg-[#fff5d6] p-4"><h3 className="text-xs font-bold text-[#936618] mb-2">번역 · {languageLabel(text.targetLang)}</h3><p className="whitespace-pre-wrap break-words text-lg font-medium select-text">{text.translation}</p></section>
          {text.pronunciation && <section className="px-1"><h3 className="text-xs font-bold text-stone-500 mb-2">발음</h3><p className="whitespace-pre-wrap break-words text-sm text-stone-600">{text.pronunciation}</p></section>}
          <div className="flex justify-between gap-3"><button className="flex items-center gap-2 rounded-xl bg-[#552c24] text-white px-4 py-3 text-sm font-bold" onClick={async () => {
            try { await navigator.clipboard.writeText(text.translation); setCopied(true); }
            catch { setError('복사하지 못했습니다. 번역문을 길게 눌러 복사해 주세요.'); }
          }}>{copied ? <Check size={17} /> : <Copy size={17} />}{copied ? '복사됨' : '번역문 복사'}</button><button disabled={busy} onClick={() => void remove(selected!.id)} className="p-3 text-stone-500" aria-label="이 기록 삭제"><Trash2 size={19} /></button></div>
        </div> : <>
          {entries.length === 0 && !loading && !error && <div className="py-16 text-center"><History className="mx-auto mb-4 text-[#bba899]" size={42} /><h3 className="font-bold">아직 번역 기록이 없습니다</h3><p className="text-sm text-stone-500 mt-2">글이나 사진을 번역하면 자동으로 저장됩니다.</p></div>}
          <ul className="space-y-3">{entries.map(entry => <li key={entry.id} className="flex items-stretch rounded-2xl border border-[#552c24]/10 bg-white overflow-hidden">
            <button disabled={busy} onClick={() => void openEntry(entry.id)} className="flex flex-1 min-w-0 gap-3 p-3 text-left hover:bg-[#fff5d6] disabled:opacity-50">
              <span className="flex w-14 h-16 shrink-0 items-center justify-center rounded-lg bg-[#fff5d6]">{entry.kind === 'image' ? <Thumbnail blob={entry.thumbnail} /> : <MessageSquareText size={25} className="text-[#a86614]" />}</span>
              <span className="min-w-0 flex-1"><span className="flex flex-wrap gap-x-2 gap-y-0.5 text-[11px] text-stone-500 mb-1"><span>{entry.kind === 'image' ? '이미지' : '글'} · {languageLabel(entry.targetLang)}</span><time className="ml-auto">{date(entry.createdAt)}</time></span><span className="block truncate font-bold text-sm">{entry.title}</span><span className="block line-clamp-2 break-words text-xs text-stone-500 mt-1">{entry.preview || '번역 이미지 보기'}</span></span>
            </button>
            <button disabled={busy || loading} onClick={() => void remove(entry.id)} aria-label={`${entry.title} 기록 삭제`} className="px-3 text-stone-400 hover:text-red-600 disabled:opacity-40"><Trash2 size={16} /></button>
          </li>)}</ul>
          {(loading || busy) && <div role="status" className="flex justify-center items-center gap-2 py-5 text-sm text-stone-500"><Loader2 className="animate-spin" size={19} />기록을 불러오는 중</div>}
          {hasMore && !loading && <button disabled={busy} onClick={() => void load(true)} className="w-full rounded-xl border border-stone-200 py-3 mt-4 text-sm font-bold">이전 기록 더 보기</button>}
        </>}
      </div>
      <footer className="px-4 py-3 border-t border-[#552c24]/10 text-[11px] text-stone-500 bg-white">기록 열람은 AI를 다시 사용하지 않습니다. 사이트 데이터를 삭제하면 기록도 삭제됩니다.</footer>
    </div>
  </div>;
}
