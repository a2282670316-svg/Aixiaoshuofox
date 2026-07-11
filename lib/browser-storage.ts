const DATABASE_NAME = "novel-forge-storage";
const DATABASE_VERSION = 1;
const STORE_NAME = "key-value";

type CompressedValue = { __novelForgeCompressed: true; format: "gzip"; data: ArrayBuffer };
const COMPRESSION_THRESHOLD = 100_000;

function isCompressedValue(value: unknown): value is CompressedValue {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
    && (value as { __novelForgeCompressed?: unknown }).__novelForgeCompressed === true
    && (value as { data?: unknown }).data instanceof ArrayBuffer;
}

async function encodeStoredValue<T>(value: T): Promise<T | CompressedValue> {
  if (typeof CompressionStream === "undefined") return value;
  const json = JSON.stringify(value);
  if (json.length < COMPRESSION_THRESHOLD) return value;
  const stream = new Blob([new TextEncoder().encode(json)]).stream().pipeThrough(new CompressionStream("gzip"));
  return { __novelForgeCompressed: true, format: "gzip", data: await new Response(stream).arrayBuffer() };
}

async function decodeStoredValue<T>(value: unknown): Promise<T> {
  if (!isCompressedValue(value)) return value as T;
  if (typeof DecompressionStream === "undefined") throw new Error("当前浏览器无法读取压缩作品数据");
  const stream = new Blob([value.data]).stream().pipeThrough(new DecompressionStream("gzip"));
  return JSON.parse(await new Response(stream).text()) as T;
}

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
  if (stored !== undefined) return decodeStoredValue<T>(stored);
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
  const stored = await encodeStoredValue(value);
  await withStore<IDBValidKey>("readwrite", (store) => store.put(stored, key));
}

export async function removePersistentValue(key: string) {
  if (typeof indexedDB !== "undefined") await withStore<undefined>("readwrite", (store) => store.delete(key));
  localStorage.removeItem(key);
}
