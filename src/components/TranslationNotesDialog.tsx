import React, { useEffect, useRef } from 'react';
import { X, BookOpen, Tag } from 'lucide-react';
import type { TranslationNote } from '../utils/translationNotes';

export function TranslationNotesDialog({ kind, notes, onClose }: {
  kind: 'brand' | 'wordplay';
  notes: TranslationNote[];
  onClose: () => void;
}) {
  const closeButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null;
    closeButton.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        onClose();
      } else if (event.key === 'Tab') {
        // The close button is this read-only dialog's only interactive control.
        event.preventDefault();
        closeButton.current?.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, [onClose]);

  const isWordplay = kind === 'wordplay';
  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4" onClick={onClose}>
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="translation-notes-title"
        className="w-full max-w-xl max-h-full min-h-0 flex flex-col rounded-2xl bg-white shadow-2xl border border-black/10"
        onClick={event => event.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 p-5 border-b border-black/5 shrink-0">
          <h3 id="translation-notes-title" className="flex items-center gap-2 font-bold text-lg text-[#552c24]">
            {isWordplay ? <BookOpen size={20} /> : <Tag size={20} />}
            {isWordplay ? '말장난 해설' : '브랜드·상품 설명'}
          </h3>
          <button ref={closeButton} onClick={onClose} aria-label="해설 닫기" className="w-9 h-9 shrink-0 flex items-center justify-center rounded-full bg-gray-100 hover:bg-gray-200 text-gray-600">
            <X size={18} />
          </button>
        </div>
        <div className="overflow-y-auto min-h-0 p-5 space-y-4 overscroll-contain">
          {notes.map((note, index) => (
            <article key={index} className="rounded-xl border border-[#ffcd4a]/30 bg-[#ffcd4a]/10 p-4 space-y-2">
              <h4 className="font-bold text-[#552c24] whitespace-pre-wrap break-words">{note.original}</h4>
              {note.translation && <p className="text-sm text-[#552c24]/70 whitespace-pre-wrap break-words">번역: {note.translation}</p>}
              <p className="text-[15px] leading-relaxed text-gray-700 whitespace-pre-wrap break-words">{note.explanation}</p>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
