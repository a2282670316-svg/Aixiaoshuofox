const DATABASE_NAME = "novel-forge-storage";
const DATABASE_VERSION = 1;
const STORE_NAME = "key-value";

function openDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) request.result.createObjectStore(STORE_NAME);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("无法打开浏览器作品数据库"));
  });
}

async function withStore<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>) {
  const database = await openDatabase();
  try {
    return await new Promise<T>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, mode);
      const request = action(transaction.objectStore(STORE_NAME));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || transaction.error || new Error("浏览器作品数据库操作失败"));
      transaction.onabort = () => reject(transaction.error || new Error("浏览器作品数据库事务失败"));
    });
  } finally {
    database.close();
  }
}

export async function readPersistentValue<T>(key: string): Promise<T | null> {
  if (typeof indexedDB === "undefined") {
    const fallback = localStorage.getItem(key);
    return fallback ? JSON.parse(fallback) as T : null;
  }
  const stored = await withStore<unknown>("readonly", (store) => store.get(key));
  if (stored !== undefined) return stored as T;
  const legacy = localStorage.getItem(key);
  if (!legacy) return null;
  const parsed = JSON.parse(legacy) as T;
  await writePersistentValue(key, parsed);
  localStorage.removeItem(key);
  return parsed;
}

export async function writePersistentValue<T>(key: string, value: T) {
  if (typeof indexedDB === "undefined") {
    localStorage.setItem(key, JSON.stringify(value));
    return;
  }
  await withStore<IDBValidKey>("readwrite", (store) => store.put(value, key));
}

export async function removePersistentValue(key: string) {
  if (typeof indexedDB !== "undefined") await withStore<undefined>("readwrite", (store) => store.delete(key));
  localStorage.removeItem(key);
}
