/**
 * Keeps the uploaded file in the browser so a lost server session can be
 * rebuilt without asking the user to find their spreadsheet again.
 *
 * Render's free tier has an ephemeral filesystem, so the server's own disk
 * store does not reliably survive a spin-down. The browser does. IndexedDB
 * is used rather than localStorage because HH workbooks run to megabytes.
 */

const DB_NAME = 'solar-data-profile';
const STORE = 'uploads';
const KEY = 'last-upload';
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

export interface CachedUpload {
  name: string;
  type: string;
  bytes: ArrayBuffer;
  savedAt: number;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) {
        request.result.createObjectStore(STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/** Never let a storage problem break the upload the user just made. */
export async function rememberUpload(file: File): Promise<void> {
  try {
    const bytes = await file.arrayBuffer();
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(
        { name: file.name, type: file.type, bytes, savedAt: Date.now() },
        KEY,
      );
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch {
    // Private browsing, quota exceeded, or IndexedDB disabled. Recovery is a
    // convenience; losing it costs the user a re-upload, not their data.
  }
}

export async function recallUpload(): Promise<File | null> {
  try {
    const db = await openDb();
    const cached = await new Promise<CachedUpload | undefined>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const request = tx.objectStore(STORE).get(KEY);
      request.onsuccess = () => resolve(request.result as CachedUpload | undefined);
      request.onerror = () => reject(request.error);
    });
    db.close();

    if (!cached || Date.now() - cached.savedAt > MAX_AGE_MS) return null;
    return new File([cached.bytes], cached.name, { type: cached.type });
  } catch {
    return null;
  }
}

export async function forgetUpload(): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
    db.close();
  } catch {
    // Nothing to do.
  }
}
