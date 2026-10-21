export const SITE_HOSTS = ['vk.com', 'www.vk.com', 'm.vk.com', 'vk.ru', 'www.vk.ru', 'm.vk.ru'];
export const RESOURCE_HOSTS = ['vk.com', 'vk.ru', 'vkuseraudio.net', 'vkuseraudio.com', 'vkuseraudio.ru', 'userapi.com', 'vkuserphoto.ru', 'vk-cdn.net'];

export function isVkPage(value) {
  try { const url = new URL(value); return url.protocol === 'https:' && SITE_HOSTS.includes(url.hostname) && !url.username && !url.password && !url.port; }
  catch { return false; }
}

export function audioId(value) { return /^-?\d+_\d+$/.test(String(value || '')) ? String(value) : null; }

export function allowedUrl(value, resource = 'ресурс') {
  let url;
  try { url = new URL(value); } catch { throw new Error(`Некорректный адрес: ${resource}.`); }
  if (url.protocol !== 'https:' || url.username || url.password || url.port || !RESOURCE_HOSTS.some(host => url.hostname === host || url.hostname.endsWith(`.${host}`))) {
    throw new Error(`Недопустимый адрес VK: ${resource}.`);
  }
  if (url.pathname.includes('audio_api_unavailable')) throw new Error('Ссылка аудиоплеера VK ещё не разрешена. Обновите страницу и повторите.');
  return url;
}

export function fileName(artist, title, extension = 'mp3') {
  const clean = value => String(value || '').normalize('NFC').replace(/[<>:"/\\|?*\u0000-\u001f\u007f]/g, '_').replace(/[. ]+$/g, '').trim();
  let base = [clean(artist), clean(title)].filter(Boolean).join(' - ').slice(0, 170).replace(/[. ]+$/g, '') || 'VK audio';
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(base)) base = `_${base}`;
  if (!/^(?:mp3|jpg|jpeg|png|webp)$/i.test(extension)) throw new Error('Неподдерживаемый формат файла.');
  return `${base}.${extension.toLowerCase()}`;
}

export function normalizeTrack(raw) {
  const id = audioId(raw?.id);
  if (!id || !raw.title) throw new Error('Не удалось прочитать аудиозапись VK. Обновите страницу.');
  const artworkCandidates = [];
  for (const candidate of [raw.artwork, ...(Array.isArray(raw.artworkCandidates) ? raw.artworkCandidates.slice(0, 24) : [])]) {
    if (typeof candidate !== 'string' || !candidate) continue;
    try {
      const address = candidate.startsWith('//') ? `https:${candidate}` : candidate;
      const url = allowedUrl(address, 'обложка').href;
      if (!artworkCandidates.includes(url)) artworkCandidates.push(url);
    } catch { /* Ignore invalid covers and keep the remaining actual track images. */ }
  }
  const artwork = artworkCandidates[0] || null;
  return {
    id, url: `https://vk.com/audio${id}`, title: String(raw.title).slice(0, 500),
    artist: String(raw.artist || 'Неизвестный исполнитель').slice(0, 500),
    duration: Math.max(0, Number(raw.duration) || 0) * 1000, artwork, artworkCandidates,
    source: raw.source || null, restricted: Boolean(raw.restricted)
  };
}

export function selectStream(track) {
  if (track.restricted) throw new Error('Полная запись недоступна для воспроизведения. Ограниченные записи и превью не поддерживаются.');
  if (!track.source) throw new Error('VK не предоставил ссылку на эту запись. Обновите страницу музыки и повторите.');
  const url = allowedUrl(track.source, 'аудиопоток');
  const hls = /\.m3u8(?:$|[?#])/i.test(url.href);
  const mp3 = /\.mp3(?:$|[?#])/i.test(url.href);
  return { url: url.href, format: { protocol: hls ? 'hls' : 'progressive', mime_type: mp3 ? 'audio/mpeg' : 'audio/mp4' } };
}

export const isMp3Mime = value => /^audio\/(?:mpeg|mp3)(?:\s*;|$)/i.test(value || '');
export function durationLabel(milliseconds) {
  if (!milliseconds) return '—:—';
  const seconds = Math.floor(milliseconds / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}
