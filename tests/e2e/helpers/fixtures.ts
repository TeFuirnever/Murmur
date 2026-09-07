// [20260906_Test_FileTranscriptionJourney] Shared e2e fixture helper:
// runtime-generates a silent wav so no binary fixture lands in the repo.
import fs from "fs";
import os from "os";
import path from "path";

/** Canonical 44-byte PCM WAV header + `seconds` of mono 16-bit silence. */
export function makeSilentWav(seconds = 1, sampleRate = 16000): Buffer {
  const dataSize = sampleRate * seconds * 2;
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + dataSize, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28); // byte rate
  header.writeUInt16LE(2, 32); // block align
  header.writeUInt16LE(16, 34); // bits per sample
  header.write("data", 36);
  header.writeUInt32LE(dataSize, 40);
  return Buffer.concat([header, Buffer.alloc(dataSize)]);
}

export function writeTempSilentWav(tag: string): string {
  const wavPath = path.join(os.tmpdir(), `murmur-e2e-${tag}-${Date.now()}.wav`);
  fs.writeFileSync(wavPath, makeSilentWav());
  return wavPath;
}
