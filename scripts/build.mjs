import { cp, mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = path.join(root, 'dist');
await mkdir(output, { recursive: true });
await cp(path.join(root, 'extension'), output, { recursive: true });
const assets = path.join(output, 'assets');
await mkdir(assets, { recursive: true });
await cp(path.join(root, 'static/logo_vk.png'), path.join(assets, 'logo-vk.png'));
await cp(path.join(root, 'static/button_vk.png'), path.join(assets, 'button-vk.png'));
// Isolate the two sprite bands so taller buttons never expose the adjacent color.
for (const [name, top, height] of [['blue', 16, 26], ['blue-hover', 8, 34], ['gray', 54, 30], ['gray-hover', 46, 38]]) {
  await sharp(path.join(root, 'static/button_vk.png')).extract({ left: 0, top, width: 1, height }).png().toFile(path.join(assets, `button-${name}.png`));
}
await cp(path.join(root, 'static/preview-cover.jpg'), path.join(assets, 'preview-cover.jpg'));
for (const [name, icon, color] of [['download', 'download', '#ffffff'], ['download-blue', 'download', '#45688e'], ['image', 'image', '#6c7e90'], ['music', 'music-note-beamed', '#8c9eb0'], ['search', 'search', '#8b98a6'], ['info', 'info-circle', '#8b98a6']]) {
  const source = await readFile(path.join(root, `node_modules/bootstrap-icons/icons/${icon}.svg`), 'utf8');
  await writeFile(path.join(assets, `${name}.svg`), source.replaceAll('currentColor', color));
}
for (const size of [16, 32, 48, 128]) {
  const logo = await sharp(path.join(root, 'static/logo_vk.png')).resize(Math.round(size * .76), Math.round(size * .46), { fit: 'inside' }).png().toBuffer();
  await sharp({ create: { width: size, height: size, channels: 4, background: '#597da3' } }).composite([{ input: logo, gravity: 'centre' }]).png().toFile(path.join(assets, `icon-${size}.png`));
}
for (const [source, destination] of [['node_modules/@ffmpeg/ffmpeg/dist/esm', 'vendor/ffmpeg'], ['node_modules/@ffmpeg/core/dist/esm', 'vendor/core']]) {
  const target = path.join(output, destination);
  await mkdir(target, { recursive: true });
  for (const name of await readdir(path.join(root, source))) if (name.endsWith('.js') || name.endsWith('.wasm')) await cp(path.join(root, source, name), path.join(target, name));
}
const licenses = path.join(output, 'licenses');
await mkdir(licenses, { recursive: true });
for (const name of ['ffmpeg-GPL-2.0.txt', 'ffmpeg-wasm-LICENSE', 'vk-api-Apache-2.0.txt']) await cp(path.join(root, 'static', name), path.join(licenses, name));
await writeFile(path.join(licenses, 'vk-audio-url-NOTICE.txt'), 'VK URL decoding format: cross-checked against vk_api, Copyright (c) 2019 python273, Apache License 2.0.\nReference: https://github.com/python273/vk_api/blob/master/vk_api/audio_url_decoder.py\nThe extension contains a JavaScript implementation of this URL format with local validation and user-facing errors.\n');
for (const [source, destination] of [['@ffmpeg/ffmpeg', 'ffmpeg-wasm'], ['@ffmpeg/core', 'ffmpeg-core'], ['bootstrap-icons', 'bootstrap-icons']]) {
  for (const name of (await readdir(path.join(root, 'node_modules', source))).filter(name => /^licen[sc]e/i.test(name))) await cp(path.join(root, 'node_modules', source, name), path.join(licenses, `${destination}-${name}`));
}
await writeFile(path.join(licenses, 'ASSETS.txt'), 'VK 2013 logo and button sprite: supplied spinula2/archive/vk-2013 design. VK marks belong to their respective owners. UI icons: Bootstrap Icons (MIT). Preview photograph: copied from the supplied SoundCloud project, https://unsplash.com/license. FFmpeg includes GPL components; see included licenses and upstream sources https://github.com/ffmpegwasm/ffmpeg.wasm and https://github.com/ffmpegwasm/ffmpeg.wasm-core. This extension is not affiliated with VK.\n');
await writeFile(path.join(output, 'INSTALL.txt'), 'VK Music Downloader — 2013\n\n1. Extract this entire archive into a folder.\n2. Open chrome://extensions in Chrome 116 or later.\n3. Enable Developer mode.\n4. Click Load unpacked and select the folder containing manifest.json.\n5. Reload VK tabs. Sign in to VK and open Music on vk.com or vk.ru.\n6. Select an audio record in the popup, then click Скачать MP3, or use the button beside a VK audio row.\n7. Playback links are resolved automatically. If VK does not return a full recording, refresh the music page and retry.\n\nAudio conversion and metadata embedding run locally. Keep Chrome open until the download completes. Only download recordings you have permission to save. Previews, unavailable full recordings, DRM, live streams and byte-range HLS are not supported.\n');
console.log(`Built Chrome extension: ${output}`);
