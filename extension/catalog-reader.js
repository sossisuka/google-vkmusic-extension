// Runs only in an authenticated VK tab. Cookies never leave VK.
export async function readVkCatalog(request) {
  const viewerId = [window.vk?.id, window.vk?.user_id, window.cur?.viewer_id, window.cur?.user_id].find(value => /^\d+$/.test(String(value || '')));
  if (!viewerId) throw new Error('Войдите в VK во вкладке с музыкой и повторите подключение.');
  let params;
  if (request.kind === 'playlist') {
    if (!/^-?\d+$/.test(request.ownerId) || !/^\d+$/.test(request.playlistId)) throw new Error('Некорректная ссылка на плейлист.');
    params = { act: 'load_section', al: '1', type: 'playlist', owner_id: request.ownerId, playlist_id: request.playlistId, access_hash: request.accessHash || '', offset: String(request.offset || 0), is_loading_all: '1' };
  } else if (request.cursor) {
    params = { act: 'load_catalog_section', al: '1', section_id: request.cursor.sectionId, start_from: request.cursor.nextFrom };
  } else {
    params = { act: 'section', al: '1', claim: '0', is_layer: '0', owner_id: String(viewerId), section: 'search', q: String(request.query || '').slice(0, 200) };
  }
  const response = await fetch('/al_audio.php', { method: 'POST', credentials: 'same-origin', redirect: 'error', signal: AbortSignal.timeout(20000), headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Requested-With': 'XMLHttpRequest' }, body: new URLSearchParams(params).toString() });
  if (!response.ok) throw new Error(response.status === 429 ? 'VK ограничил частоту запросов. Повторите чуть позже.' : `VK вернул ошибку ${response.status}.`);
  const text = await response.text();
  if (text.length > 8 * 1024 * 1024) throw new Error('Слишком большой ответ VK.');
  const payloads = [];
  const cleaned = text.replace(/^\s*<!--/, '').replace(/-->\s*$/, '').trim();
  try { payloads.push(JSON.parse(cleaned)); } catch { for (const part of cleaned.split('<!>')) { try { payloads.push(JSON.parse(part)); } catch { /* Never evaluate scripts. */ } } }
  if (!payloads.length) throw new Error('VK изменил ответ поиска. Обновите вкладку с музыкой.');
  const records = new Map();
  let cursor = null, hasMore = false, title = '';
  function walk(value, depth = 0) {
    if (!value || depth > 12 || records.size >= 1000) return;
    if (typeof value === 'string') {
      if (value.includes('data-audio=')) {
        const dom = new DOMParser().parseFromString(value, 'text/html');
        for (const row of dom.querySelectorAll('[data-audio]')) { try { walk(JSON.parse(row.getAttribute('data-audio')), depth + 1); } catch { /* Invalid row. */ } }
      } else if (/^[\[{]/.test(value)) { try { walk(JSON.parse(value), depth + 1); } catch { /* Plain text. */ } }
      return;
    }
    const rawId = Array.isArray(value) && /^-?\d+$/.test(String(value[1])) && /^\d+$/.test(String(value[0])) && typeof value[3] === 'string' && typeof value[4] === 'string' ? `${value[1]}_${value[0]}` : !Array.isArray(value) && value.title && value.owner_id !== undefined && /^\d+$/.test(String(value.id)) ? `${value.owner_id}_${value.id}` : null;
    if (rawId) { records.set(rawId, value); return; }
    if (typeof value !== 'object') return;
    if (value.payload && String(value.payload[0]) === '3') throw new Error('Войдите в VK и обновите страницу музыки.');
    if (value.sectionId && value.nextFrom) cursor = { sectionId: String(value.sectionId), nextFrom: String(value.nextFrom) };
    if (value.hasMore || value.has_more) hasMore = true;
    if (request.kind === 'playlist' && (value.title || value.name) && (value.list || value.audios)) title = String(value.title || value.name).slice(0, 200);
    for (const child of Object.values(value).slice(0, 3000)) walk(child, depth + 1);
  }
  for (const payload of payloads) walk(payload);
  return { records: [...records.values()], cursor, hasMore, title, viewerId };
}
