// VK playback URL format, cross-checked against python273/vk_api (Apache-2.0).
// https://github.com/python273/vk_api/blob/master/vk_api/audio_url_decoder.py
// This module decodes URL obfuscation; it does not alter media access or DRM.
const alphabet = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMN0PQRSTUVWXYZO123456789+/=';
const standard = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=';

function unpack(value) {
  const encoded = decodeURIComponent(value);
  if (!/^[a-zA-Z0-9+/]*={0,2}$/.test(encoded) || encoded.length % 4 === 1) throw new Error('Некорректная ссылка аудиоплеера VK. Обновите страницу.');
  return atob([...encoded].map(character => standard[alphabet.indexOf(character)]).join(''));
}

function shuffle(value, seed) {
  const size = value.length;
  if (!size) return value;
  const positions = new Array(size);
  let state = Math.abs(Number(seed));
  if (!Number.isFinite(state)) throw new Error('Некорректный параметр ссылки аудиоплеера VK.');
  for (let position = size - 1; position >= 0; position--) {
    state = ((size * (position + 1)) ^ (state + position)) % size;
    positions[position] = state;
  }
  const characters = value.split('');
  for (let position = 1; position < size; position++) {
    const index = positions[size - position - 1];
    const target = index < 0 ? Math.max(size + index, 0) : index;
    [characters[position], characters[target]] = [characters[target], characters[position]];
  }
  return characters.join('');
}

export function decodeAudioUrl(value, viewerId = null) {
  if (typeof value !== 'string' || !value) return null;
  if (!value.includes('audio_api_unavailable')) return value;
  if (value.length > 65536) throw new Error('Ссылка аудиоплеера VK слишком длинная.');
  const extra = value.match(/[?&]extra=([^&#]*)/)?.[1];
  const fragment = value.includes('#') ? value.slice(value.indexOf('#') + 1) : '';
  if (!extra) throw new Error('VK вернул незавершённую ссылку. Обновите страницу и повторите.');
  let result;
  let operations;
  try { result = unpack(extra); operations = fragment ? unpack(fragment).split('\t').reverse() : []; }
  catch { throw new Error('Не удалось прочитать ссылку аудиоплеера VK. Обновите страницу и повторите.'); }
  if (operations.length > 32) throw new Error('Неподдерживаемая ссылка аудиоплеера VK.');
  for (const operation of operations) {
    const [name, argument] = operation.split('\v');
    switch (name) {
      case 'v': result = result.split('').reverse().join(''); break;
      case 'r': {
        const shift = Number(argument);
        if (!Number.isInteger(shift)) throw new Error('Некорректный параметр ссылки аудиоплеера VK.');
        result = [...result].map(character => {
          const index = alphabet.indexOf(character);
          return index < 0 ? character : alphabet[((index - shift) % alphabet.length + alphabet.length) % alphabet.length];
        }).join('');
        break;
      }
      case 'x': {
        if (!argument) throw new Error('Некорректный параметр ссылки аудиоплеера VK.');
        const key = argument.charCodeAt(0);
        result = result.split('').map(character => String.fromCharCode(character.charCodeAt(0) ^ key)).join('');
        break;
      }
      case 's': result = shuffle(result, argument); break;
      case 'i':
        if (!/^\d+$/.test(String(viewerId || ''))) throw new Error('Не удалось определить текущий аккаунт VK для ссылки трека. Обновите вкладку VK и войдите в аккаунт.');
        if (!Number.isInteger(Number(argument))) throw new Error('Некорректный параметр ссылки аудиоплеера VK.');
        result = shuffle(result, Number(argument) ^ Number(viewerId));
        break;
      default: throw new Error('VK изменил формат ссылки аудиоплеера. Этот формат пока не поддерживается.');
    }
  }
  if (!/^https:\/\//i.test(result) || result.includes('audio_api_unavailable')) throw new Error('Не удалось получить полную ссылку аудиоплеера VK. Обновите страницу и повторите.');
  return result;
}
