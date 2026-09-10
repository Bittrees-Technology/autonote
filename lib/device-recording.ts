import type { Segment } from "./model";
function database() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const r = indexedDB.open("autonote-device", 1);
    r.onupgradeneeded = () =>
      r.result.createObjectStore("recordings", { keyPath: "key" });
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
export type LocalRecording = {
  key: string;
  user: string;
  id: string;
  file: Blob;
  name: string;
  fingerprint: string;
  workspace: string;
  title: string;
  language: string;
  created: number;
  transcript?: Segment[];
  duration?: number;
  saved?: boolean;
};
export async function storeRecording(record: LocalRecording) {
  const db = await database();
  try {
    await new Promise<void>((resolve, reject) => {
      const t = db.transaction("recordings", "readwrite");
      t.objectStore("recordings").put(record);
      t.oncomplete = () => resolve();
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    });
  } finally {
    db.close();
  }
}
export async function localRecordings(user: string): Promise<LocalRecording[]> {
  const db = await database();
  try {
    const rows = await new Promise<LocalRecording[]>((resolve, reject) => {
      const r = db.transaction("recordings").objectStore("recordings").getAll();
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    return rows.filter((r) => r.user === user);
  } finally {
    db.close();
  }
}
export async function forgetRecording(key: string) {
  const db = await database();
  try {
    await new Promise<void>((resolve, reject) => {
      const t = db.transaction("recordings", "readwrite");
      t.objectStore("recordings").delete(key);
      t.oncomplete = () => resolve();
      t.onerror = () => reject(t.error);
    });
  } finally {
    db.close();
  }
}
export async function transcribeOnDevice(
  file: Blob,
  language: string,
  onProgress: (message: string, percent?: number) => void,
  signal: AbortSignal,
): Promise<{ transcript: Segment[]; duration: number }> {
  if (file.size > 100 * 1024 * 1024)
    throw new Error(
      "The free beta supports recordings up to 100 MB. Choose a shorter file.",
    );
  onProgress("Reading audio on this device…", 0);
  const context = new AudioContext({ sampleRate: 16000 });
  let buffer: AudioBuffer;
  try {
    buffer = await context.decodeAudioData(await file.arrayBuffer());
  } catch {
    throw new Error(
      "This browser could not decode the recording. Try a WAV, MP3, or supported M4A file.",
    );
  } finally {
    await context.close();
  }
  if (buffer.sampleRate !== 16000)
    throw new Error(
      "This browser cannot prepare 16 kHz audio. Try a current desktop Chrome browser.",
    );
  if (buffer.duration > 1800)
    throw new Error(
      "The free beta supports up to 30 minutes per recording. Split longer meetings before importing.",
    );
  if (!buffer.length || signal.aborted)
    throw new Error(
      "Transcription cancelled. The recording remains on this device.",
    );
  const mono = new Float32Array(buffer.length);
  for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
    const source = buffer.getChannelData(channel);
    for (let i = 0; i < mono.length; i++)
      mono[i] += source[i] / buffer.numberOfChannels;
  }
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./whisper.worker.ts", import.meta.url), {
      type: "module",
    });
    const stop = () => {
      worker.terminate();
      signal.removeEventListener("abort", cancel);
    };
    const cancel = () => {
      stop();
      reject(
        new Error(
          "Transcription cancelled. The recording remains on this device.",
        ),
      );
    };
    signal.addEventListener("abort", cancel, { once: true });
    worker.onerror = () => {
      stop();
      reject(
        new Error(
          "The speech worker could not start. Try a supported desktop browser and reload.",
        ),
      );
    };
    worker.onmessage = (e) => {
      const d = e.data;
      if (d.type === "progress") onProgress(d.message, d.percent);
      else if (d.type === "complete") {
        stop();
        resolve(d);
      } else if (d.type === "error") {
        stop();
        reject(new Error(d.message));
      }
    };
    worker.postMessage({ samples: mono.buffer, language }, [mono.buffer]);
  });
}
