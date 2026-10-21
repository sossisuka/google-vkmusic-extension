import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createCipheriv } from 'node:crypto';
import puppeteer from 'puppeteer-core';

const root = process.cwd();
const artifacts = path.join(root, 'artifacts');
await mkdir(artifacts, { recursive: true });
async function findChrome(directory) {
  try {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.isDirectory()) { const found = await findChrome(path.join(directory, entry.name)); if (found) return found; }
      else if (entry.name === 'chrome.exe') return path.join(directory, entry.name);
    }
  } catch { /* Try the next available browser location. */ }
}
const executablePath = process.env.CHROME_PATH || await findChrome(path.join(root, '.browsers')) || await findChrome(path.resolve(root, '../google-soundcloud-extension/.browsers'));
if (!executablePath) throw new Error('Set CHROME_PATH or install Chrome for Testing: npx @puppeteer/browsers install chrome@stable --path .browsers');
const profile = await mkdtemp(path.join(artifacts, 'profile-'));
await mkdir(path.join(profile, 'Default'), { recursive: true });
await mkdir(path.join(artifacts, 'downloads'), { recursive: true });
await writeFile(path.join(profile, 'Default/Preferences'), JSON.stringify({ download: { default_directory: path.join(artifacts, 'downloads'), prompt_for_download: false } }));
const browser = await puppeteer.launch({ executablePath, headless: true, userDataDir: profile, enableExtensions: [path.join(root, 'dist')], args: ['--no-first-run', '--disable-features=DownloadBubble'] });
const errors = [], report = [], fixtures = new Map(), playbackRequests = [];
const cover = await readFile(path.join(root, 'static/preview-cover.jpg'));
const playerCoverMarkup = await readFile(path.join(root, 'tests/fixtures/player-cover.html'), 'utf8');
const playerCoverUrl = playerCoverMarkup.match(/src="([^"]+)"/)[1].replaceAll('&amp;', '&');
const playerCoverBytes = await readFile(path.join(root, 'tests/fixtures/player-cover.jpg'));
let worker, extensionId, fixtureTab;
console.log('Isolated Chrome launched.');

async function intercept(target) {
  const cdp = await target.createCDPSession();
  await cdp.send('Fetch.enable', { patterns: ['vk.com', 'vk.ru', '*.vkuseraudio.net', '*.userapi.com', '*.vkuserphoto.ru'].map(host => ({ urlPattern: `https://${host}/*` })) });
  cdp.on('Fetch.requestPaused', async event => {
    try {
      const url = new URL(event.request.url);
      if (url.pathname === '/al_audio.php') playbackRequests.push(event.request.postData || '');
      const value = fixtures.get(url.pathname);
      // Keep browser tests offline even when production requests are unexpected.
      await cdp.send('Fetch.fulfillRequest', { requestId: event.requestId, responseCode: value?.status || (value ? 200 : 404), responseHeaders: [{ name: 'Content-Type', value: value?.type || 'text/plain' }, { name: 'Access-Control-Allow-Origin', value: '*' }], body: Buffer.from(value?.body || 'Fixture not found').toString('base64') });
    } catch (error) { errors.push(`Intercept: ${error.message}`); }
  });
  await cdp.send('Runtime.enable');
  cdp.on('Runtime.exceptionThrown', event => errors.push(event.exceptionDetails.exception?.description || event.exceptionDetails.text));
  return cdp;
}
function audio(id, title, source, extra = {}) {
  const value = [id, 42, source, title, 'Север', 1, 0, 0, '', 0, 82, '', '[]', '/edit/action/delete/replace/urlhash', 'https://sun9.userapi.com/cover.jpg'];
  return Object.assign(value, extra);
}
const records = [audio(1, 'Тихий берег', 'https://psv4.vkuseraudio.net/tone.mp3'), audio(2, 'Останемся здесь', 'https://psv4.vkuseraudio.net/playlist.m3u8'), audio(3, 'Город засыпает', ''), audio(4, 'Последний трамвай', 'https://psv4.vkuseraudio.net/encrypted.m3u8')];
function fixtureHtml() {
  const rows = records.map(raw => `<div class="audio_row" data-full-id="42_${raw[0]}" data-audio="${JSON.stringify(raw).replaceAll('&', '&amp;').replaceAll('"', '&quot;')}"><div class="audio_row__cover"></div><div class="audio_row__performer_title"><a class="audio_row__performer">Север</a><div class="audio_row__title"><span class="audio_row__title_inner">${raw[3]}</span></div></div><div class="audio_row__info"></div></div>`).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><style>body{margin:0;background:#edeef0;color:#333;font:13px Arial}.bar{height:48px;background:#4a76a8;color:white;padding:0 30px;display:flex;align-items:center;font-weight:bold}.music{width:700px;margin:30px auto;background:white;border:1px solid #dce1e6;padding:24px}h1{font-size:18px;color:#45688e;margin:0 0 20px}.audio_row{display:flex;align-items:center;gap:14px;min-height:65px;border-bottom:1px solid #eee}.audio_row__cover{width:42px;height:42px;background:#e3e8ed}.audio_row__performer_title{flex:1}.audio_row__performer{font-weight:bold;color:#45688e}.audio_row__title{margin-top:5px;color:#888}.audio_row__info{display:flex;align-items:center}</style></head><body><div class="bar">ВКонтакте · Музыка</div><div class="music"><h1>Мои аудиозаписи</h1>${rows}</div><script>window.testRecords=${JSON.stringify(records)};window.testCurrent=window.testRecords[0];window.getAudioPlayer=()=>({getCurrentAudio:()=>window.testCurrent,getAudioById:id=>window.testRecords.find(raw=>'42_'+raw[0]===id)});window.audioClicks=0;document.querySelectorAll('.audio_row').forEach(row=>row.addEventListener('click',()=>window.audioClicks++));</script></body></html>`;
}
async function waitForJob(previousId = null, status = 'complete') {
  await worker.waitForFunction(async ({ tabId, previousId, status }) => {
    const job = (await chrome.storage.session.get(`job:${tabId}`))[`job:${tabId}`];
    if (job && job.id !== previousId && job.status === 'error' && status !== 'error') throw new Error(job.message);
    return job && job.id !== previousId && job.status === status;
  }, { timeout: 60000, polling: 100 }, { tabId: fixtureTab, previousId, status });
  return worker.evaluate(async id => (await chrome.storage.session.get(`job:${id}`))[`job:${id}`], fixtureTab);
}
async function savedFile(job) {
  const [item] = await worker.evaluate(id => chrome.downloads.search({ id }), job.downloadId);
  assert.equal(item.state, 'complete');
  return { item, bytes: await readFile(item.filename) };
}
try {
  const target = await browser.waitForTarget(item => item.type() === 'service_worker' && item.url().endsWith('/background.js'));
  extensionId = new URL(target.url()).host;
  await intercept(target);
  worker = await browser.newPage();
  await worker.goto(`chrome-extension://${extensionId}/popup.html`);
  const popup = await browser.newPage();
  await popup.setViewport({ width: 430, height: 600, deviceScaleFactor: 1 });
  popup.on('pageerror', error => errors.push(error.message));
  await popup.setRequestInterception(true);
  popup.on('request', request => {
    const url = new URL(request.url());
    if (!['userapi.com', 'vkuserphoto.ru'].some(host => url.hostname === host || url.hostname.endsWith(`.${host}`))) return request.continue();
    const value = fixtures.get(url.pathname);
    return request.respond({ status: value?.status || 200, contentType: value?.type || 'image/jpeg', body: value?.body || cover });
  });
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);
  assert.equal(await popup.$eval('#download', element => element.disabled), true);
  await popup.screenshot({ path: path.join(artifacts, 'popup-empty.png'), fullPage: true });
  report.push('Extension loads in actual Chrome Manifest V3; unrelated tabs show an honest empty state.');

  const generated = await popup.evaluate(async () => {
    const { FFmpeg } = await import('./vendor/ffmpeg/index.js');
    const ff = new FFmpeg();
    await ff.load({ classWorkerURL: chrome.runtime.getURL('vendor/ffmpeg/worker.js'), coreURL: chrome.runtime.getURL('vendor/core/ffmpeg-core.js'), wasmURL: chrome.runtime.getURL('vendor/core/ffmpeg-core.wasm') });
    const samples = 22050, wav = new Uint8Array(44 + samples * 2), view = new DataView(wav.buffer);
    const text = (offset, value) => { for (let i = 0; i < value.length; i++) wav[offset + i] = value.charCodeAt(i); };
    text(0, 'RIFF'); view.setUint32(4, wav.length - 8, true); text(8, 'WAVEfmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, 22050, true); view.setUint32(28, 44100, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true); text(36, 'data'); view.setUint32(40, samples * 2, true);
    for (let i = 0; i < samples; i++) view.setInt16(44 + i * 2, Math.round(Math.sin(i * 2 * Math.PI * 440 / 22050) * 8000), true);
    await ff.writeFile('tone.wav', wav);
    if (await ff.exec(['-i', 'tone.wav', '-c:a', 'libmp3lame', 'tone.mp3']) !== 0) throw new Error('Fixture MP3 encoding failed');
    if (await ff.exec(['-i', 'tone.wav', '-c:a', 'aac', '-f', 'hls', '-hls_time', '0.5', '-hls_segment_type', 'fmp4', '-hls_playlist_type', 'vod', '-hls_segment_filename', 'segment%d.m4s', 'fixture.m3u8']) !== 0) throw new Error('Fixture AAC encoding failed');
    const result = { mp3: [...await ff.readFile('tone.mp3')], playlist: await ff.readFile('fixture.m3u8', 'utf8'), media: [] };
    for (const file of await ff.listDir('/')) if (file.name.endsWith('.m4s') || file.name === 'init.mp4') result.media.push({ name: file.name, bytes: [...await ff.readFile(file.name)] });
    ff.terminate(); return result;
  });
  fixtures.set('/tone.mp3', { type: 'audio/mpeg', body: Buffer.from(generated.mp3) });
  fixtures.set('/playlist.m3u8', { type: 'application/vnd.apple.mpegurl', body: generated.playlist });
  fixtures.set('/cover.jpg', { type: 'image/jpeg', body: cover });
  fixtures.set(new URL(playerCoverUrl).pathname, { type: 'image/jpeg', body: playerCoverBytes });
  fixtures.set('/broken-cover.jpg', { status: 403, type: 'text/plain', body: 'Unavailable cover size' });
  fixtures.set('/al_audio.php', { type: 'application/json', body: JSON.stringify({ payload: ['0', [[]]] }) });
  for (const file of generated.media) fixtures.set(`/${file.name}`, { type: 'audio/mp4', body: Buffer.from(file.bytes) });
  const key = Buffer.alloc(16, 37), iv = Buffer.alloc(16); iv[15] = 37;
  fixtures.set('/key.bin', { type: 'application/octet-stream', body: key });
  let encryptedPlaylist = generated.playlist.replace('#EXTM3U', '#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="key.bin",IV=0x25');
  for (const file of generated.media) {
    const cipher = createCipheriv('aes-128-cbc', key, iv);
    fixtures.set(`/encrypted-${file.name}`, { type: 'application/octet-stream', body: Buffer.concat([cipher.update(Buffer.from(file.bytes)), cipher.final()]) });
    encryptedPlaylist = encryptedPlaylist.replaceAll(file.name, `encrypted-${file.name}`);
  }
  fixtures.set('/encrypted.m3u8', { type: 'application/vnd.apple.mpegurl', body: encryptedPlaylist });
  fixtures.set('/audios42', { type: 'text/html; charset=utf-8', body: fixtureHtml() });
  await popup.evaluate(() => chrome.offscreen.createDocument({ url: 'offscreen.html', reasons: ['BLOBS', 'WORKERS'], justification: 'Validate local conversion with original test audio.' }));
  await intercept(await browser.waitForTarget(item => item.url().endsWith('/offscreen.html')));
  const fixture = await browser.newPage();
  fixture.on('pageerror', error => errors.push(error.message));
  await fixture.setViewport({ width: 1000, height: 700 });
  await intercept(fixture.target());
  await fixture.goto('https://vk.com/audios42');
  await fixture.waitForFunction(() => document.querySelectorAll('.vkmd-download').length === 4);
  await fixture.evaluate(() => {
    // Modern album metadata remains in the row even when the player cache omits it.
    const rowAudio = { id: 1, owner_id: 42, title: 'Тихий берег', artist: 'Север', duration: 1, url: 'https://psv4.vkuseraudio.net/tone.mp3', album: { thumb: { photo_68: 'https://sun9.userapi.com/cover.jpg', photo_600: 'https://sun9.userapi.com/cover.jpg?crop=0,0,300,300&sign=test' } } };
    document.querySelector('[data-full-id="42_1"]').dataset.audio = JSON.stringify(rowAudio);
    const { album, ...cached } = rowAudio;
    window.testRecords[0] = cached; window.testCurrent = cached;
    window.testRecords[1][14] = 'https://sun9.userapi.com/cover.jpg?crop=0,0,100,100&sign=test,https://sun9.userapi.com/broken-cover.jpg';
    document.querySelector('[data-full-id="42_2"]').dataset.audio = JSON.stringify(window.testRecords[1]);
    const style = document.createElement('style');
    style.textContent = '.fixture-cover { background-image: url("https://sun9.userapi.com/cover.jpg"); }'; document.head.append(style);
    window.testRecords[2][14] = '';
    document.querySelector('[data-full-id="42_3"]').dataset.audio = JSON.stringify(window.testRecords[2]);
    document.querySelector('[data-full-id="42_3"] .audio_row__cover').classList.add('fixture-cover');
    window.testRecords[3][14] = '';
    document.querySelector('[data-full-id="42_4"]').dataset.audio = JSON.stringify(window.testRecords[3]);
    const image = document.createElement('img'); image.dataset.src = 'https://sun9.userapi.com/cover.jpg';
    document.querySelector('[data-full-id="42_4"] .audio_row__cover').append(image);
  });
  fixtureTab = await worker.evaluate(async () => (await chrome.tabs.query({ url: 'https://vk.com/audios42' }))[0].id);
  await fixture.bringToFront(); await popup.reload();
  await popup.waitForFunction(() => !document.getElementById('download').disabled, { timeout: 15000 });
  assert.equal(await popup.$eval('#track-title', element => element.textContent), 'Тихий берег');
  assert.equal(await popup.$$eval('.track-row', elements => elements.length), 4);
  await popup.waitForFunction(() => {
    const images = [document.getElementById('artwork'), ...document.querySelectorAll('.track-row > img')];
    return images.length === 5 && images.every(image => image.complete && image.naturalWidth > 0 && !image.classList.contains('placeholder') && image.src.includes('userapi.com'));
  });
  assert.equal(await popup.$eval('#artwork', image => image.src), 'https://sun9.userapi.com/cover.jpg?crop=0,0,300,300&sign=test');
  report.push('Regression: album thumbnails, retained row artwork, computed CSS covers and lazy images render as real images in the popup and list; unavailable large covers fall back to another actual track image.');
  await popup.screenshot({ path: path.join(artifacts, 'popup.png'), fullPage: true });
  await fixture.screenshot({ path: path.join(artifacts, 'vk-buttons.png') });
  await popup.bringToFront();
  await popup.type('#search', 'Останемся');
  assert.equal(await popup.$$eval('.track-row', elements => elements.length), 1);
  await popup.click('.track-row');
  assert.equal(await popup.$eval('#track-title', element => element.textContent), 'Останемся здесь');
  await popup.waitForFunction(() => { const image = document.getElementById('artwork'); return image.complete && image.naturalWidth > 0 && image.src.includes('cover.jpg?crop=0,0,100,100'); });
  await popup.click('#save-cover');
  await popup.waitForFunction(() => document.getElementById('status-message').textContent.includes('Обложка передана'));
  const coverRequest = await worker.evaluate(async () => (await chrome.downloads.search({})).find(item => item.url === 'https://sun9.userapi.com/cover.jpg?crop=0,0,100,100&sign=test'));
  assert.ok(coverRequest, 'The cover action must target the thumbnail actually displayed.');
  // Browser-managed URL downloads bypass page Fetch interception. Check the requested URL
  // and cancel this fixture-only request instead of waiting on a real VK CDN endpoint.
  if (coverRequest.state === 'in_progress') await worker.evaluate(id => chrome.downloads.cancel(id).catch(() => {}), coverRequest.id);
  report.push('The separate cover action targets the image actually displayed after a failed larger thumbnail.');
  await popup.$eval('#search', element => { element.value = ''; element.dispatchEvent(new Event('input')); });
  await popup.click('.track-row');
  await popup.click('#tab-help');
  assert.equal(await popup.$eval('#help-panel', element => element.hidden), false);
  await popup.screenshot({ path: path.join(artifacts, 'popup-help.png'), fullPage: true });
  await popup.click('#tab-music');
  report.push('Four VK audio rows receive exactly one download button. Popup current track, search, selection and help navigation work.');

  // Reproduce the supplied current-player element outside all legacy audio rows.
  await fixture.evaluate(markup => {
    const row = document.querySelector('[data-full-id="42_1"]');
    window.beforePlayerCover = { row: row.dataset.audio, cached: window.testRecords[0], current: window.testCurrent };
    const track = { id: 1, owner_id: 42, title: 'POSTER', artist: 'OBLADAET', duration: 125, url: 'https://psv4.vkuseraudio.net/tone.mp3' };
    row.dataset.audio = JSON.stringify(track);
    window.testRecords[0] = track; window.testCurrent = track;
    document.body.insertAdjacentHTML('beforeend', markup);
  }, playerCoverMarkup);
  await fixture.bringToFront(); await popup.reload();
  await popup.waitForFunction(url => {
    const image = document.getElementById('artwork');
    return document.getElementById('track-title').textContent === 'POSTER' && image.src === url && image.complete && image.naturalWidth > 0 && !image.classList.contains('placeholder');
  }, {}, playerCoverUrl);
  assert.equal(await popup.$eval('#save-cover', element => element.disabled), false);
  assert.equal(await popup.$eval('.track-row:first-child > img', image => image.src), playerCoverUrl);
  await popup.bringToFront();
  await popup.screenshot({ path: path.join(artifacts, 'popup-provided-artwork.png'), fullPage: true });
  await popup.click('#download');
  const playerArtJob = await waitForJob();
  const playerArtFile = await savedFile(playerArtJob);
  assert.ok(playerArtFile.bytes.includes(playerCoverBytes));
  assert.match(path.basename(playerArtFile.item.filename), /^OBLADAET - POSTER(?: \(\d+\))?\.mp3$/);
  report.push('Regression: the supplied current-player img element on vkuserphoto.ru displays in the main card and list, enables cover saving, and embeds the same image in the generated MP3 under the actual extension CSP.');
  await fixture.evaluate(() => {
    document.querySelector('[data-testid="vk-player-artwork-fixture"]').remove();
    document.querySelector('[data-full-id="42_1"]').dataset.audio = window.beforePlayerCover.row;
    window.testRecords[0] = window.beforePlayerCover.cached; window.testCurrent = window.beforePlayerCover.current;
    delete window.beforePlayerCover;
  });
  await worker.evaluate(id => chrome.storage.session.remove(`job:${id}`), fixtureTab);
  await fixture.bringToFront(); await popup.reload();
  await popup.waitForFunction(() => !document.getElementById('download').disabled);
  await popup.bringToFront();

  const progressFixture = { id: 'progress-ui', tabId: fixtureTab, trackId: '42_1', track: { title: 'Тихий берег', artist: 'Север' } };
  async function progressState(progress, status, message, id = progressFixture.id) {
    await worker.evaluate(job => chrome.storage.session.set({ [`job:${job.tabId}`]: job }), { ...progressFixture, id, progress, status, message });
    await popup.waitForFunction(expected => {
      const track = document.getElementById('progress-track');
      const fill = document.getElementById('progress-bar');
      return !track.hidden && Number(track.getAttribute('aria-valuenow')) === expected && Math.abs(fill.getBoundingClientRect().width / track.clientWidth * 100 - expected) < .8;
    }, {}, progress);
  }
  await progressState(21, 'downloading', 'Загружаем аудио…');
  const progressAppearance = await popup.evaluate(() => {
    const track = document.getElementById('progress-track');
    const fill = document.getElementById('progress-bar');
    return { height: track.getBoundingClientRect().height, striped: getComputedStyle(fill).backgroundImage.includes('repeating-linear-gradient'), animation: getComputedStyle(fill, '::before').animationName, percent: document.getElementById('progress-percent').textContent };
  });
  assert.deepEqual(progressAppearance, { height: 18, striped: true, animation: 'vkProgressSheen', percent: '21%' });
  await popup.screenshot({ path: path.join(artifacts, 'popup-progress.png'), fullPage: true });
  await (await popup.waitForSelector('#feedback')).screenshot({ path: path.join(artifacts, 'progress-bar.png') });
  await progressState(74, 'converting', 'Конвертируем аудио в MP3…');
  await progressState(99, 'saving', 'Сохраняем MP3…');
  await progressState(100, 'complete', 'MP3 сохранён в загрузки.');
  assert.equal(await popup.$eval('#progress-bar', element => getComputedStyle(element, '::before').animationName), 'none');
  // A late running update cannot replace the completed state in an open popup.
  await worker.evaluate(job => chrome.storage.session.set({ [`job:${job.tabId}`]: job }), { ...progressFixture, progress: 65, status: 'downloading', message: 'Запоздалое обновление' });
  assert.equal(await popup.$eval('#progress-track', element => element.getAttribute('aria-valuenow')), '100');
  await progressState(37, 'error', 'Загрузка прервана.', 'progress-error');
  assert.equal(await popup.$eval('#progress-bar', element => getComputedStyle(element, '::before').animationName), 'none');
  assert.equal(await popup.$eval('#download', element => element.disabled), false);
  await progressState(0, 'preparing', 'Получаем аудиопоток VK…', 'progress-zero');
  await progressState(21, 'downloading', 'Загружаем аудио…', 'progress-reopen');
  await fixture.bringToFront(); await popup.reload();
  await popup.waitForFunction(() => document.getElementById('progress-track').getAttribute('aria-valuenow') === '21');
  await popup.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  assert.equal(await popup.$eval('#progress-bar', element => getComputedStyle(element, '::before').animationName), 'none');
  await popup.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'no-preference' }]);
  await worker.evaluate(id => chrome.storage.session.remove(`job:${id}`), fixtureTab);
  await fixture.bringToFront(); await popup.reload();
  await popup.waitForFunction(() => !document.getElementById('download').disabled);
  await popup.bringToFront();
  report.push('Wormix/VK 2013 progress styling matches the original 18px striped bar with a moving highlight; 0%, conversion, 99%, completion, errors, popup restoration and reduced motion behave correctly.');

  await worker.evaluate(() => {
    globalThis.testProgressUpdates = [];
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'session') return;
      for (const [key, value] of Object.entries(changes)) if (key.startsWith('job:') && value.newValue) globalThis.testProgressUpdates.push(value.newValue);
    });
  });

  await popup.click('#download');
  const first = await waitForJob();
  const saved = await savedFile(first);
  assert.match(path.basename(saved.item.filename), /^Север - Тихий берег(?: \(\d+\))?\.mp3$/);
  assert.equal(saved.bytes.subarray(0, 3).toString(), 'ID3');
  assert.ok(saved.bytes.includes(Buffer.from('APIC')) && saved.bytes.includes(cover));
  await popup.waitForFunction(() => document.getElementById('status-message').textContent.includes('MP3 сохранён'));
  assert.equal(await popup.$eval('#progress-track', element => element.hidden), false);
  assert.equal(await popup.$eval('#progress-percent', element => element.textContent), '100%');
  const realProgress = await worker.evaluate(id => globalThis.testProgressUpdates.filter(job => job.id === id), first.id);
  assert.ok(realProgress.some(job => job.status === 'downloading'));
  assert.ok(realProgress.some(job => job.status === 'saving' && job.progress === 99));
  assert.equal(realProgress.at(-1).progress, 100);
  assert.ok(realProgress.every((job, index) => index === 0 || job.progress >= realProgress[index - 1].progress));
  report.push('Actual Chrome MP3 downloads report increasing progress through downloading, saving at 99%, and confirmed completion at 100%.');
  await popup.screenshot({ path: path.join(artifacts, 'popup-success.png'), fullPage: true });
  await popup.click('#save-cover');
  await popup.waitForFunction(() => document.getElementById('status-message').textContent.includes('Обложка передана'));
  report.push('Popup downloads a real MP3 through chrome.downloads with Cyrillic filename, ID3 metadata, original cover, completion feedback and separate cover download.');
  await popup.close();
  await fixture.bringToFront();
  await fixture.click('[data-full-id="42_2"] .vkmd-download');
  const second = await waitForJob(first.id);
  const converted = await savedFile(second);
  const decodedDuration = await worker.evaluate(async bytes => {
    const context = new AudioContext(); const audio = await context.decodeAudioData(new Uint8Array(bytes).buffer); const result = audio.duration; await context.close(); return result;
  }, [...converted.bytes]);
  assert.ok(decodedDuration > .8 && decodedDuration < 1.5, String(decodedDuration));
  assert.ok(converted.bytes.includes(cover));
  assert.equal(await fixture.evaluate(() => window.audioClicks), 0);
  report.push('Row button converts AAC/fMP4 HLS to decodable MP3 with the popup closed and without triggering VK playback.');

  await fixture.click('[data-full-id="42_4"] .vkmd-download');
  const third = await waitForJob(second.id);
  const encryptedFile = await savedFile(third);
  const aesDuration = await worker.evaluate(async bytes => { const context = new AudioContext(); const audio = await context.decodeAudioData(new Uint8Array(bytes).buffer); await context.close(); return audio.duration; }, [...encryptedFile.bytes]);
  assert.ok(aesDuration > .8 && aesDuration < 1.5);
  report.push('Standard HLS AES-128 playback keys decrypt locally; the resulting downloaded MP3 decodes successfully.');

  await fixture.click('[data-full-id="42_3"] .vkmd-download');
  const unavailable = await waitForJob(third.id, 'error');
  assert.match(unavailable.message, /VK не предоставил/);
  await fixture.evaluate(() => {
    window.testRecords[2][2] = 'https://vk.com/mp3/audio_api_unavailable.mp3?extra=fixture';
    window.AudioUtils = { audioUnmaskSource: () => 'https://psv4.vkuseraudio.net/tone.mp3' };
  });
  await fixture.click('[data-full-id="42_3"] .vkmd-download');
  const unmasked = await waitForJob(unavailable.id);
  assert.equal(unmasked.status, 'complete');
  report.push('Unavailable audio fails clearly. VK-provided URL decoding resolves masked playback URLs on retry.');

  await fixture.evaluate(() => {
    window.testRecords[2][2] = '';
    delete window.AudioUtils;
    window.ajax = { post: (endpoint, data, callbacks) => { const result = [...window.testRecords[2]]; result[2] = 'https://psv4.vkuseraudio.net/tone.mp3'; callbacks.onDone([result]); } };
  });
  await fixture.click('[data-full-id="42_3"] .vkmd-download');
  const reloaded = await waitForJob(unmasked.id);
  assert.equal(reloaded.status, 'complete');
  report.push('VK same-origin playback reload resolves an uncached row with its page-provided hashes.');

  const locallyMasked = 'https://vk.com/mp3/audio_api_unavailable.mp3?extra=AhjWDhqUDdrRCgu6zw91C3z1lNnLlI8VDgqVDM5WBM9Tm3nHAq#AqSXmJmOnq';
  await fixture.evaluate(mask => {
    delete window.ajax; delete window.AudioUtils; delete window.audioUnmaskSource;
    window.vk = { id: 123 };
    window.testRecords[2][2] = mask;
  }, locallyMasked);
  const requestCount = playbackRequests.length;
  await fixture.click('[data-full-id="42_3"] .vkmd-download');
  const locallyDecoded = await waitForJob(reloaded.id);
  assert.equal(locallyDecoded.status, 'complete');
  assert.equal(playbackRequests.length, requestCount);
  assert.equal(await fixture.evaluate(() => window.audioClicks), 0);
  const decodedFile = await savedFile(locallyDecoded);
  assert.ok(decodedFile.bytes.includes(cover));
  report.push('Regression: a viewer-specific masked URL downloads without playing the track, without VK global decoders, and without unnecessary reload requests.');

  const refreshedObjectAudio = audio(3, 'Город засыпает', locallyMasked);
  fixtures.set('/al_audio.php', { type: 'application/json', body: `<!--${JSON.stringify({ payload: ['0', [[refreshedObjectAudio]]] })}` });
  await fixture.evaluate(() => {
    window.testRecords[2] = { id: 3, owner_id: 42, title: 'Город засыпает', artist: 'Север', duration: 1, actionHash: 'objectAction', urlHash: 'objectUrl' };
    document.querySelector('[data-full-id="42_3"]').dataset.audio = JSON.stringify(window.testRecords[2]);
  });
  await fixture.click('[data-full-id="42_3"] .vkmd-download');
  const objectReloaded = await waitForJob(locallyDecoded.id);
  assert.equal(objectReloaded.status, 'complete');
  assert.equal(new URLSearchParams(playbackRequests.at(-1)).get('ids'), '42_3_objectAction_objectUrl');
  assert.equal(await fixture.evaluate(() => window.audioClicks), 0);
  report.push('Regression: a modern object record downloads through a real same-origin POST and nested VK JSON response when window.ajax is absent.');

  await fixture.evaluate(() => { document.querySelectorAll('.audio_row').forEach(row => row.remove()); history.pushState({}, '', '/feed'); });
  assert.equal(await fixture.$$eval('.vkmd-download', elements => elements.length), 0);
  await fixture.evaluate(() => {
    const row = document.createElement('div'); row.className = 'audio_row'; row.dataset.fullId = '42_1'; row.dataset.audio = JSON.stringify(window.testRecords[0]); document.querySelector('.music').append(row);
  });
  await fixture.waitForFunction(() => document.querySelectorAll('.vkmd-download').length === 1);
  await fixture.evaluate(() => { const row = document.querySelector('.audio_row'); row.dataset.fullId = '42_2'; });
  await fixture.waitForFunction(() => document.querySelector('.vkmd-download').dataset.audioId === '42_2');
  report.push('SPA row insertion and reused DOM rows keep download identities current without duplicate buttons.');

  fixtures.set('/audios42', { type: 'text/html; charset=utf-8', body: fixtureHtml() });
  await fixture.goto('https://vk.ru/audios42');
  await fixture.waitForFunction(() => document.querySelectorAll('.vkmd-download').length === 4);
  fixtureTab = await worker.evaluate(async () => (await chrome.tabs.query({ url: 'https://vk.ru/audios42' }))[0].id);
  await fixture.click('[data-full-id="42_1"] .vkmd-download');
  await waitForJob();
  report.push('vk.ru has the same content injection, metadata access and actual download path as vk.com.');
  assert.deepEqual(errors, []);
  report.push('No uncaught page, service worker, offscreen or CSP errors. All audio is generated locally; no account or third-party recordings are used.');
  await writeFile(path.join(artifacts, 'browser-test-results.json'), JSON.stringify({ passed: true, chrome: await browser.version(), checks: report, errors, liveAuthenticatedVkVerified: false }, null, 2));
  console.log(report.map(value => `PASS ${value}`).join('\n'));
} catch (error) {
  console.error(error);
  if (worker) console.error('State:', await worker.evaluate(() => chrome.storage.session.get(null)).catch(() => ({})));
  console.error('Errors:', errors);
  await writeFile(path.join(artifacts, 'browser-test-results.json'), JSON.stringify({ passed: false, checks: report, errors, failure: error.stack }, null, 2));
  process.exitCode = 1;
} finally { await browser.close(); }
