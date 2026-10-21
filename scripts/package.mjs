import { readdir, readFile, writeFile } from 'node:fs/promises';
import { zipSync } from 'fflate';
import path from 'node:path';
const files = {};
async function walk(directory, prefix = '') {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const relative = `${prefix}${entry.name}`;
    if (entry.isDirectory()) await walk(path.join(directory, entry.name), `${relative}/`);
    else files[relative] = new Uint8Array(await readFile(path.join(directory, entry.name)));
  }
}
await walk('dist');
await writeFile('vk-music-downloader.zip', zipSync(files, { level: 6 }));
console.log('Created vk-music-downloader.zip. Extract it and load its folder in chrome://extensions.');
