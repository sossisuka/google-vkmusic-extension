import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isVkPage, audioId, allowedUrl, fileName, selectStream, normalizeTrack, durationLabel, isMp3Mime } from '../extension/shared/model.js';
import { parsePlaylist, sequenceIv, decryptSegment } from '../extension/shared/hls.js';
import { addMetadata } from '../extension/shared/id3.js';

test('VK pages and audio identities are validated separately', () => {
  for (const value of ['https://vk.com/audios1', 'https://vk.ru/music', 'https://m.vk.com/feed']) assert.ok(isVkPage(value));
  for (const value of ['http://vk.com/audios', 'https://vk.com.evil.com/', 'https://evil.vk.com/', 'https://user:pass@vk.com/', 'https://vk.com:444/', null]) assert.equal(isVkPage(value), false);
  assert.equal(audioId('-123_456'), '-123_456');
  for (const value of ['1_2/path', '1_2;alert(1)', null, '1', '1_-2']) assert.equal(audioId(value), null);
});

test('media requests reject untrusted addresses without leaking signed tokens', () => {
  for (const value of ['https://psv4.vkuseraudio.net/a.mp3', 'https://sun9.userapi.com/a.jpg', 'https://vk.com/al_audio.php']) assert.ok(allowedUrl(value));
  for (const value of ['https://vkuseraudio.net.evil.com/a', 'https://evil.com/a?token=secret', 'http://vk.com/a', 'https://user:secret@vk.ru/a', 'https://vk.ru:444/a', 'file:///a', null]) {
    assert.throws(() => allowedUrl(value), error => { assert.doesNotMatch(error.message, /secret|token|user:/); return true; });
  }
  assert.throws(() => allowedUrl('https://vk.com/mp3/audio_api_unavailable.mp3?extra=secret'), /аудиоплеера VK/);
});

test('portable filenames preserve Cyrillic and reject extension injection', () => {
  assert.equal(fileName('Север', 'Трек: <live>'), 'Север - Трек_ _live_.mp3');
  assert.equal(fileName('', 'CON'), '_CON.mp3');
  assert.ok(fileName('a'.repeat(300), 'b').length <= 174);
  assert.throws(() => fileName('a', 'b', '../exe'));
});

test('normalization handles missing artwork and selects full playable streams', () => {
  const raw = { id: '-1_2', title: 'Трек', artist: 'Автор', duration: 236, artwork: 'https://evil.com/a.jpg', source: 'https://psv4.vkuseraudio.net/a.mp3?token=private' };
  const track = normalizeTrack(raw);
  assert.equal(track.artwork, null);
  assert.equal(durationLabel(track.duration), '3:56');
  assert.equal(track.url, 'https://vk.com/audio-1_2');
  assert.equal(selectStream(track).format.protocol, 'progressive');
  assert.equal(selectStream({ ...track, source: 'https://psv4.vkuseraudio.net/index.m3u8' }).format.protocol, 'hls');
  assert.throws(() => selectStream({ ...track, restricted: true }), /превью/);
  assert.throws(() => selectStream({ ...track, source: null }), /VK не предоставил/);
  assert.equal(isMp3Mime('audio/mpeg; codecs="mp3"'), true);
  assert.equal(isMp3Mime('audio/mpegurl'), false);
});

test('cover candidates preserve signed queries, accept protocol-relative VK images and filter foreign hosts', () => {
  const track = normalizeTrack({ id: '1_2', title: 'Трек', artwork: 'https://evil.com/cover.jpg', artworkCandidates: ['//sun9.userapi.com/cover.jpg?crop=0,0,300,300&sign=test', 'https://sun9.userapi.com/small.jpg', 'https://evil.com/other.jpg'] });
  assert.equal(track.artwork, 'https://sun9.userapi.com/cover.jpg?crop=0,0,300,300&sign=test');
  assert.equal(track.artworkCandidates.length, 2);
});

test('the VK player photo CDN is allowed without rewriting signed artwork URLs', () => {
  const url = 'https://sun9-72.vkuserphoto.ru/impg/cover.jpg?size=300x300&quality=95&sign=test&type=audio';
  assert.equal(allowedUrl(url, 'обложка').href, url);
  assert.equal(normalizeTrack({ id: '1_2', title: 'POSTER', artwork: url }).artwork, url);
  assert.throws(() => allowedUrl('https://vkuserphoto.ru.evil.com/cover.jpg'));
});

const base = 'https://psv4.vkuseraudio.net/path/index.m3u8';
test('HLS handles master variants, relative URLs, fMP4 maps and durations', () => {
  assert.equal(parsePlaylist('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=64000\nlow.m3u8\n#EXT-X-STREAM-INF:BANDWIDTH=160000\nhigh.m3u8', base).variant, 'https://psv4.vkuseraudio.net/path/high.m3u8');
  assert.equal(parsePlaylist('#EXTM3U\n#EXT-X-MEDIA:TYPE=AUDIO,URI="audio.m3u8"\n#EXT-X-STREAM-INF:BANDWIDTH=1000000\nvideo.m3u8', base).variant, 'https://psv4.vkuseraudio.net/path/audio.m3u8');
  const media = parsePlaylist('#EXTM3U\n#EXT-X-MAP:URI="init.mp4"\n#EXTINF:3,\nseg1.m4s\n#EXTINF:3,\nseg2.m4s\n#EXT-X-ENDLIST', base);
  assert.deepEqual(media.segments.map(item => item.url), ['init.mp4', 'seg1.m4s', 'seg2.m4s'].map(name => `https://psv4.vkuseraudio.net/path/${name}`));
  assert.equal(media.duration, 6);
});

test('HLS AES-128 handles implicit IVs, explicit IVs, key rotation and METHOD=NONE', async () => {
  const playlist = parsePlaylist('#EXTM3U\n#EXT-X-MEDIA-SEQUENCE:37\n#EXT-X-KEY:METHOD=AES-128,URI="key"\na.ts\n#EXT-X-KEY:METHOD=AES-128,URI="key2",IV=0x0102\nb.ts\n#EXT-X-KEY:METHOD=NONE\nc.ts\n#EXT-X-ENDLIST', base);
  assert.deepEqual(playlist.segments[0].key.iv, sequenceIv(37));
  assert.equal(playlist.segments[1].key.url, 'https://psv4.vkuseraudio.net/path/key2');
  assert.deepEqual(playlist.segments[1].key.iv.slice(-2), new Uint8Array([1, 2]));
  assert.equal(playlist.segments[2].key, null);
  const keyBytes = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey('raw', keyBytes, 'AES-CBC', false, ['encrypt']);
  const original = new TextEncoder().encode('Original test audio bytes');
  const encrypted = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-CBC', iv: sequenceIv(37) }, key, original));
  assert.deepEqual(await decryptSegment(encrypted, keyBytes, sequenceIv(37)), original);
  await assert.rejects(decryptSegment(encrypted, new Uint8Array(12), sequenceIv(37)), /ключ/);
});

test('HLS rejects DRM, live, byte range, foreign keys and foreign segments', () => {
  for (const value of [
    '#EXTM3U\n#EXT-X-KEY:METHOD=SAMPLE-AES,URI="key"\na.ts\n#EXT-X-ENDLIST',
    '#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,KEYFORMAT="com.apple.streamingkeydelivery",URI="key"\na.ts\n#EXT-X-ENDLIST',
    '#EXTM3U\na.ts', '#EXTM3U\nhttps://evil.com/a.ts\n#EXT-X-ENDLIST',
    '#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="https://evil.com/key"\na.ts\n#EXT-X-ENDLIST',
    '#EXTM3U\n#EXT-X-BYTERANGE:100@0\na.ts\n#EXT-X-ENDLIST'
  ]) assert.throws(() => parsePlaylist(value, base));
});

test('ID3 embeds Unicode metadata and original artwork without changing MPEG frames', async () => {
  const audio = new Uint8Array([255, 251, 144, 100, 1, 2, 3]);
  const cover = { bytes: new Uint8Array([255, 216, 255, 224, 10]), mime: 'image/jpeg' };
  const output = new Uint8Array(await addMetadata(audio, { title: 'Трек', artist: 'Автор', url: 'https://vk.com/audio1_2' }, cover).arrayBuffer());
  assert.equal(new TextDecoder().decode(output.subarray(0, 3)), 'ID3');
  const payload = new TextDecoder('latin1').decode(output);
  for (const frame of ['TIT2', 'TPE1', 'APIC', 'WOAS', 'image/jpeg']) assert.ok(payload.includes(frame));
  assert.deepEqual(output.subarray(-audio.length), audio);
  const replaced = new Uint8Array(await addMetadata(output, { title: 'Replacement', artist: 'Artist' }).arrayBuffer());
  assert.equal(new TextDecoder('latin1').decode(replaced).split('TIT2').length, 2);
  assert.deepEqual(replaced.subarray(-audio.length), audio);
});
