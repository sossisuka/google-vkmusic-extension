import { allowedUrl } from './model.js';

function attributes(line) {
  return Object.fromEntries([...line.slice(line.indexOf(':') + 1).matchAll(/([A-Z0-9-]+)=("[^"]*"|[^,]*)/g)].map(([, key, value]) => [key, value.replace(/^"|"$/g, '')]));
}
export function sequenceIv(sequence) {
  let value = BigInt(sequence);
  const bytes = new Uint8Array(16);
  for (let index = 15; index >= 0; index--) { bytes[index] = Number(value & 255n); value >>= 8n; }
  return bytes;
}
function parseIv(value) {
  if (!/^0x[\da-f]{1,32}$/i.test(value)) throw new Error('Некорректный IV аудиопотока.');
  return Uint8Array.from(value.slice(2).padStart(32, '0').match(/../g), part => parseInt(part, 16));
}

export function parsePlaylist(text, base) {
  const lines = text.trim().split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  if (lines[0] !== '#EXTM3U') throw new Error('VK вернул некорректный HLS-плейлист.');
  const resolve = value => allowedUrl(new URL(value, base).href, 'ссылка внутри HLS-плейлиста').href;
  const variants = [];
  for (let index = 0; index < lines.length; index++) {
    if (lines[index].startsWith('#EXT-X-STREAM-INF:') && lines[index + 1] && !lines[index + 1].startsWith('#')) {
      const data = attributes(lines[index]);
      variants.push({ url: resolve(lines[index + 1]), bandwidth: Number(data.BANDWIDTH) || 0 });
    }
    if (lines[index].startsWith('#EXT-X-MEDIA:')) {
      const data = attributes(lines[index]);
      if (data.TYPE === 'AUDIO' && data.URI) variants.push({ url: resolve(data.URI), bandwidth: Number.MAX_SAFE_INTEGER });
    }
  }
  if (variants.length) return { variant: variants.sort((a, b) => b.bandwidth - a.bandwidth)[0].url };
  if (!lines.includes('#EXT-X-ENDLIST')) throw new Error('Прямые эфиры не поддерживаются. Откройте завершённый трек.');
  if (lines.some(line => line.startsWith('#EXT-X-BYTERANGE:'))) throw new Error('HLS byte range пока не поддерживается.');
  const segments = [];
  let key = null, sequence = 0n, initialization = null, duration = 0;
  for (const line of lines) {
    if (line.startsWith('#EXT-X-MEDIA-SEQUENCE:')) {
      const value = line.split(':')[1];
      if (!/^\d+$/.test(value)) throw new Error('Некорректная последовательность HLS.');
      sequence = BigInt(value);
    } else if (line.startsWith('#EXTINF:')) duration += Number.parseFloat(line.split(':')[1]) || 0;
    else if (line.startsWith('#EXT-X-KEY:')) {
      const data = attributes(line);
      if (data.METHOD === 'NONE') key = null;
      else {
        if (data.METHOD !== 'AES-128' || (data.KEYFORMAT && data.KEYFORMAT !== 'identity')) throw new Error('DRM и SAMPLE-AES аудиопотоки не поддерживаются.');
        if (!data.URI) throw new Error('У аудиопотока нет адреса ключа.');
        key = { url: resolve(data.URI), iv: data.IV ? parseIv(data.IV) : null };
      }
    } else if (line.startsWith('#EXT-X-MAP:')) {
      const data = attributes(line);
      if (data.BYTERANGE) throw new Error('HLS byte range пока не поддерживается.');
      if (!data.URI) throw new Error('Отсутствует заголовок HLS.');
      const url = resolve(data.URI);
      if (initialization && initialization !== url) throw new Error('Поток с меняющимся форматом не поддерживается.');
      if (key && !key.iv) throw new Error('Для заголовка AES-128 требуется явный IV.');
      if (!initialization) segments.push({ url, key: key ? { ...key } : null });
      initialization = url;
    } else if (!line.startsWith('#')) {
      segments.push({ url: resolve(line), key: key ? { ...key, iv: key.iv || sequenceIv(sequence) } : null });
      sequence++;
    }
  }
  if (!segments.length || segments.length > 10000) throw new Error('Пустой или слишком большой аудиопоток.');
  return { segments, duration };
}

export async function decryptSegment(bytes, keyBytes, iv) {
  if (keyBytes.length !== 16) throw new Error('VK вернул некорректный ключ AES-128.');
  const key = await crypto.subtle.importKey('raw', keyBytes, 'AES-CBC', false, ['decrypt']);
  try { return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-CBC', iv }, key, bytes)); }
  catch { throw new Error('Не удалось прочитать фрагмент AES-128. Обновите страницу и повторите.'); }
}
