import React, { useEffect, useState } from 'react';
import { X, Loader2, RefreshCw, ExternalLink } from 'lucide-react';

export function UsagiIcon() {
  return <svg viewBox="0 0 32 36" width="28" height="32" fill="none" aria-hidden="true">
    <path d="M9.5 16C8 11 8 2.5 10.5 1.5c3-1 3.5 8.5 3.5 14h3.5C17.5 9 18.5 .5 21 1c3 .5 2.5 10.5 1 16.5 4.5 2 7 5.5 7 10 0 6.5-5.5 8-13 8s-13-1.5-13-8c0-4.5 2-9 6.5-11.5Z" fill="#fff0af" stroke="currentColor" strokeWidth="1.6"/>
    <path d="m10 6 1 8m10-7-2 8" stroke="#efa8a6" strokeWidth="2" strokeLinecap="round"/>
    <path d="M8 20q2-2 4-.5m8 0q2-1.5 4 .5" stroke="#49392d" strokeWidth="1.2" strokeLinecap="round"/>
    <ellipse cx="10.5" cy="23.5" rx="1.7" ry="2.1" fill="#30291f"/><ellipse cx="21.5" cy="23.5" rx="1.7" ry="2.1" fill="#30291f"/>
    <circle cx="10" cy="23" r=".55" fill="white"/><circle cx="21" cy="23" r=".55" fill="white"/>
    <path d="M14.5 26q1.5-1 3 0m-4 1.5q.5 2 2.5 .5 2 1.5 2.5-.5m-3.5 3q1 1.5 2 0" stroke="#49392d" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round"/>
    <ellipse cx="7" cy="27" rx="2.5" ry="1.6" fill="#f2b3b0"/><ellipse cx="25" cy="27" rx="2.5" ry="1.6" fill="#f2b3b0"/>
    <path d="m6 26.5-.4 1m1.5-1-.4 1m17-1-.4 1m1.5-1-.4 1" stroke="#bc7979" strokeWidth=".6" strokeLinecap="round"/>
  </svg>;
}

interface Photo { id: string; imageUrl: string; postUrl: string; alt: string; createdAt: string }
export function ChiikawaGallery({ onClose, onSelect }: { onClose: () => void; onSelect: (file: File) => void }) {
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [configured, setConfigured] = useState(true);
  const [attempt, setAttempt] = useState(0);
  const [selecting, setSelecting] = useState<string | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError('');
    fetch('/api/chiikawa/photos', { signal: controller.signal }).then(async res => {
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '사진을 불러오지 못했습니다.');
      setConfigured(data.configured); setPhotos(data.photos);
    }).catch(err => { if (!controller.signal.aborted) setError(err.message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [attempt]);
  const select = async (photo: Photo) => {
    setSelecting(photo.id); setError('');
    try {
      const res = await fetch(`/api/chiikawa/image/${encodeURIComponent(photo.id)}`);
      if (!res.ok) throw new Error('원본 이미지를 불러오지 못했습니다. 다시 시도해 주세요.');
      const blob = await res.blob();
      onSelect(new File([blob], `chiikawa-${photo.id}.jpg`, { type: blob.type }));
    } catch (err) { setError(err instanceof Error ? err.message : '이미지 오류'); }
    finally { setSelecting(null); }
  };
  return <div className="fixed inset-0 z-50 bg-black/60 p-3 flex items-center justify-center">
    <section role="dialog" aria-modal="true" aria-label="치이카와 만화" className="w-full max-w-lg max-h-[92dvh] overflow-auto bg-[#fffdf5] text-[#552c24] rounded-3xl p-4 shadow-xl">
      <header className="flex items-center gap-2 mb-3"><UsagiIcon/><h2 className="font-bold text-xl flex-1">치이카와 만화</h2>
        <button aria-label="새로고침" disabled={loading || !!selecting} onClick={() => setAttempt(n => n + 1)} className="p-2"><RefreshCw size={20}/></button>
        <button aria-label="닫기" onClick={onClose} className="p-2"><X/></button>
      </header>
      <p className="text-sm mb-4">@ngnchiikawa · 최신 사진 9장 · 누르면 한국어로 번역해요.</p>
      {loading ? <div className="p-16 flex justify-center"><Loader2 className="animate-spin"/></div> : !configured ?
        <div className="rounded-2xl bg-[#ffcd4a]/15 p-6 text-center"><p className="font-bold mb-2">최신 만화 연결을 준비하고 있어요</p><p className="text-sm">지금은 공식 계정에서 사진을 확인하고 카메라 메뉴로 이미지를 선택해 번역할 수 있어요.</p></div> :
        <div className="grid grid-cols-3 gap-1.5">{photos.map(photo => <button key={photo.id} disabled={!!selecting} onClick={() => select(photo)} className="aspect-square relative overflow-hidden rounded-lg bg-white border border-black/5" aria-label={`${photo.alt || '치이카와 만화'} 번역`}>
          <img src={photo.imageUrl} alt={photo.alt || '치이카와 만화'} loading="lazy" className="w-full h-full object-cover"/>
          {selecting === photo.id && <span className="absolute inset-0 bg-white/80 flex items-center justify-center"><Loader2 className="animate-spin"/></span>}
        </button>)}</div>}
      {!loading && configured && !error && !photos.length && <p className="p-6 text-center">표시할 사진이 없습니다.</p>}
      {error && <p role="alert" className="my-3 text-red-700 text-sm">{error}</p>}
      <a href="https://x.com/ngnchiikawa/media?filter=photo" target="_blank" rel="noreferrer" className="flex justify-center items-center gap-2 mt-5 text-sm underline">공식 계정에서 보기 <ExternalLink size={14}/></a>
    </section>
  </div>;
}
