import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isSaverPage, playlistAddress } from '../extension/shared/website.js';
test('the website bridge is restricted to VKSaver on its deployed origin', () => {
  assert.equal(isSaverPage('https://inetcdn.online/vksaver/'), true); assert.equal(isSaverPage('http://127.0.0.1:4175/vksaver/'), true);
  for (const url of ['https://inetcdn.online/', 'https://inetcdn.online.evil.test/vksaver/', 'http://inetcdn.online/vksaver/', 'https://user@inetcdn.online/vksaver/', 'https://evil.test/vksaver/']) assert.equal(isSaverPage(url), false);
});
test('playlist addresses preserve owner, album and access hash', () => {
  assert.deepEqual(playlistAddress('https://vk.com/music/album/-42_123_hash'), { kind: 'playlist', ownerId: '-42', playlistId: '123', accessHash: 'hash' });
  assert.deepEqual(playlistAddress('https://vk.ru/audios42?z=audio_playlist42_123&access_hash=secret'), { kind: 'playlist', ownerId: '42', playlistId: '123', accessHash: 'secret' });
  for (const url of ['https://evil.test/music/album/42_1', 'https://vk.com/audio42_1', 'javascript:alert(1)']) assert.throws(() => playlistAddress(url));
});
