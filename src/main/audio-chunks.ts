import { app } from 'electron';
import { mkdir, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';

const AUDIO_CHUNK_DIRECTORY_NAME = 'audio-chunks';
const AUDIO_CHUNK_ROOT_DIRECTORY_NAME = 'study-capture';
const AUDIO_CHUNK_FILE_EXTENSION = '.webm';

export function isArrayBuffer(value: unknown): value is ArrayBuffer {
  return Object.prototype.toString.call(value) === '[object ArrayBuffer]';
}

function resolveAudioChunkDirectory(): string {
  return join(app.getPath('temp'), AUDIO_CHUNK_ROOT_DIRECTORY_NAME, AUDIO_CHUNK_DIRECTORY_NAME);
}

export async function saveAudioChunk(arrayBuffer: ArrayBuffer): Promise<string> {
  const directory = resolveAudioChunkDirectory();
  await mkdir(directory, { recursive: true });

  const fileName = `${Date.now()}-${randomUUID()}${AUDIO_CHUNK_FILE_EXTENSION}`;
  const filePath = join(directory, fileName);
  await writeFile(filePath, Buffer.from(arrayBuffer));

  return filePath;
}
