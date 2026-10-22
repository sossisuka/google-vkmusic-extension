(() => {
  if (globalThis.__vkSaverBridge) return;
  globalThis.__vkSaverBridge = true;
  const actions = new Set(['PING', 'CONNECT', 'LIBRARY', 'SEARCH', 'IMPORT', 'DOWNLOAD', 'COVER', 'GET_JOB', 'PLAY', 'PAUSE']);
  let pending = 0;
  window.addEventListener('message', async event => {
    const data = event.data;
    if (event.source !== window || event.origin !== location.origin || data?.channel !== 'vksaver:request' || !actions.has(data.action) || typeof data.id !== 'string' || data.id.length > 100 || pending > 8) return;
    pending++;
    try {
      const result = await chrome.runtime.sendMessage({ target: 'background', type: 'WEBSITE', action: data.action, payload: data.payload });
      window.postMessage({ channel: 'vksaver:response', id: data.id, ...result }, location.origin);
    } catch { window.postMessage({ channel: 'vksaver:response', id: data.id, ok: false, error: 'Обновите расширение и перезагрузите страницу VKSaver.' }, location.origin); }
    finally { pending--; }
  });
  window.postMessage({ channel: 'vksaver:ready', version: chrome.runtime.getManifest().version }, location.origin);
})();
