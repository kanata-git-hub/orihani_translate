export interface TranslationNote {
  original: string;
  translation: string;
  explanation: string;
}

// Older responses may have no notes; malformed model output must not break translation.
export function normalizeTranslationNotes(value: unknown): TranslationNote[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap(item => {
    if (!item || typeof item !== 'object') return [];
    const original = typeof item.original === 'string' ? item.original.trim() : '';
    const explanation = typeof item.explanation === 'string' ? item.explanation.trim() : '';
    if (!original || !explanation) return [];
    return [{ original, explanation, translation: typeof item.translation === 'string' ? item.translation.trim() : '' }];
  });
}
