import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodeAudioUrl } from '../extension/shared/audio-url.js';
import { allowedUrl } from '../extension/shared/model.js';

const expected = 'https://psv4.vkuseraudio.net/tone.mp3';
const mask = (extra, operations) => `https://vk.com/mp3/audio_api_unavailable.mp3?extra=${extra}#${operations}`;
const vectors = [
  ['plain', 'AhrOChm6lY9WC3yOlNzRDxnLCMf1zgLVlM5LDc9OB25LlM1WmW', ''],
  ['reverse', 'm3bTlMvUB3qVDgvUlM9PzhvHCMvZDwT2lJr2C3aVlZPZChrOAa', 'DG'],
  ['rotation', 'BOfbD306zMz3EKmVlKnYqNPSEwHcA3b2lNvSqwzbDNvSlNr3kW', 'CGS3'],
  ['xor', 'iZ8/oZHXzgq7od1/ztOGpJGUos0+lYiKzsuUp2q/jcuUzsy7Ea', 'EaTl'],
  ['shuffle', 'AhjWDhqUDdrRCgu6zw91C3z1lNnLlI8VDgqVDM5WBM9Tm3nHAq', 'CWSXmJmOnq'],
  ['viewer shuffle', 'AhjWDhqUDdrRCgu6zw91C3z1lNnLlI8VDgqVDM5WBM9Tm3nHAq', 'AqSXmJmOnq']
];

test('VK masked playback URLs decode locally without a page-global decoder', () => {
  for (const [name, extra, operations] of vectors) assert.equal(decodeAudioUrl(mask(extra, operations), 123), expected, name);
  assert.equal(decodeAudioUrl(expected), expected);
  assert.equal(decodeAudioUrl(null), null);
});

test('bad masks and missing viewer identities produce actionable errors without signed URL leakage', () => {
  const [, extra, operations] = vectors.at(-1);
  assert.throws(() => decodeAudioUrl(mask(extra, operations)), /аккаунт VK/);
  for (const value of [mask('secret%ZZ', 'DG'), mask('a', 'DG'), mask('secret', '???'), 'https://vk.com/mp3/audio_api_unavailable.mp3?token=secret']) {
    assert.throws(() => decodeAudioUrl(value), error => { assert.doesNotMatch(error.message, /secret|token|extra=/); return true; });
  }
  assert.throws(() => decodeAudioUrl(mask(vectors[0][1], 'B3bZ')), /формат/);
});

test('decoded URLs still pass through the media host allowlist', () => {
  const foreign = 'https://example.com/audio.mp3';
  const alpha = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMN0PQRSTUVWXYZO123456789+/=';
  const std = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=';
  const encoded = btoa(foreign).replace(/=+$/, '').split('').map(character => alpha[std.indexOf(character)]).join('');
  const decoded = decodeAudioUrl(mask(encoded, ''));
  assert.equal(decoded, foreign);
  assert.throws(() => allowedUrl(decoded));
});
