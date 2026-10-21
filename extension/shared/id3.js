// ID3v2.3: UTF-16 text and an APIC front-cover frame, readable by common music players.
const encoder = new TextEncoder();
const ascii = value => encoder.encode(value);
function join(parts) {
  const result = new Uint8Array(parts.reduce((size, part) => size + part.length, 0));
  let offset = 0;
  for (const part of parts) { result.set(part, offset); offset += part.length; }
  return result;
}
function uint32(value) { return new Uint8Array([value >>> 24, value >>> 16 & 255, value >>> 8 & 255, value & 255]); }
function utf16(value) {
  const bytes = new Uint8Array(2 + value.length * 2);
  bytes.set([255, 254]);
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < value.length; i++) view.setUint16(2 + i * 2, value.charCodeAt(i), true);
  return bytes;
}
function frame(name, data) { return join([ascii(name), uint32(data.length), new Uint8Array(2), data]); }

export function addMetadata(audio, { title, artist, url }, cover = null) {
  const frames = [frame('TIT2', join([new Uint8Array([1]), utf16(title)])), frame('TPE1', join([new Uint8Array([1]), utf16(artist)]))];
  if (url) frames.push(frame('WOAS', ascii(url)));
  if (cover?.bytes?.length) frames.push(frame('APIC', join([new Uint8Array([0]), ascii(cover.mime), new Uint8Array([0, 3, 0]), cover.bytes])));
  const payload = join(frames);
  const size = payload.length;
  const header = join([ascii('ID3'), new Uint8Array([3, 0, 0, size >>> 21 & 127, size >>> 14 & 127, size >>> 7 & 127, size & 127])]);
  let offset = 0;
  if (audio[0] === 73 && audio[1] === 68 && audio[2] === 51 && audio.length >= 10) {
    offset = 10 + ((audio[6] & 127) << 21 | (audio[7] & 127) << 14 | (audio[8] & 127) << 7 | audio[9] & 127);
    if (audio[3] === 4 && audio[5] & 16) offset += 10;
    if (offset > audio.length) throw new Error('Повреждённый ID3-тег аудиофайла.');
  }
  return new Blob([header, payload, audio.subarray(offset)], { type: 'audio/mpeg' });
}
