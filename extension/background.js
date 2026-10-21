import { fileName, isVkPage, audioId } from './shared/model.js';
import { readTracks, resolveTrack } from './vk.js';

let creatingOffscreen;
let starting = false;
let updateQueue = Promise.resolve();
const terminal = job => ['complete', 'error'].includes(job.status);
const publicTrack = ({ source, restricted, ...track }) => ({ ...track, restricted });

async function offscreen() {
  const contexts = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'], documentUrls: [chrome.runtime.getURL('offscreen.html')] });
  if (contexts.length) return;
  if (!creatingOffscreen) creatingOffscreen = chrome.offscreen.createDocument({ url: 'offscreen.html', reasons: ['BLOBS', 'WORKERS'], justification: 'Convert VK audio locally and create MP3 downloads with track metadata and artwork.' }).finally(() => { creatingOffscreen = null; });
  await creatingOffscreen;
}

function update(job) {
  const pendingUpdate = updateQueue.then(() => persistUpdate(job));
  updateQueue = pendingUpdate.catch(() => {});
  return pendingUpdate;
}
async function persistUpdate(job) {
  const previous = (await chrome.storage.session.get(`job:${job.tabId}`))[`job:${job.tabId}`];
  if (previous?.id === job.id) {
    if (terminal(previous)) return;
    if (!terminal(job) && Number(job.progress) < Number(previous.progress)) return;
    job = { ...job, progress: job.status === 'complete' ? 100 : Math.max(Number(previous.progress) || 0, Number(job.progress) || 0) };
  }
  await chrome.storage.session.set({ [`job:${job.tabId}`]: job });
  if (terminal(job)) {
    const { activeJob } = await chrome.storage.session.get('activeJob');
    if (activeJob?.id === job.id) await chrome.storage.session.remove('activeJob');
  } else await chrome.storage.session.set({ activeJob: job });
  chrome.tabs.sendMessage(job.tabId, { type: 'JOB_UPDATE', job }).catch(() => {});
  chrome.action.setBadgeText({ tabId: job.tabId, text: terminal(job) ? (job.status === 'complete' ? '✓' : '!') : `${Math.round(job.progress || 0)}%` }).catch(() => {});
  chrome.action.setBadgeBackgroundColor({ tabId: job.tabId, color: job.status === 'error' ? '#b64228' : '#597da3' }).catch(() => {});
}

async function download(id, tabId) {
  if (starting) throw new Error('Другая загрузка уже запускается. Подождите немного.');
  starting = true;
  let job;
  try {
    const { activeJob } = await chrome.storage.session.get('activeJob');
    if (activeJob && !terminal(activeJob)) throw new Error('Дождитесь завершения текущей загрузки MP3.');
    job = { id: crypto.randomUUID(), trackId: id, tabId, status: 'preparing', progress: 1, message: 'Получаем аудиопоток VK…' };
    await update(job);
    const { track, stream } = await resolveTrack(tabId, id, true);
    job.track = publicTrack(track);
    job.message = 'Загружаем аудио…';
    await update(job);
    await offscreen();
    const result = await chrome.runtime.sendMessage({ target: 'offscreen', type: 'PROCESS', job, stream });
    if (!result?.ok) throw new Error(result?.error || 'Не удалось запустить конвертер MP3.');
    return { ok: true, job };
  } catch (error) {
    if (job) await update({ ...job, status: 'error', message: error.message });
    throw error;
  } finally { starting = false; }
}

async function handle(message, sender) {
  if (sender.id !== chrome.runtime.id) throw new Error('Недопустимый отправитель.');
  const internal = sender.url?.startsWith(chrome.runtime.getURL('')) && !sender.tab?.url?.startsWith('https:');
  const fromOffscreen = sender.url === chrome.runtime.getURL('offscreen.html');
  if (['PROGRESS', 'READY', 'FAILED'].includes(message.type)) {
    if (!fromOffscreen) throw new Error('Недопустимый отправитель.');
    const { activeJob } = await chrome.storage.session.get('activeJob');
    if (!activeJob || activeJob.id !== message.jobId) return { ok: true };
    if (message.type === 'PROGRESS') await update({ ...activeJob, status: message.status, message: message.message, progress: message.progress });
    if (message.type === 'FAILED') await update({ ...activeJob, status: 'error', message: message.error });
    if (message.type === 'READY') {
      if (!message.blobUrl?.startsWith(`blob:${chrome.runtime.getURL('')}`)) throw new Error('Некорректный файл загрузки.');
      try {
        const downloadId = await chrome.downloads.download({ url: message.blobUrl, filename: fileName(activeJob.track.artist, activeJob.track.title), conflictAction: 'uniquify', saveAs: false });
        const savingJob = { ...activeJob, warning: message.warning || '', downloadId, status: 'saving', progress: 99, message: 'Сохраняем MP3…' };
        await chrome.storage.session.set({ [`download:${downloadId}`]: { job: savingJob, blobUrl: message.blobUrl } });
        await update(savingJob);
        const [item] = await chrome.downloads.search({ id: downloadId });
        if (item && ['complete', 'interrupted'].includes(item.state)) await finishDownload(downloadId, item.state, item.error);
      } catch (error) {
        chrome.runtime.sendMessage({ target: 'offscreen', type: 'RELEASE', blobUrl: message.blobUrl }).catch(() => {});
        await update({ ...activeJob, status: 'error', message: `Не удалось сохранить файл: ${error.message}` });
      }
    }
    return { ok: true };
  }
  const tabId = internal ? message.tabId : sender.tab?.id;
  if (!Number.isInteger(tabId)) throw new Error('Не удалось определить вкладку VK.');
  const tab = await chrome.tabs.get(tabId);
  if (!isVkPage(tab.url) || (!internal && !isVkPage(sender.url))) throw new Error('Откройте музыку на vk.com или vk.ru.');
  if (message.type === 'GET_JOB') return { ok: true, job: (await chrome.storage.session.get(`job:${tabId}`))[`job:${tabId}`] };
  if (message.type === 'GET_TRACKS') {
    const page = await readTracks(tabId);
    return { ok: true, ...page, tracks: page.tracks.map(publicTrack) };
  }
  const id = audioId(message.id);
  if (!id) throw new Error('Выберите аудиозапись VK.');
  if (message.type === 'DOWNLOAD') return download(id, tabId);
  if (message.type === 'COVER') {
    const { track } = await resolveTrack(tabId, id);
    if (!track.artwork) throw new Error('У этой аудиозаписи нет обложки.');
    const artwork = track.artworkCandidates.includes(message.artwork) ? message.artwork : track.artwork;
    const extension = new URL(artwork).pathname.match(/\.(png|jpe?g|webp)$/i)?.[1]?.toLowerCase() || 'jpg';
    const downloadId = await chrome.downloads.download({ url: artwork, filename: fileName(track.artist, track.title, extension), conflictAction: 'uniquify', saveAs: false });
    return { ok: true, downloadId };
  }
  throw new Error('Неизвестный запрос.');
}

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (message?.target !== 'background') return;
  handle(message, sender).then(respond, error => respond({ ok: false, error: error.message }));
  return true;
});

async function finishDownload(id, state, error) {
  const key = `download:${id}`;
  const entry = (await chrome.storage.session.get(key))[key];
  if (!entry) return;
  await chrome.storage.session.remove(key);
  await update({ ...entry.job, downloadId: id, status: state === 'complete' ? 'complete' : 'error', progress: state === 'complete' ? 100 : entry.job.progress, message: state === 'complete' ? `MP3 сохранён в загрузки.${entry.job.warning ? ` ${entry.job.warning}` : ''}` : `Загрузка прервана: ${error || 'попробуйте ещё раз'}.` });
  chrome.runtime.sendMessage({ target: 'offscreen', type: 'RELEASE', blobUrl: entry.blobUrl }).catch(() => {});
}
chrome.downloads.onChanged.addListener(delta => {
  if (['complete', 'interrupted'].includes(delta.state?.current)) finishDownload(delta.id, delta.state.current, delta.error?.current).catch(console.error);
});
chrome.tabs.onRemoved.addListener(tabId => { chrome.storage.session.remove(`job:${tabId}`).catch(() => {}); });
