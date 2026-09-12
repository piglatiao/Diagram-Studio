/** L5 · 本地持久化（IndexedDB 优先，不可用时降级到 localStorage / 内存） */
import type { Lang } from '../render';

export interface DocRow {
  id: string;
  title: string;
  lang: Lang;
  source: string;
  createdAt: number;
  updatedAt: number;
}

const LS_KEY = 'diagram-studio/docs';
let dexieDb: any = null;

async function getDb(): Promise<any | null> {
  if (dexieDb !== null) return dexieDb;
  try {
    const mod: any = await import('dexie');
    const Dexie = mod.default ?? mod.Dexie;
    const d = new Dexie('diagram-studio');
    d.version(1).stores({ docs: 'id, updatedAt' });
    await d.open();
    dexieDb = d;
  } catch {
    dexieDb = false;
  }
  return dexieDb === false ? null : dexieDb;
}

function readLs(): DocRow[] {
  try {
    return JSON.parse(localStorage.getItem(LS_KEY) ?? '[]') as DocRow[];
  } catch {
    return [];
  }
}
function writeLs(rows: DocRow[]) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(rows));
  } catch {
    /* 忽略配额错误 */
  }
}

export const storage = {
  async list(): Promise<DocRow[]> {
    const db = await getDb();
    if (db) {
      try {
        const rows = (await db.docs.toArray()) as DocRow[];
        return rows.sort((a, b) => b.updatedAt - a.updatedAt);
      } catch {
        /* fallthrough */
      }
    }
    return readLs().sort((a, b) => b.updatedAt - a.updatedAt);
  },

  async put(doc: DocRow): Promise<void> {
    const db = await getDb();
    if (db) {
      try { await db.docs.put(doc); return; } catch { /* fallthrough */ }
    }
    const rows = readLs().filter((r) => r.id !== doc.id);
    rows.push(doc);
    writeLs(rows);
  },

  async remove(id: string): Promise<void> {
    const db = await getDb();
    if (db) {
      try { await db.docs.delete(id); return; } catch { /* fallthrough */ }
    }
    writeLs(readLs().filter((r) => r.id !== id));
  },
};

export function newDocId(): string {
  return `d${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}
