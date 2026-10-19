import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeTranslationNotes } from '../src/utils/translationNotes.ts';

test('legacy responses and malformed note fields do not break image translation', () => {
  for (const value of [undefined, null, '', 'notes', 1, {}, { original: 'name' }]) {
    assert.deepEqual(normalizeTranslationNotes(value), []);
  }
  assert.deepEqual(normalizeTranslationNotes([null, 42, 'note', {}, { original: 'name' }, { original: ' ', explanation: 'text' }, { original: 'name', explanation: {} }]), []);
});

test('multiple explanations retain source, translated wording and pronunciation', () => {
  const notes = [
    { original: ' モナ王 ', translation: ' 모나왕 ', explanation: ' 상품 이름입니다. ' },
    { original: '布団が吹っ飛んだ', translation: '이불이 날아갔다', explanation: '布団(ふとん, 후톤)과 吹っ飛んだ(ふっとんだ, 훗톤다)의 비슷한 소리를 이용합니다.\n번역에서는 소리의 유사성이 사라집니다.' },
  ];
  const before = JSON.stringify(notes);
  const result = normalizeTranslationNotes(notes);
  assert.equal(result.length, 2);
  assert.deepEqual(result[0], { original: 'モナ王', translation: '모나왕', explanation: '상품 이름입니다.' });
  assert.deepEqual(result[1], notes[1]);
  assert.equal(JSON.stringify(notes), before, 'normalization must not change the translation response');
});

test('valid notes survive incomplete siblings and missing optional translations', () => {
  assert.deepEqual(normalizeTranslationNotes([
    { original: 'invalid', explanation: '' },
    { original: 'name', explanation: 'identity is uncertain', translation: { unexpected: true } },
  ]), [{ original: 'name', explanation: 'identity is uncertain', translation: '' }]);
});
