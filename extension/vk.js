import { isVkPage, audioId, normalizeTrack, selectStream } from './shared/model.js';
import { readVkPage } from './page-reader.js';
import { decodeAudioUrl } from './shared/audio-url.js';

export async function readTracks(tabId, requestedId = null, needMedia = false) {
  if (requestedId !== null && !audioId(requestedId)) throw new Error('Некорректный идентификатор аудиозаписи.');
  const [result] = await chrome.scripting.executeScript({ target: { tabId }, world: 'MAIN', func: readVkPage, args: [requestedId, needMedia] });
  const page = result?.result;
  if (!isVkPage(page?.href)) throw new Error('Откройте музыку на vk.com или vk.ru.');
  let decodeError = null;
  const tracks = (page.tracks || []).map(raw => {
    let source = null;
    try { source = decodeAudioUrl(raw.source, page.viewerId); }
    catch (error) { if (raw.id === requestedId) decodeError = error.message; }
    return normalizeTrack({ ...raw, source });
  });
  return { tracks, currentId: page.currentId, selectedId: page.selectedId, mediaError: decodeError || page.mediaError || null };
}

export async function resolveTrack(tabId, id, needMedia = false) {
  let page = await readTracks(tabId, id);
  let track = page.tracks.find(item => item.id === id);
  if (!track) throw new Error('Аудиозапись больше не найдена на странице. Обновите список.');
  if (needMedia && !track.restricted && !track.source) {
    page = await readTracks(tabId, id, true);
    track = page.tracks.find(item => item.id === id);
    if (!track) throw new Error('Аудиозапись больше не найдена на странице. Обновите список.');
    if (!track.source && page.mediaError) throw new Error(page.mediaError);
  }
  return { track, ...(needMedia ? { stream: selectStream(track) } : {}) };
}
