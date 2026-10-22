// Serialized by chrome.scripting into the site's MAIN world. Keep this function self-contained.
export async function readVkPage(requestedId = null, needMedia = false, catalog = {}) {
  const validId = value => /^-?\d+_\d+$/.test(String(value || '')) ? String(value) : null;
  const decodeText = value => { const element = document.createElement('textarea'); element.innerHTML = String(value || ''); return element.value; };
  const rawId = raw => Array.isArray(raw) ? validId(`${raw[1]}_${raw[0]}`) : validId(raw?.fullId || raw?.full_id || raw?.id) || validId(`${raw?.owner_id}_${raw?.id}`);
  const sourceOf = raw => Array.isArray(raw) ? raw[2] : raw?.url || raw?.src || raw?.source;
  let player;
  try { player = typeof window.getAudioPlayer === 'function' ? window.getAudioPlayer() : null; } catch { /* The page may still be initializing. */ }
  let current;
  try { current = player?.getCurrentAudio?.() || player?._currentAudio || null; } catch { current = player?._currentAudio; }
  const currentId = rawId(current);
  const viewerId = [window.vk?.id, window.vk?.user_id, window.cur?.viewer_id, window.cur?.user_id].find(value => /^\d+$/.test(String(value || ''))) || null;
  const records = new Map();
  const rows = catalog.only ? [] : [...document.querySelectorAll('[data-audio], .audio_row[data-full-id]')];
  const rowRaw = row => { try { return JSON.parse(row.getAttribute('data-audio') || 'null'); } catch { return null; } };
  function collectArtwork(value, output, depth = 0) {
    if (!value || depth > 5 || output.length >= 24) return;
    if (typeof value === 'string') {
      const text = value.trim();
      if (/^[\[{]/.test(text)) { try { collectArtwork(JSON.parse(text), output, depth + 1); } catch { /* Not an artwork object. */ } return; }
      // The legacy field separates URLs with commas; crop coordinates also contain commas.
      for (const part of text.split(/,\s*(?=(?:https?:)?\/\/)/i).reverse()) {
        if (!/^(?:https?:\/\/|\/)/i.test(part)) continue;
        try {
          const url = new URL(part.replace(/&amp;/gi, '&'), location.href);
          if (/\/images\/audio\/default/i.test(url.pathname)) continue;
          if (!output.includes(url.href)) output.push(url.href);
        } catch { /* Ignore an incomplete lazy-image address. */ }
      }
    } else if (Array.isArray(value)) {
      for (const image of [...value].sort((a, b) => (Number(b?.width) * Number(b?.height) || 0) - (Number(a?.width) * Number(a?.height) || 0))) collectArtwork(image, output, depth + 1);
    } else if (typeof value === 'object') {
      for (const name of Object.keys(value).filter(name => /^photo_\d+$/.test(name)).sort((a, b) => Number(b.slice(6)) - Number(a.slice(6)))) collectArtwork(value[name], output, depth + 1);
      for (const name of ['url', 'src', 'sizes', 'images']) collectArtwork(value[name], output, depth + 1);
    }
  }
  function recordArtwork(raw) {
    const urls = [];
    for (const value of Array.isArray(raw) ? [raw[14]] : [raw?.album?.thumb, raw?.thumb, raw?.artwork, raw?.cover, raw?.cover_url, raw?.album?.cover]) collectArtwork(value, urls);
    return urls;
  }
  function rowArtwork(row) {
    const urls = [];
    const selector = '.audio_row__cover, .audio_row__cover img, .audio_row__cover_back, .audio_row__cover_back img, .audio_item__cover, .audio_item__cover img, [data-testid="audio-cover"], [data-testid="audio-cover"] img, img[alt="Обложка аудиозаписи"]';
    for (const element of row?.querySelectorAll(selector) || []) {
      for (const value of [element.currentSrc, element.getAttribute('data-src'), element.getAttribute('data-original'), element.getAttribute('src')]) collectArtwork(value, urls);
      let background = element.style?.backgroundImage || '';
      if (!background || background === 'none') { try { background = getComputedStyle(element).backgroundImage; } catch { /* Detached cover element. */ } }
      for (const match of (background || '').matchAll(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*))\s*\)/g)) collectArtwork(match[1] || match[2] || match[3], urls);
    }
    return urls;
  }
  function currentPlayerArtwork() {
    const urls = [];
    if (!currentId) return urls;
    // The modern player uses generated classes. Its accessible image label is stable.
    for (const image of document.querySelectorAll('img[alt="Обложка аудиозаписи"]')) {
      const owner = image.closest?.('[data-audio], [data-full-id]');
      const ownerId = owner ? rawId(rowRaw(owner)) || validId(owner.getAttribute('data-full-id')) : null;
      if (ownerId && ownerId !== currentId) continue;
      if (image.hidden || image.getClientRects?.().length === 0) continue;
      try { const style = getComputedStyle(image); if (style.display === 'none' || style.visibility === 'hidden') continue; } catch { /* Fall back to the image's attributes. */ }
      for (const value of [image.currentSrc, image.getAttribute('src'), image.getAttribute('data-src')]) collectArtwork(value, urls);
    }
    return urls;
  }
  function remember(raw, row) {
    const id = rawId(raw) || validId(row?.getAttribute('data-full-id'));
    if (id) {
      const previous = records.get(id);
      records.set(id, { raw, row: row || previous?.row, artworkCandidates: [...new Set([...recordArtwork(raw), ...(previous?.artworkCandidates || [])])].slice(0, 24) });
    }
  }
  for (const raw of (catalog.records || []).slice(0, 1000)) remember(raw);
  for (const row of rows.slice(0, 100)) remember(rowRaw(row), row);
  if (currentId && !catalog.only) remember(current, rows.find(row => (rawId(rowRaw(row)) || validId(row.getAttribute('data-full-id'))) === currentId));
  const targetId = validId(requestedId) || currentId || records.keys().next().value;
  if (targetId && !records.has(targetId)) {
    const row = rows.find(item => (rawId(rowRaw(item)) || validId(item.getAttribute('data-full-id'))) === targetId);
    if (row) remember(rowRaw(row), row);
  }
  if (targetId) {
    try {
      const raw = player?.getAudioById?.(targetId);
      if (raw && typeof raw === 'object' && rawId(raw) === targetId && (sourceOf(raw) || !sourceOf(records.get(targetId)?.raw))) remember(raw);
    } catch { /* Row metadata is sufficient when the player has no cached record. */ }
  }
  function unmask(value) {
    if (typeof value !== 'string') return null;
    if (value.includes('audio_api_unavailable')) {
      for (const [owner, fn] of [[window.AudioUtils, window.AudioUtils?.audioUnmaskSource], [window, window.audioUnmaskSource]]) {
        try { if (typeof fn === 'function') { const result = fn.call(owner, value); if (typeof result === 'string' && /^https:\/\//.test(result) && !result.includes('audio_api_unavailable')) return result; } } catch { /* The extension's local decoder handles non-global site modules. */ }
      }
    }
    // Preserve the mask for the extension's decoder instead of silently dropping the link.
    return /^https:\/\//.test(value) ? value : null;
  }
  function findRecord(value, depth = 0) {
    if (!value || depth > 8) return null;
    if (rawId(value) === targetId) return value;
    if (typeof value === 'string') {
      try { return findRecord(JSON.parse(value), depth + 1); } catch { return null; }
    }
    const children = Array.isArray(value) ? value.slice(0, 200) : typeof value === 'object' ? ['payload', 'data', 'audios', 'items', 'list', 'response'].filter(key => value[key] !== undefined).map(key => value[key]) : [];
    for (const child of children) { const record = findRecord(child, depth + 1); if (record) return record; }
    return null;
  }
  function parseResponse(text) {
    const cleaned = text.replace(/^\s*<!--/, '').replace(/-->\s*$/, '').trim();
    try { return JSON.parse(cleaned); } catch { /* Older VK responses use <!> separators. */ }
    for (const part of cleaned.split('<!>')) { try { const parsed = JSON.parse(part); if (findRecord(parsed)) return parsed; } catch { /* Never evaluate script fragments from a response. */ } }
    return null;
  }
  let mediaError = null;
  const target = records.get(targetId);
  // Refresh only a requested record already present on the page; never start playback.
  if (needMedia && target) {
    const raw = target.raw;
    const hashes = Array.isArray(raw) && typeof raw[13] === 'string' ? raw[13].split('/') : [];
    const actionHash = Array.isArray(raw) ? hashes[2] : raw?.actionHash || raw?.action_hash;
    const urlHash = Array.isArray(raw) ? hashes[5] : raw?.urlHash || raw?.url_hash;
    const ids = actionHash && urlHash ? `${targetId}_${actionHash}_${urlHash}` : targetId;
    let refreshed = null;
    if (typeof window.ajax?.post === 'function') {
      const result = await new Promise(resolve => {
        const timeout = setTimeout(() => resolve(null), 5000);
        try {
          window.ajax.post('al_audio.php', { act: 'reload_audio', ids, al: 1 }, {
            onDone: (...payload) => { clearTimeout(timeout); resolve(payload); },
            onFail: () => { clearTimeout(timeout); resolve(null); return true; }
          });
        } catch { clearTimeout(timeout); resolve(null); }
      });
      refreshed = findRecord(result);
    }
    if (!sourceOf(refreshed)) {
      try {
        const endpoint = new URL(location.hostname.startsWith('m.') ? '/audio' : '/al_audio.php', location.origin);
        const response = await fetch(endpoint.href, {
          method: 'POST', credentials: 'same-origin', redirect: 'error', signal: AbortSignal.timeout(12000),
          headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Requested-With': 'XMLHttpRequest' },
          body: new URLSearchParams({ act: 'reload_audio', al: '1', ids }).toString()
        });
        if (!response.ok) throw new Error(response.status === 429 ? 'VK ограничил частоту запросов. Подождите немного и повторите.' : `Не удалось получить ссылку аудиоплеера VK (HTTP ${response.status}). Обновите страницу.`);
        const text = await response.text();
        if (text.length > 4 * 1024 * 1024) throw new Error('VK вернул слишком большой ответ аудиоплеера.');
        const payload = parseResponse(text);
        if (payload?.payload && String(payload.payload[0]) === '3') throw new Error('Войдите в свой аккаунт VK, обновите страницу музыки и повторите.');
        refreshed = findRecord(payload);
        if (!sourceOf(refreshed)) mediaError = 'VK не предоставил ссылку на эту запись. Обновите страницу музыки и повторите.';
      } catch (error) {
        mediaError = error.name === 'TimeoutError' || error.name === 'AbortError' ? 'VK не ответил на запрос аудиоплеера. Повторите загрузку.' : /^VK |^Не удалось |^Войдите/.test(error.message) ? error.message : 'Не удалось запросить ссылку аудиоплеера VK. Обновите страницу музыки и повторите.';
      }
    }
    if (refreshed) remember(refreshed, target.row);
  }
  const tracks = [];
  const playerArtwork = currentPlayerArtwork();
  for (const [id, { raw, row, artworkCandidates }] of records) {
    const array = Array.isArray(raw);
    const title = decodeText((array ? raw[3] : raw?.title) || row?.querySelector('.audio_row__title_inner, .audio_row__title')?.textContent).trim();
    const artist = decodeText((array ? raw[4] : raw?.artist || raw?.performer || raw?.artists?.map(item => item.name).join(', ')) || row?.querySelector('.audio_row__performer')?.textContent).trim();
    if (!title) continue;
    const covers = [...new Set([...(id === currentId ? playerArtwork : []), ...artworkCandidates, ...rowArtwork(row)])].slice(0, 24);
    const artwork = covers[0] || null;
    let source = unmask(sourceOf(raw));
    // A media element belongs to the current player only; never reuse it for a different row.
    if ((!source || source.includes('audio_api_unavailable')) && id === currentId) {
      for (const media of [player?._impl?._audioEl, player?._impl?._audio, ...document.querySelectorAll('audio')]) {
        const candidate = unmask(media?.currentSrc || media?.src);
        if (candidate && !candidate.includes('audio_api_unavailable')) { source = candidate; break; }
      }
    }
    const duration = array ? raw[5] : raw?.duration;
    const restricted = array ? Boolean(Number(raw[10]) & (4 | 256)) : Boolean(raw?.is_restricted || raw?.is_blocked || raw?.is_preview || raw?.is_snippet || raw?.drm || raw?.streamable === false);
    tracks.push({ id, title, artist, duration: Number(duration) || 0, artwork, artworkCandidates: covers, source, restricted });
  }
  return { href: location.href, viewerId, currentId, selectedId: targetId || null, tracks, mediaError };
}
