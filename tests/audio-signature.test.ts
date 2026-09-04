import assert from 'node:assert/strict';
import test from 'node:test';
import { hasValidAudioSignature } from '../lib/server/audio.ts';

void test('aceita assinaturas dos formatos de áudio permitidos', () => {
  assert.equal(
    hasValidAudioSignature('audio/mpeg', Uint8Array.from([0x49, 0x44, 0x33])),
    true,
  );
  assert.equal(
    hasValidAudioSignature('audio/aac', Uint8Array.from([0xff, 0xf1])),
    true,
  );
  assert.equal(
    hasValidAudioSignature(
      'audio/mp4',
      Uint8Array.from([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70]),
    ),
    true,
  );
});

void test('rejeita corpo arbitrário mesmo com MIME de áudio', () => {
  const text = new TextEncoder().encode('not really audio');
  assert.equal(hasValidAudioSignature('audio/mpeg', text), false);
  assert.equal(hasValidAudioSignature('audio/aac', text), false);
  assert.equal(hasValidAudioSignature('audio/mp4', text), false);
  assert.equal(
    hasValidAudioSignature('audio/mpeg', Uint8Array.from([0xff, 0xf1])),
    false,
  );
});
