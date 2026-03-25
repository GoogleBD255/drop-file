import { openDB, DBSchema, IDBPDatabase } from 'idb';

export interface TransferHistoryRecord {
  id: string;
  fileName: string;
  fileSize: number;
  fileType: string;
  direction: 'sent' | 'received';
  status: 'completed' | 'failed' | 'cancelled';
  timestamp: number;
  blob?: Blob; // Only stored for received completed files
}

interface FastShareDB extends DBSchema {
  history: {
    key: string;
    value: TransferHistoryRecord;
    indexes: {
      'by-timestamp': number;
    };
  };
}

let dbPromise: Promise<IDBPDatabase<FastShareDB>> | null = null;

export function getDB() {
  if (!dbPromise) {
    dbPromise = openDB<FastShareDB>('fast-share-db', 1, {
      upgrade(db) {
        const store = db.createObjectStore('history', { keyPath: 'id' });
        store.createIndex('by-timestamp', 'timestamp');
      },
    });
  }
  return dbPromise;
}

export async function addHistoryRecord(record: TransferHistoryRecord) {
  const db = await getDB();
  await db.put('history', record);
}

export async function updateHistoryRecord(id: string, updates: Partial<TransferHistoryRecord>) {
  const db = await getDB();
  const tx = db.transaction('history', 'readwrite');
  const store = tx.objectStore('history');
  const record = await store.get(id);
  if (record) {
    await store.put({ ...record, ...updates });
  }
  await tx.done;
}

export async function getHistoryRecords(): Promise<TransferHistoryRecord[]> {
  const db = await getDB();
  const tx = db.transaction('history', 'readonly');
  const store = tx.objectStore('history');
  const index = store.index('by-timestamp');
  const records = await index.getAll();
  // Return sorted by timestamp descending
  return records.sort((a, b) => b.timestamp - a.timestamp);
}

export async function deleteHistoryRecord(id: string) {
  const db = await getDB();
  await db.delete('history', id);
}

export async function clearHistory() {
  const db = await getDB();
  await db.clear('history');
}
