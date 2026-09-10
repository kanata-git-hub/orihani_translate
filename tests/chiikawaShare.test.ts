import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractChiikawaPost, readSharedPost } from '../src/utils/chiikawaShare.ts';

const post = 'https://x.com/ngnchiikawa/status/1975148037057229056';

test('Android shares accept URL, text or title fields, including X commentary', () => {
  assert.equal(readSharedPost(`?url=${encodeURIComponent(`${post}?s=20`)}`, ''), post);
  assert.equal(readSharedPost(`?title=ちいかわ&text=${encodeURIComponent(`만화예요!\n${post}?s=46`)}`, ''), post);
  assert.equal(readSharedPost(`?title=${encodeURIComponent(`(${post})`)}`, ''), post);
  assert.equal(readSharedPost(`?url=garbage&text=${encodeURIComponent(post)}`, ''), post);
});

test('iPhone shortcut input preserves a chosen photo and handles encoded text', () => {
  const photo = `${post}/photo/2`;
  assert.equal(readSharedPost('', `#${encodeURIComponent(`ちいかわ 🎉\n${photo}?s=21`)}`), photo);
  assert.equal(readSharedPost('', `#${post}`), post);
  assert.equal(extractChiikawaPost([post.replace('x.com', 'mobile.twitter.com')]), post);
});

test('untrusted shares cannot send users or the image proxy to another site/account', () => {
  for (const value of [
    post.replace('x.com', 'x.com.evil.example'),
    post.replace('x.com', 'x.com@evil.example'),
    post.replace('x.com', 'user:password@x.com'),
    post.replace('x.com', 'x.com:8080'),
    post.replace('ngnchiikawa', 'other'),
    post.replace('https:', 'javascript:'),
    'https://x.com/ngnchiikawa/media?filter=photo',
    `${post}/photo/5`, `${post}/edit`,
    `${'x'.repeat(8193)}${post}`,
  ]) assert.equal(extractChiikawaPost([value]), null, value.slice(0, 100));
  assert.equal(readSharedPost('', '#%E0%A4%A'), null);
  assert.equal(readSharedPost(`?text=${'x'.repeat(17000)}`, ''), null);
});
