/**
 * Storage adapter interface and implementations for the learner model.
 * Offline-first: MemoryStorage for fast test suites, IndexedDbStorage for the browser.
 */
import type { LearnerEvent } from '../shared/events';

export interface StorageAdapter {
  getEvents(): Promise<LearnerEvent[]>;
  appendEvent(event: LearnerEvent): Promise<void>;
  replaceEvents(events: LearnerEvent[]): Promise<void>;
  getMeta<T>(key: string): Promise<T | null>;
  setMeta<T>(key: string, value: T): Promise<void>;
  deleteMeta(key: string): Promise<void>;
  clearAll(): Promise<void>;
}

export class MemoryStorage implements StorageAdapter {
  private events: LearnerEvent[] = [];
  private meta = new Map<string, unknown>();

  async getEvents(): Promise<LearnerEvent[]> {
    return this.events.map(e => JSON.parse(JSON.stringify(e)) as LearnerEvent);
  }

  async appendEvent(event: LearnerEvent): Promise<void> {
    this.events.push(JSON.parse(JSON.stringify(event)) as LearnerEvent);
  }

  async replaceEvents(events: LearnerEvent[]): Promise<void> {
    this.events = events.map(e => JSON.parse(JSON.stringify(e)) as LearnerEvent);
  }

  async getMeta<T>(key: string): Promise<T | null> {
    const val = this.meta.get(key);
    return val !== undefined ? (JSON.parse(JSON.stringify(val)) as T) : null;
  }

  async setMeta<T>(key: string, value: T): Promise<void> {
    this.meta.set(key, JSON.parse(JSON.stringify(value)));
  }

  async deleteMeta(key: string): Promise<void> {
    this.meta.delete(key);
  }

  async clearAll(): Promise<void> {
    this.events = [];
    this.meta.clear();
  }
}

export class IndexedDbStorage implements StorageAdapter {
  private dbName: string;
  private dbPromise: Promise<IDBDatabase> | null = null;

  constructor(dbName = 'ovs-learner') {
    this.dbName = dbName;
  }

  private getDb(): Promise<IDBDatabase> {
    if (!this.dbPromise) {
      this.dbPromise = new Promise((resolve, reject) => {
        const req = indexedDB.open(this.dbName, 1);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains('events')) {
            db.createObjectStore('events', { autoIncrement: true });
          }
          if (!db.objectStoreNames.contains('meta')) {
            db.createObjectStore('meta');
          }
        };
        req.onsuccess = () => {
          const db = req.result;
          db.onclose = () => {
            this.dbPromise = null;
          };
          db.onversionchange = () => {
            db.close();
            this.dbPromise = null;
          };
          resolve(db);
        };
        req.onerror = () => {
          this.dbPromise = null;
          reject(req.error);
        };
      });
    }
    return this.dbPromise;
  }

  async getEvents(): Promise<LearnerEvent[]> {
    const db = await this.getDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('events', 'readonly');
      const store = tx.objectStore('events');
      const req = store.getAll();
      req.onsuccess = () => resolve((req.result as LearnerEvent[]) || []);
      req.onerror = () => reject(req.error);
    });
  }

  async appendEvent(event: LearnerEvent): Promise<void> {
    const db = await this.getDb();
    const cloned = JSON.parse(JSON.stringify(event)) as LearnerEvent;
    return new Promise((resolve, reject) => {
      const tx = db.transaction('events', 'readwrite');
      const store = tx.objectStore('events');
      store.add(cloned);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  }

  async replaceEvents(events: LearnerEvent[]): Promise<void> {
    const db = await this.getDb();
    const clonedEvents = events.map(e => JSON.parse(JSON.stringify(e)) as LearnerEvent);
    return new Promise((resolve, reject) => {
      const tx = db.transaction('events', 'readwrite');
      const store = tx.objectStore('events');
      store.clear();
      for (const event of clonedEvents) {
        store.add(event);
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  }

  async getMeta<T>(key: string): Promise<T | null> {
    const db = await this.getDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('meta', 'readonly');
      const store = tx.objectStore('meta');
      const req = store.get(key);
      req.onsuccess = () => {
        const val = req.result;
        resolve(val !== undefined ? (val as T) : null);
      };
      req.onerror = () => reject(req.error);
    });
  }

  async setMeta<T>(key: string, value: T): Promise<void> {
    const db = await this.getDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('meta', 'readwrite');
      const store = tx.objectStore('meta');
      store.put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  }

  async deleteMeta(key: string): Promise<void> {
    const db = await this.getDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('meta', 'readwrite');
      const store = tx.objectStore('meta');
      store.delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  }

  async clearAll(): Promise<void> {
    const db = await this.getDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(['events', 'meta'], 'readwrite');
      tx.objectStore('events').clear();
      tx.objectStore('meta').clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  }

  close(): void {
    if (this.dbPromise) {
      this.dbPromise.then(db => db.close()).catch(() => {});
      this.dbPromise = null;
    }
  }
}
