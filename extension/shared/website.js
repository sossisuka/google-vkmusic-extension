export function isSaverPage(value) {
  try { const url = new URL(value); return !url.username && !url.password && url.pathname.startsWith('/vksaver/') && ((url.origin === 'https://inetcdn.online') || (url.protocol === 'http:' && url.hostname === '127.0.0.1')); }
  catch { return false; }
}

export function playlistAddress(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error('Вставьте ссылку VK на плейлист.'); }
  if (url.protocol !== 'https:' || !['vk.com', 'vk.ru', 'www.vk.com', 'www.vk.ru', 'm.vk.com', 'm.vk.ru'].includes(url.hostname) || url.username || url.password || url.port) throw new Error('Поддерживаются только ссылки vk.com и vk.ru.');
  const path = `${url.pathname} ${url.searchParams.get('z') || ''}`;
  const match = path.match(/(?:music\/album\/?|audio_playlist)(-?\d+)_(\d+)(?:_([a-zA-Z0-9-]+))?/);
  if (!match) throw new Error('Откройте плейлист VK и скопируйте его ссылку.');
  return { kind: 'playlist', ownerId: match[1], playlistId: match[2], accessHash: match[3] || url.searchParams.get('access_hash') || '' };
}
