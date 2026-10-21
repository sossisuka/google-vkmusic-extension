import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readVkPage } from '../extension/page-reader.js';
import { decodeAudioUrl } from '../extension/shared/audio-url.js';

const source = 'https://psv4.vkuseraudio.net/tone.mp3';
const masked = 'https://vk.com/mp3/audio_api_unavailable.mp3?extra=m3bTlMvUB3qVDgvUlM9PzhvHCMvZDwT2lJr2C3aVlZPZChrOAa#DG';
const audio = (url = '') => [1, 42, url, 'Трек', 'Автор', 180, 0, 0, '', 0, 82, '', '[]', '/edit/action/delete/replace/urlhash'];

async function withPage(raw, options, check) {
  const names = ['window', 'document', 'location', 'fetch', 'getComputedStyle'];
  const saved = names.map(name => Object.getOwnPropertyDescriptor(globalThis, name));
  const row = { getAttribute: key => key === 'data-full-id' ? '42_1' : key === 'data-audio' ? JSON.stringify(raw) : null, querySelector: selector => selector.includes('cover') ? options.cover || null : null, querySelectorAll: () => options.cover ? [options.cover] : [] };
  const requests = [];
  try {
    globalThis.window = { vk: { id: 123 }, getAudioPlayer: () => ({ getCurrentAudio: () => raw, getAudioById: () => raw }), ...options.window };
    globalThis.document = { querySelectorAll: selector => selector === 'audio' ? [] : selector.includes('img[alt=') ? options.playerCovers || [] : [row], createElement: () => ({ set innerHTML(value) { this.value = value; } }) };
    globalThis.location = new URL(options.url || 'https://vk.com/audios42');
    globalThis.getComputedStyle = element => ({ backgroundImage: element.computedBackground || 'none' });
    globalThis.fetch = async (url, init) => {
      requests.push({ url, init });
      return { ok: options.status === undefined || options.status === 200, status: options.status || 200, text: async () => options.response || '{}' };
    };
    await check(requests);
  } finally {
    names.forEach((name, index) => { if (saved[index]) Object.defineProperty(globalThis, name, saved[index]); else delete globalThis[name]; });
  }
}

test('masked links survive page reading when VK does not expose its decoder', async () => {
  await withPage(audio(masked), {}, async requests => {
    const page = await readVkPage('42_1');
    assert.equal(decodeAudioUrl(page.tracks[0].source, page.viewerId), source);
    assert.equal(requests.length, 0);
  });
});

test('album thumbnail objects supply the largest actual cover URL', async () => {
  const raw = { id: 1, owner_id: 42, title: 'Трек', album: { thumb: { photo_68: 'https://sun9.userapi.com/small.jpg', photo_600: 'https://sun9.userapi.com/large.jpg' } } };
  await withPage(raw, {}, async () => {
    const page = await readVkPage('42_1');
    assert.equal(page.tracks[0].artwork, 'https://sun9.userapi.com/large.jpg');
  });
});

test('player records without covers retain artwork from the matching page row', async () => {
  const rowAudio = audio(source); rowAudio[14] = 'https://sun9.userapi.com/cover.jpg';
  const cached = audio(source);
  await withPage(rowAudio, { window: { getAudioPlayer: () => ({ getCurrentAudio: () => cached, getAudioById: () => cached }) } }, async () => {
    const page = await readVkPage('42_1');
    assert.equal(page.tracks[0].artwork, rowAudio[14]);
  });
});

test('current player artwork is read by its stable alt text outside legacy audio rows', async () => {
  const url = 'https://sun9-72.vkuserphoto.ru/impg/cover.jpg?size=300x300&quality=95&sign=test&type=audio';
  const image = { currentSrc: url, getAttribute: name => name === 'src' ? url : null, closest: () => null, getClientRects: () => [{}] };
  await withPage(audio(source), { playerCovers: [image] }, async () => {
    const page = await readVkPage('42_1');
    assert.equal(page.tracks[0].artwork, url);
  });
});

test('the current player image is never assigned to another audio record', async () => {
  const url = 'https://sun9-72.vkuserphoto.ru/impg/current.jpg?sign=test';
  const image = { currentSrc: url, getAttribute: () => url, closest: () => null, getClientRects: () => [{}] };
  const current = audio(source); current[0] = 2;
  await withPage(audio(source), { playerCovers: [image], window: { getAudioPlayer: () => ({ getCurrentAudio: () => current }) } }, async () => {
    const page = await readVkPage('42_1');
    assert.equal(page.tracks.find(track => track.id === '42_1').artwork, null);
    assert.equal(page.tracks.find(track => track.id === '42_2').artwork, url);
  });
});

test('cover list parsing preserves commas inside signed crop parameters', async () => {
  const raw = audio(source);
  const large = 'https://sun9.userapi.com/large.jpg?crop=0,0,100,100&sign=test';
  raw[14] = `https://sun9.userapi.com/small.jpg,${large}`;
  await withPage(raw, {}, async () => {
    const page = await readVkPage('42_1');
    assert.equal(page.tracks[0].artwork, large);
  });
});

test('class-based and lazy-loaded row covers are read from the matching DOM row', async () => {
  for (const cover of [
    { style: {}, computedBackground: 'url("https://sun9.userapi.com/computed.jpg")', getAttribute: () => null },
    { style: {}, getAttribute: name => name === 'data-src' ? 'https://sun9.userapi.com/lazy.jpg' : null }
  ]) {
    await withPage(audio(source), { cover }, async () => {
      const page = await readVkPage('42_1');
      assert.equal(page.tracks[0].artwork, cover.computedBackground ? 'https://sun9.userapi.com/computed.jpg' : 'https://sun9.userapi.com/lazy.jpg');
    });
  }
});

test('new object records reload with their own hashes without window.ajax', async () => {
  const raw = { id: 1, owner_id: 42, title: 'Трек', artist: 'Автор', actionHash: 'objectAction', urlHash: 'objectUrl' };
  await withPage(raw, { response: `<!--${JSON.stringify({ payload: ['0', [[audio(masked)]]] })}` }, async requests => {
    const page = await readVkPage('42_1', true);
    assert.equal(decodeAudioUrl(page.tracks[0].source, page.viewerId), source);
    assert.equal(page.mediaError, null);
    assert.equal(requests[0].url, 'https://vk.com/al_audio.php');
    assert.equal(requests[0].init.credentials, 'same-origin');
    assert.equal(new URLSearchParams(requests[0].init.body).get('ids'), '42_1_objectAction_objectUrl');
  });
});

test('nested native AJAX results resolve the requested track', async () => {
  await withPage(audio(), { window: { ajax: { post: (url, data, callbacks) => callbacks.onDone({ data: [[audio(source)]] }) } } }, async requests => {
    const page = await readVkPage('42_1', true);
    assert.equal(page.tracks[0].source, source);
    assert.equal(requests.length, 0);
  });
});

test('mobile playback responses and legacy separators are parsed without executing code', async () => {
  for (const response of [JSON.stringify({ data: [[audio(source)]] }), `0<!>window.untrusted=true<!>${JSON.stringify([audio(source)])}`]) {
    await withPage(audio(), { url: 'https://m.vk.ru/audio', response }, async requests => {
      const page = await readVkPage('42_1', true);
      assert.equal(page.tracks[0].source, source);
      assert.equal(requests[0].url, 'https://m.vk.ru/audio');
      assert.equal(window.untrusted, undefined);
    });
  }
});

test('reload never substitutes a different recording and reports rate limiting or login', async () => {
  const other = audio(source); other[0] = 2;
  for (const options of [
    { response: JSON.stringify({ payload: ['0', [[other]]] }), expected: /не предоставил/ },
    { response: JSON.stringify({ payload: ['3', []] }), expected: /Войдите/ },
    { status: 429, expected: /частоту/ }
  ]) {
    await withPage(audio(), options, async () => {
      const page = await readVkPage('42_1', true);
      assert.equal(page.tracks[0].source, null);
      assert.match(page.mediaError, options.expected);
    });
  }
});
