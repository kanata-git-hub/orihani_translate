import React, { useEffect, useState } from 'react';
import { X, Loader2, RefreshCw, ExternalLink } from 'lucide-react';

export function UsagiIcon() {
  return <svg viewBox="0 0 32 36" width="25" height="28" fill="none" aria-hidden="true">
    <path d="M9 18C6 10 7 2 10 2c3 0 4 9 4 14h3C17 10 19 2 22 3c3 1 1 10-1 15 6 2 9 7 7 11-3 7-22 7-24 0-2-5 0-9 5-11Z" fill="#fff0af" stroke="currentColor" strokeWidth="1.6"/>
    <path d="m10 6 1 8m10-7-2 8" stroke="#efa8a6" strokeWidth="2" strokeLinecap="round"/>
    <ellipse cx="10" cy="24" rx="1.5" ry="2" fill="currentColor"/><ellipse cx="22" cy="24" rx="1.5" ry="2" fill="currentColor"/>
    <path d="m14 26 2 1 2-1m-2 1v3m-3-1q3 3 6 0" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
    <path d="M6 27h3m14 0h3" stroke="#efa8a6" strokeWidth="2" strokeLinecap="round"/>
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
