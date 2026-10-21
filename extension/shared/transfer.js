// Report downloaded bytes as they arrive, even when the server omits Content-Length.
export async function readResponseBytes(response, limit = 200 * 1024 * 1024, onProgress = null) {
  const total = Number(response.headers.get('content-length')) || 0;
  if (total > limit) throw new Error('Файл слишком большой для локальной обработки (максимум 200 МБ).');
  const reader = response.body.getReader();
  const parts = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > limit) { await reader.cancel(); throw new Error('Файл слишком большой для локальной обработки (максимум 200 МБ).'); }
      parts.push(value);
      if (onProgress) await onProgress(size, total);
    }
  } finally { reader.releaseLock(); }
  if (!size) throw new Error('VK вернул пустой файл.');
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) { bytes.set(part, offset); offset += part.length; }
  return bytes;
}
