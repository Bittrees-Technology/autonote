function db(user: string) {
  if (!user) throw new Error("Sign in to access saved audio.");
  return new Promise<IDBDatabase>((resolve, reject) => {
    const r = indexedDB.open("autonote-recording-" + user, 1);
    r.onupgradeneeded = () =>
      r.result.createObjectStore("chunks", { autoIncrement: true });
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
export async function saveChunk(user: string, blob: Blob) {
  const d = await db(user);
  await new Promise<void>((resolve, reject) => {
    const t = d.transaction("chunks", "readwrite");
    t.objectStore("chunks").add(blob);
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
  });
  d.close();
}
export async function recordedChunks(user: string) {
  const d = await db(user);
  const blobs = await new Promise<Blob[]>((resolve, reject) => {
    const r = d.transaction("chunks").objectStore("chunks").getAll();
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
  d.close();
  return blobs;
}
export async function clearRecording(user: string) {
  const d = await db(user);
  await new Promise<void>((resolve, reject) => {
    const t = d.transaction("chunks", "readwrite");
    t.objectStore("chunks").clear();
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
  });
  d.close();
}
