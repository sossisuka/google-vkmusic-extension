import { FFmpeg } from './vendor/ffmpeg/index.js';
import { allowedUrl, isMp3Mime } from './shared/model.js';
import { parsePlaylist, decryptSegment } from './shared/hls.js';
import { addMetadata } from './shared/id3.js';
import { readResponseBytes as bytesFrom } from './shared/transfer.js';

const MAX_BYTES = 200 * 1024 * 1024;
let processing = false;
const blobs = new Set();
async function fetchChecked(value, resource) {
  const response = await fetch(allowedUrl(value, resource).href, { credentials: 'omit', signal: AbortSignal.timeout(30000) });
  allowedUrl(response.url, `перенаправление: ${resource}`);
  if (!response.ok) throw new Error(`Не удалось получить аудио или обложку (HTTP ${response.status}). Обновите страницу и повторите.`);
  return response;
}
async function audioBytes(stream, progress, expectedDuration) {
  const megabytes = bytes => `${(bytes / (1024 * 1024)).toLocaleString('ru-RU', { maximumFractionDigits: 1 })} МБ`;
  if (stream.format.protocol === 'progressive') {
    return bytesFrom(await fetchChecked(stream.url, 'MP3-аудиофайл'), MAX_BYTES, (loaded, total) => progress(5 + (total ? Math.round(Math.min(1, loaded / total) * 60) : 0), `Загружаем аудио… ${megabytes(loaded)}${total ? ` из ${megabytes(total)}` : ''}`));
  }
  let url = stream.url;
  let playlist;
  for (let depth = 0; depth < 5; depth++) {
    const response = await fetchChecked(url, 'HLS-плейлист');
    playlist = parsePlaylist(new TextDecoder().decode(await bytesFrom(response, 2 * 1024 * 1024)), response.url);
    if (!playlist.variant) break;
    url = playlist.variant;
  }
  if (!playlist?.segments) throw new Error('Не удалось прочитать вложенный HLS-плейлист.');
  if (expectedDuration > 60000 && playlist.duration && playlist.duration * 1000 < expectedDuration * .85) throw new Error('VK вернул только фрагмент записи. Полный трек недоступен.');
  const parts = [];
  const keys = new Map();
  let total = 0;
  // Sequential requests keep memory bounded and avoid flooding the audio CDN.
  for (let index = 0; index < playlist.segments.length; index++) {
    const segment = playlist.segments[index];
    let bytes = await bytesFrom(await fetchChecked(segment.url, 'фрагмент HLS-аудиопотока'), MAX_BYTES - total, (loaded, length) => progress(5 + Math.round((index + (length ? Math.min(1, loaded / length) : 0)) / playlist.segments.length * 60), 'Загружаем аудио…'));
    if (segment.key) {
      if (!keys.has(segment.key.url)) keys.set(segment.key.url, await bytesFrom(await fetchChecked(segment.key.url, 'ключ HLS'), 16));
      bytes = await decryptSegment(bytes, keys.get(segment.key.url), segment.key.iv);
    }
    total += bytes.length;
    parts.push(bytes);
    await progress(5 + Math.round((index + 1) / playlist.segments.length * 60), 'Загружаем аудио…');
  }
  const result = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) { result.set(part, offset); offset += part.length; }
  return result;
}
async function readCover(url) {
  if (!url) return null;
  const response = await fetchChecked(url, 'файл обложки');
  const bytes = await bytesFrom(response, 12 * 1024 * 1024);
  let mime = bytes[0] === 255 && bytes[1] === 216 ? 'image/jpeg' : bytes[0] === 137 && bytes[1] === 80 ? 'image/png' : null;
  if (mime) return { bytes, mime };
  // Normalize WebP/AVIF covers into JPEG for MP3-player compatibility.
  const bitmap = await createImageBitmap(new Blob([bytes], { type: response.headers.get('content-type') || 'image/webp' }));
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const context = canvas.getContext('2d');
  context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height); context.drawImage(bitmap, 0, 0); bitmap.close();
  return { bytes: new Uint8Array(await (await canvas.convertToBlob({ type: 'image/jpeg', quality: .95 })).arrayBuffer()), mime: 'image/jpeg' };
}
async function coverBytes(track) {
  const urls = track.artworkCandidates?.length ? track.artworkCandidates : track.artwork ? [track.artwork] : [];
  if (!urls.length) return null;
  let lastError;
  for (const url of urls) {
    try { return await readCover(url); } catch (error) { lastError = error; }
  }
  throw lastError;
}
async function processJob(job, stream) {
  let ffmpeg;
  let latest = { progress: 3, status: 'downloading', message: 'Загружаем аудио…' };
  let lastSent = 0;
  const report = async (progress, message, status = 'downloading', force = false) => {
    latest = { progress: Math.max(latest.progress, progress), message, status };
    if (!force && Date.now() - lastSent < 300) return;
    lastSent = Date.now();
    await chrome.runtime.sendMessage({ target: 'background', type: 'PROGRESS', jobId: job.id, ...latest });
  };
  const heartbeat = setInterval(() => { chrome.runtime.sendMessage({ target: 'background', type: 'PROGRESS', jobId: job.id, ...latest }).catch(() => {}); }, 20000);
  try {
    await report(3, 'Загружаем аудио…', 'downloading', true);
    const audio = await audioBytes(stream, report, job.track.duration);
    await report(67, 'Загружаем обложку…', 'processing', true);
    let cover = null, warning = '';
    try { cover = await coverBytes(job.track); }
    catch { warning = 'Обложка недоступна; MP3 сохранён без неё.'; }
    let mp3 = audio;
    if (stream.format.protocol === 'progressive' && isMp3Mime(stream.format.mime_type) && !((audio[0] === 73 && audio[1] === 68 && audio[2] === 51) || (audio[0] === 255 && (audio[1] & 224) === 224))) throw new Error('VK вернул файл, который не является MP3. Обновите страницу и повторите.');
    // MPEG streams are already MP3. AAC/HLS is genuinely transcoded, never renamed.
    if (stream.format.protocol === 'hls' || !isMp3Mime(stream.format.mime_type)) {
      await report(70, 'Конвертируем аудио в MP3…', 'converting', true);
      ffmpeg = new FFmpeg();
      ffmpeg.on('progress', ({ progress }) => { report(Math.min(94, 72 + Math.round(Math.max(0, progress) * 22)), 'Конвертируем аудио в MP3…', 'converting').catch(() => {}); });
      await ffmpeg.load({ classWorkerURL: chrome.runtime.getURL('vendor/ffmpeg/worker.js'), coreURL: chrome.runtime.getURL('vendor/core/ffmpeg-core.js'), wasmURL: chrome.runtime.getURL('vendor/core/ffmpeg-core.wasm') });
      await ffmpeg.writeFile('input.audio', audio);
      const codec = isMp3Mime(stream.format.mime_type) ? ['-codec:a', 'copy'] : ['-codec:a', 'libmp3lame', '-q:a', '2'];
      const exit = await ffmpeg.exec(['-i', 'input.audio', '-map', '0:a:0', '-vn', ...codec, '-map_metadata', '-1', 'output.mp3'], 10 * 60 * 1000);
      if (exit !== 0) throw new Error('Не удалось конвертировать этот аудиопоток в MP3.');
      mp3 = await ffmpeg.readFile('output.mp3');
    }
    await report(96, 'Добавляем обложку и информацию о треке…', 'processing', true);
    const blob = addMetadata(mp3, job.track, cover);
    const blobUrl = URL.createObjectURL(blob);
    blobs.add(blobUrl);
    const result = await chrome.runtime.sendMessage({ target: 'background', type: 'READY', jobId: job.id, blobUrl, warning });
    if (!result?.ok) { URL.revokeObjectURL(blobUrl); blobs.delete(blobUrl); throw new Error(result?.error || 'Не удалось сохранить MP3.'); }
  } catch (error) {
    await chrome.runtime.sendMessage({ target: 'background', type: 'FAILED', jobId: job.id, error: error.message || 'Не удалось обработать трек.' });
  } finally {
    clearInterval(heartbeat);
    ffmpeg?.terminate();
    processing = false;
  }
}
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (message.target !== 'offscreen' || sender.id !== chrome.runtime.id || sender.tab || sender.url !== chrome.runtime.getURL('background.js')) return;
  if (message.type === 'PROCESS') {
    if (processing) { respond({ ok: false, error: 'Конвертер уже обрабатывает другой трек.' }); return; }
    processing = true; respond({ ok: true });
    processJob(message.job, message.stream).catch(console.error);
  }
  if (message.type === 'RELEASE' && blobs.has(message.blobUrl)) { URL.revokeObjectURL(message.blobUrl); blobs.delete(message.blobUrl); respond({ ok: true }); }
});
