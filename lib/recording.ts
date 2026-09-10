function db() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const r = indexedDB.open("autonote-recording", 1);
    r.onupgradeneeded = () =>
      r.result.createObjectStore("chunks", { autoIncrement: true });
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
export async function saveChunk(blob: Blob) {
  const d = await db();
  await new Promise<void>((resolve, reject) => {
    const t = d.transaction("chunks", "readwrite");
    t.objectStore("chunks").add(blob);
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
  });
  d.close();
}
export async function recordedChunks() {
  const d = await db();
  const blobs = await new Promise<Blob[]>((resolve, reject) => {
    const r = d.transaction("chunks").objectStore("chunks").getAll();
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
  d.close();
  return blobs;
}
export async function clearRecording() {
  const d = await db();
  await new Promise<void>((resolve, reject) => {
    const t = d.transaction("chunks", "readwrite");
    t.objectStore("chunks").clear();
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
  });
  d.close();
}
