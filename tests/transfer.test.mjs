import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readResponseBytes } from '../extension/shared/transfer.js';

function streamed(chunks, headers = {}, onCancel) {
  return new Response(new ReadableStream({ start(controller) { for (const chunk of chunks) controller.enqueue(new Uint8Array(chunk)); controller.close(); }, cancel: onCancel }), { headers });
}

test('stream progress reports every received chunk against the real Content-Length', async () => {
  const progress = [];
  const bytes = await readResponseBytes(streamed([[1, 2], [3], [4, 5]], { 'Content-Length': '5' }), 100, (loaded, total) => { progress.push([loaded, total]); });
  assert.deepEqual(progress, [[2, 5], [3, 5], [5, 5]]);
  assert.deepEqual(bytes, new Uint8Array([1, 2, 3, 4, 5]));
});

test('unknown-length streams report actual bytes without inventing a total', async () => {
  const progress = [];
  await readResponseBytes(streamed([[1, 2], [3]]), 100, (loaded, total) => { progress.push([loaded, total]); });
  assert.deepEqual(progress, [[2, 0], [3, 0]]);
});

test('oversized and empty media are rejected while streaming limits remain enforced', async () => {
  await assert.rejects(readResponseBytes(streamed([[1]], { 'Content-Length': '10' }), 5), /слишком большой/);
  await assert.rejects(readResponseBytes(streamed([[1, 2], [3, 4]]), 3), /слишком большой/);
  await assert.rejects(readResponseBytes(streamed([])), /пустой файл/);
});
