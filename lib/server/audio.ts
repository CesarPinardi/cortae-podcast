const SIGNATURE_BYTES = 12;

export async function readAudioSignature(stream: ReadableStream<Uint8Array>) {
  const reader = stream.getReader();
  const signature = new Uint8Array(SIGNATURE_BYTES);
  let offset = 0;
  try {
    while (offset < SIGNATURE_BYTES) {
      const { done, value } = await reader.read();
      if (done) break;
      const length = Math.min(value.length, SIGNATURE_BYTES - offset);
      signature.set(value.subarray(0, length), offset);
      offset += length;
    }
  } finally {
    void reader.cancel();
  }
  return signature.subarray(0, offset);
}

export function hasValidAudioSignature(contentType: string, bytes: Uint8Array) {
  if (contentType === 'audio/mpeg')
    return (
      (bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) ||
      (bytes[0] === 0xff &&
        (bytes[1] & 0xe0) === 0xe0 &&
        (bytes[1] & 0x18) !== 0x08 &&
        (bytes[1] & 0x06) !== 0)
    );
  if (contentType === 'audio/aac')
    return bytes[0] === 0xff && (bytes[1] & 0xf6) === 0xf0;
  if (contentType === 'audio/mp4')
    return (
      bytes[4] === 0x66 &&
      bytes[5] === 0x74 &&
      bytes[6] === 0x79 &&
      bytes[7] === 0x70
    );
  return false;
}
