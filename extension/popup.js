import { durationLabel, isVkPage } from './shared/model.js';

const $ = id => document.getElementById(id);
const api = globalThis.chrome?.runtime?.id ? chrome : null;
const coverQueues = new WeakMap();
let tabId, tracks = [], currentTrack, currentJob, activeJob, pending = false, refreshing = false;
const terminal = job => !job || ['complete', 'error'].includes(job.status);
const busy = () => pending || !terminal(activeJob) || !terminal(currentJob);
function controls() {
  $('download').disabled = !currentTrack || currentTrack.restricted || Boolean(busy());
  $('save-cover').disabled = !currentTrack?.artwork || pending;
  $('download-label').textContent = busy() ? 'Подготавливаем MP3…' : 'Скачать MP3';
}
function feedback(message, type = '', progress = null) {
  $('feedback').hidden = !message;
  $('feedback').className = `feedback ${type}${progress !== null ? ' with-progress' : ''}`;
  $('status-message').textContent = message;
  $('progress-track').hidden = progress === null;
  $('progress-percent').hidden = progress === null;
  const percent = Math.max(0, Math.min(Number(progress) || 0, 100));
  $('progress-bar').style.width = `${percent}%`;
  $('progress-track').setAttribute('aria-valuenow', String(Math.round(percent)));
  $('progress-track').setAttribute('aria-valuetext', `${Math.round(percent)}% — ${message}`);
  $('progress-percent').textContent = `${Math.round(percent)}%`;
}
function imageFallback(event) {
  const image = event.target;
  if (image.getAttribute('src') === 'assets/music.svg') return;
  const next = coverQueues.get(image)?.shift();
  image.src = next || 'assets/music.svg';
  image.classList.toggle('placeholder', !next);
  if (!next) image.alt = '';
}
function setCover(image, track) {
  const candidates = [...new Set([track?.artwork, ...(track?.artworkCandidates || [])].filter(Boolean))];
  image.referrerPolicy = 'no-referrer';
  image.classList.toggle('placeholder', !candidates.length);
  image.src = candidates.shift() || 'assets/music.svg';
  coverQueues.set(image, candidates);
}
$('artwork').addEventListener('error', imageFallback);
function renderTrack(track) {
  currentTrack = track;
  $('track-card').setAttribute('aria-busy', 'false');
  $('track-title').textContent = track?.title || 'Откройте музыку VK';
  $('track-title').title = track?.title || '';
  $('track-artist').textContent = track?.artist || 'и выберите аудиозапись';
  $('track-artist').title = track?.artist || '';
  $('track-duration').textContent = durationLabel(track?.duration);
  setCover($('artwork'), track);
  $('artwork').alt = track?.artwork ? `Обложка ${track.title}` : '';
  $('track-eyebrow').textContent = track?.restricted ? 'ПОЛНАЯ ЗАПИСЬ НЕДОСТУПНА' : 'МУЗЫКА ИЗ ВКОНТАКТЕ';
  controls();
}
function renderList() {
  const query = $('search').value.trim().toLocaleLowerCase('ru');
  const filtered = tracks.filter(track => `${track.title} ${track.artist}`.toLocaleLowerCase('ru').includes(query));
  $('track-count').textContent = tracks.length;
  $('track-list').replaceChildren();
  $('empty').hidden = filtered.length > 0;
  $('open-vk').hidden = tracks.length > 0;
  $('empty-message').textContent = tracks.length ? 'Аудиозаписи не найдены. Попробуйте другой запрос.' : 'Откройте раздел «Музыка» ВКонтакте.';
  for (const track of filtered) {
    const button = document.createElement('button'); button.type = 'button';
    button.className = `track-row${track.id === currentTrack?.id ? ' selected' : ''}`;
    button.setAttribute('aria-pressed', String(track.id === currentTrack?.id));
    const cover = document.createElement('img'); cover.alt = ''; cover.addEventListener('error', imageFallback); setCover(cover, track);
    const meta = document.createElement('span'); meta.className = 'row-meta';
    const title = document.createElement('strong'); title.textContent = track.title;
    const artist = document.createElement('small'); artist.textContent = track.artist;
    const duration = document.createElement('span'); duration.className = 'row-duration'; duration.textContent = durationLabel(track.duration);
    meta.append(title, artist); button.append(cover, meta, duration);
    button.title = `${track.artist} — ${track.title}`;
    button.addEventListener('click', () => { renderTrack(track); renderList(); });
    $('track-list').append(button);
  }
}
function renderJob(job) {
  // Async stage updates can arrive out of order; a running job must never move backward.
  if (job && currentJob?.id === job.id) {
    if (terminal(currentJob) && !terminal(job)) return;
    job = { ...job, progress: job.status === 'complete' ? 100 : Math.max(Number(currentJob.progress) || 0, Number(job.progress) || 0) };
  }
  currentJob = job;
  $('open-download').hidden = job?.status !== 'complete' || !job?.downloadId;
  if (job) feedback(`${job.track?.title ? `${job.track.title}: ` : ''}${job.message}`, job.status === 'error' ? 'error' : job.status === 'complete' ? 'success' : '', job.status === 'complete' ? 100 : Number(job.progress) || 0);
  controls();
}
async function send(type, data = {}) {
  const response = await api.runtime.sendMessage({ target: 'background', type, tabId, ...data });
  if (!response?.ok) throw new Error(response?.error || 'Не удалось связаться с расширением. Обновите вкладку.');
  return response;
}
$('search').addEventListener('input', renderList);
$('download').addEventListener('click', async () => {
  pending = true; controls(); $('open-download').hidden = true;
  try {
    if (!api) throw new Error('Это предпросмотр. Для скачивания загрузите папку dist в Chrome.');
    feedback('Получаем аудиопоток VK…', '', 0);
    const result = await send('DOWNLOAD', { id: currentTrack.id });
    if (currentJob?.id !== result.job.id) renderJob(result.job);
  } catch (error) { feedback(error.message, 'error'); }
  finally { pending = false; controls(); }
});
$('save-cover').addEventListener('click', async () => {
  pending = true; controls();
  try {
    if (!api) throw new Error('Сохранение обложки доступно в установленном расширении Chrome.');
    await send('COVER', { id: currentTrack.id, artwork: $('artwork').src }); feedback('Обложка передана в загрузки Chrome.', 'success');
  } catch (error) { feedback(error.message, 'error'); }
  finally { pending = false; controls(); }
});
$('open-download').addEventListener('click', () => { if (currentJob?.downloadId && api) api.downloads.show(currentJob.downloadId); });
function showTab(help) {
  $('music-panel').hidden = help; $('help-panel').hidden = !help;
  for (const [id, selected] of [['tab-music', !help], ['tab-help', help]]) { $(id).classList.toggle('selected', selected); $(id).setAttribute('aria-pressed', String(selected)); }
}
$('tab-music').addEventListener('click', () => showTab(false));
$('tab-help').addEventListener('click', () => showTab(true));
$('refresh').addEventListener('click', () => refresh());
async function refresh() {
  if (refreshing) return;
  refreshing = true; $('refresh').disabled = true;
  try {
    if (!api) { if (new URLSearchParams(location.search).has('preview')) preview(); return; }
    const [tab] = await api.tabs.query({ active: true, currentWindow: true });
    tabId = tab?.id;
    if (!isVkPage(tab?.url)) {
      tracks = []; renderTrack(null); renderList(); $('connection-label').textContent = 'VK не открыт'; $('connection-label').classList.remove('active');
      feedback('Откройте музыку на vk.com или vk.ru и нажмите «Обновить».'); return;
    }
    const result = await send('GET_TRACKS');
    tracks = result.tracks;
    renderTrack(tracks.find(track => track.id === currentTrack?.id) || tracks.find(track => track.id === result.currentId) || tracks[0]);
    renderList();
    $('connection-label').textContent = tracks.length ? 'VK подключён' : 'Нет аудиозаписей';
    $('connection-label').classList.toggle('active', tracks.length > 0);
    const stored = await api.storage.session.get([`job:${tabId}`, 'activeJob']);
    activeJob = stored.activeJob;
    feedback(''); renderJob(stored[`job:${tabId}`]);
    if (!terminal(activeJob) && activeJob.tabId !== tabId) feedback('В другой вкладке выполняется загрузка. Дождитесь её завершения.');
  } catch (error) { tracks = []; renderTrack(null); renderList(); feedback(error.message, 'error'); }
  finally { refreshing = false; $('refresh').disabled = false; }
}
function preview() {
  tracks = [
    { id: '1_1', title: 'Тихий берег', artist: 'Север', duration: 238000, artwork: 'assets/preview-cover.jpg' },
    { id: '1_2', title: 'Останемся здесь', artist: 'Север', duration: 196000 },
    { id: '1_3', title: 'Город засыпает', artist: 'На кассете', duration: 213000 },
    { id: '1_4', title: 'Последний трамвай', artist: 'На кассете', duration: 184000 }
  ];
  renderTrack(tracks[0]); renderList(); $('connection-label').textContent = 'Предпросмотр';
  const state = new URLSearchParams(location.search).get('progress');
  if (state !== null) {
    const amount = Math.max(0, Math.min(Number(state) || 0, 100));
    renderJob({ id: 'preview', trackId: tracks[0].id, track: tracks[0], progress: amount, status: amount === 100 ? 'complete' : 'downloading', message: amount === 100 ? 'MP3 сохранён в загрузки.' : 'Загружаем аудио…' });
  }
}
if (api) {
  api.storage.onChanged.addListener((changes, area) => {
    if (area !== 'session') return;
    if (changes.activeJob) { activeJob = changes.activeJob.newValue; controls(); }
    if (changes[`job:${tabId}`]) renderJob(changes[`job:${tabId}`].newValue);
  });
  refresh();
} else if (new URLSearchParams(location.search).has('preview')) preview();
else { renderTrack(null); renderList(); $('connection-label').textContent = 'Расширение не установлено'; feedback('Загрузите папку dist через chrome://extensions, чтобы начать.'); }
