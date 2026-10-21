(() => {
  if (globalThis.__vkMusicDownloader) return;
  globalThis.__vkMusicDownloader = true;
  let job = null;
  let pending = false;
  let scanScheduled = false;
  const valid = value => /^-?\d+_\d+$/.test(value || '');
  const running = () => pending || Boolean(job && !['complete', 'error'].includes(job.status));
  function refreshButtons() {
    for (const button of document.querySelectorAll('.vkmd-download')) {
      const ownJob = job?.trackId === button.dataset.audioId;
      const label = ownJob && job.status === 'complete' ? 'MP3 сохранён' : ownJob && job.status === 'error' ? 'Повторить' : ownJob && running() ? `${Math.round(job.progress || 0)}%` : 'Скачать MP3';
      if (button.lastElementChild.textContent !== label) button.lastElementChild.textContent = label;
      button.disabled = running();
      button.title = ownJob ? job.message : 'Скачать аудиозапись в MP3';
    }
  }
  function scan() {
    scanScheduled = false;
    for (const row of document.querySelectorAll('.audio_row[data-full-id], [data-audio][data-full-id]')) {
      const id = row.getAttribute('data-full-id');
      if (!valid(id)) continue;
      const existing = row.querySelector('.vkmd-download');
      if (existing) { existing.dataset.audioId = id; continue; }
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'vkmd-download';
      button.dataset.audioId = id;
      const icon = document.createElement('img');
      icon.src = chrome.runtime.getURL('assets/download-blue.svg');
      icon.width = 13; icon.height = 13; icon.alt = '';
      const label = document.createElement('span');
      label.textContent = 'Скачать MP3';
      button.append(icon, label);
      button.addEventListener('click', async event => {
        event.preventDefault(); event.stopPropagation(); event.stopImmediatePropagation();
        if (running()) return;
        pending = true; refreshButtons();
        try {
          const response = await chrome.runtime.sendMessage({ target: 'background', type: 'DOWNLOAD', id: button.dataset.audioId });
          if (!response?.ok) throw new Error(response?.error || 'Обновите страницу VK и повторите.');
          // Progress can arrive before the original request resolves.
          if (job?.id !== response.job.id) job = response.job;
        } catch (error) {
          job = { trackId: button.dataset.audioId, status: 'error', message: error.message };
          const notice = document.createElement('div');
          notice.className = 'vkmd-notice'; notice.setAttribute('role', 'alert'); notice.textContent = error.message;
          document.querySelector('.vkmd-notice')?.remove(); document.body.append(notice);
          setTimeout(() => notice.remove(), 8000);
        } finally { pending = false; refreshButtons(); }
      }, true);
      const host = row.querySelector('.audio_row__actions, .audio_row__info') || row;
      host.append(button);
    }
    refreshButtons();
  }
  const observer = new MutationObserver(records => {
    if (scanScheduled || !records.some(record => record.type === 'attributes' || [...record.addedNodes].some(node => node.nodeType === 1 && !node.closest?.('.vkmd-download, .vkmd-notice')))) return;
    scanScheduled = true; requestAnimationFrame(scan);
  });
  observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-full-id'] });
  chrome.runtime.onMessage.addListener(message => { if (message?.type === 'JOB_UPDATE') { job = message.job; refreshButtons(); } });
  chrome.runtime.sendMessage({ target: 'background', type: 'GET_JOB' }).then(response => { if (response?.ok) { job = response.job; refreshButtons(); } }).catch(() => {});
  scan();
})();
