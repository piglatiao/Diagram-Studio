/**
 * L5 · 本地文件夹工作区
 *
 * 首选 File System Access API（可读写、句柄可持久化到 IndexedDB）；
 * 不支持的浏览器退化到 <input webkitdirectory>（只读，保存在本地库）。
 */
import type { Lang } from '../render';
import { detectLanguage } from '../render';
import { downloadText } from './io';
import { dedupeName, extOf } from './naming';

export const DIAGRAM_EXT = ['.mmd', '.mermaid', '.puml', '.plantuml', '.dot', '.gv', '.dflow', '.flow.json', '.txt', '.md'];

/** 流程图文档（可视化绘制）的扩展名 */
export const FLOW_EXT = ['.dflow', '.flow.json'];

const IGNORE_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', 'out', '.next', '.nuxt', '.vscode', '.idea',
  'coverage', '__pycache__', '.cache', 'target', 'vendor', '.svn', '.hg',
]);

export interface FsNode {
  kind: 'dir' | 'file';
  name: string;
  /** 相对于根目录的路径，根为 '' */
  path: string;
  children?: FsNode[];
  loaded?: boolean;
  /** 目录句柄 / 文件句柄 / 兜底模式下的 File 对象 */
  h?: unknown;
}

export function isDiagram(name: string): boolean {
  const lower = name.toLowerCase();
  return DIAGRAM_EXT.some((e) => lower.endsWith(e));
}

export function langOfFile(name: string, text: string): Lang {
  const lower = name.toLowerCase();
  if (FLOW_EXT.some((e) => lower.endsWith(e))) return 'flow';
  if (lower.endsWith('.puml') || lower.endsWith('.plantuml')) return 'plantuml';
  if (lower.endsWith('.mmd') || lower.endsWith('.mermaid')) return 'mermaid';
  return detectLanguage(text);
}

export { extOf, stripExt, withExt, suggestFileName, dedupeName } from './naming';

const cmp = (a: FsNode, b: FsNode) =>
  a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === 'dir' ? -1 : 1;

/** TS 的 lib.dom 尚未收录 FileSystemDirectoryHandle.values()，这里补一个最小结构 */
interface DirLike {
  values?: () => AsyncIterableIterator<{ name: string; kind: string }>;
}

/** 惰性展开目录（大仓库不会一次性扫完） */
export async function readDir(node: FsNode): Promise<FsNode[]> {
  const h = node.h as (FileSystemDirectoryHandle & DirLike) | undefined;
  if (!h || typeof h.values !== 'function') {
    node.loaded = true;
    return node.children ?? [];
  }
  const out: FsNode[] = [];
  try {
    for await (const entry of h.values()) {
      const p = node.path ? `${node.path}/${entry.name}` : entry.name;
      if (entry.kind === 'directory') {
        if (IGNORE_DIRS.has(entry.name)) continue;
        out.push({ kind: 'dir', name: entry.name, path: p, loaded: false, h: entry });
      } else if (entry.kind === 'file' && isDiagram(entry.name)) {
        out.push({ kind: 'file', name: entry.name, path: p, h: entry });
      }
    }
  } catch {
    /* 权限或读取失败时静默降级为空目录 */
  }
  out.sort(cmp);
  node.children = out;
  node.loaded = true;
  return out;
}

export async function pickDirectory(): Promise<FsNode | null> {
  if (typeof window !== 'undefined' && window.showDirectoryPicker) {
    try {
      const h = await window.showDirectoryPicker({ id: 'ds-workspace', mode: 'readwrite' });
      const root: FsNode = { kind: 'dir', name: h.name, path: '', loaded: false, h };
      await saveHandle(h);
      return root;
    } catch {
      return null;
    }
  }
  return pickDirectoryFallback();
}

/** 兜底：webkitdirectory，只给 File 对象，读得到但写不回 */
export function pickDirectoryFallback(): Promise<FsNode | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    (input as unknown as { webkitdirectory?: boolean }).webkitdirectory = true;
    input.onchange = () => {
      const files = Array.from(input.files ?? []).filter((f) => isDiagram(f.name));
      if (!files.length) {
        resolve(null);
        return;
      }
      resolve(buildTreeFromFiles(files));
    };
    input.click();
  });
}

function buildTreeFromFiles(files: File[]): FsNode {
  const rootName = ((files[0] as unknown as { webkitRelativePath?: string }).webkitRelativePath ?? '')
    .split('/')[0] || '文件夹';
  const root: FsNode = { kind: 'dir', name: rootName, path: '', loaded: true, children: [] };
  for (const f of files) {
    const rel = (f as unknown as { webkitRelativePath?: string }).webkitRelativePath ?? f.name;
    const parts = rel.split('/').slice(1); // 去掉根目录名
    let cur = root;
    let path = '';
    for (let i = 0; i < parts.length; i++) {
      path = path ? `${path}/${parts[i]}` : parts[i];
      const isFile = i === parts.length - 1;
      cur.children = cur.children ?? [];
      let next = cur.children.find((c) => c.name === parts[i]);
      if (!next) {
        next = { kind: isFile ? 'file' : 'dir', name: parts[i], path, loaded: !isFile, children: isFile ? undefined : [], h: isFile ? f : undefined };
        cur.children.push(next);
      }
      cur = next;
    }
  }
  const sortRec = (n: FsNode) => {
    if (!n.children) return;
    n.children.sort(cmp);
    n.children.forEach(sortRec);
  };
  sortRec(root);
  return root;
}

export async function readText(node: FsNode): Promise<string> {
  const h = node.h;
  if (!h) return '';
  if (typeof (h as File).text === 'function') return (h as File).text();
  const fh = h as FileSystemFileHandle;
  const f = await fh.getFile();
  return f.text();
}

/** 写回磁盘；返回 false 表示当前环境不支持（兜底模式） */
export async function writeText(node: FsNode, text: string): Promise<boolean> {
  return writeHandle(node.h as FileSystemFileHandle | undefined, text);
}

async function writeHandle(h: FileSystemFileHandle | undefined, text: string): Promise<boolean> {
  if (!h || typeof (h as unknown as { createWritable?: unknown }).createWritable !== 'function') return false;
  const ok = await ensurePermission(h, 'readwrite');
  if (!ok) return false;
  const w = await h.createWritable();
  await w.write(text);
  await w.close();
  return true;
}

function isAbort(e: unknown): boolean {
  return !!e && typeof e === 'object' && (e as { name?: string }).name === 'AbortError';
}

async function uniqueName(dir: FsNode, name: string): Promise<string> {
  if (!dir.loaded) await readDir(dir);
  return dedupeName(name, new Set((dir.children ?? []).map((c) => c.name)));
}

/**
 * 在已挂载的目录下新建文件并写入初始内容。
 * 返回新节点（已挂进 dir.children）；目录不可写时返回 null。
 */
export async function createFileInDir(dir: FsNode, name: string, content: string): Promise<FsNode | null> {
  const h = dir.h as
    | (FileSystemDirectoryHandle & {
        getFileHandle?: (n: string, o?: { create?: boolean }) => Promise<FileSystemFileHandle>;
      })
    | undefined;
  if (!h || typeof h.getFileHandle !== 'function') return null;
  const ok = await ensurePermission(h, 'readwrite');
  if (!ok) return null;

  const finalName = await uniqueName(dir, name);
  const fh = await h.getFileHandle(finalName, { create: true });
  if (!(await writeHandle(fh, content))) return null;

  const path = dir.path ? `${dir.path}/${finalName}` : finalName;
  const node: FsNode = { kind: 'file', name: finalName, path, h: fh };
  dir.children = dir.children ?? [];
  dir.children.push(node);
  dir.children.sort(cmp);
  return node;
}

export type SaveOutcome = 'file' | 'download' | 'cancel';

/**
 * 「另存为」：让用户在弹窗里挑保存位置（体验等同下载）。
 * 三级降级：原生另存为对话框 → 选文件夹 + 建议文件名 → 浏览器下载。
 */
export async function pickSaveFile(
  suggestedName: string,
  content: string,
): Promise<{ outcome: SaveOutcome; node: FsNode | null }> {
  const ext = extOf(suggestedName) || '.mmd';

  // 1) 原生另存为对话框（能直接导航到任意文件夹 + 改文件名）
  if (typeof window !== 'undefined' && window.showSaveFilePicker) {
    try {
      const fh = await window.showSaveFilePicker({
        id: 'ds-save',
        suggestedName,
        types: [{ description: '图表源码', accept: { 'text/plain': [`*${ext}`] } }],
      });
      if (await writeHandle(fh, content)) {
        return { outcome: 'file', node: { kind: 'file', name: fh.name, path: fh.name, h: fh } };
      }
    } catch (e) {
      if (isAbort(e)) return { outcome: 'cancel', node: null };
      /* 其他错误继续降级 */
    }
  }

  // 2) 选文件夹，用建议文件名建文件
  if (typeof window !== 'undefined' && window.showDirectoryPicker) {
    try {
      const dh = await window.showDirectoryPicker({ id: 'ds-save-dir', mode: 'readwrite' });
      const dir: FsNode = { kind: 'dir', name: dh.name, path: '', loaded: false, h: dh };
      const node = await createFileInDir(dir, suggestedName, content);
      if (node) return { outcome: 'file', node };
    } catch (e) {
      if (isAbort(e)) return { outcome: 'cancel', node: null };
    }
  }

  // 3) 浏览器下载
  downloadText(content, suggestedName);
  return { outcome: 'download', node: null };
}

export async function ensurePermission(
  h: unknown,
  mode: 'read' | 'readwrite'
): Promise<boolean> {
  const anyH = h as {
    queryPermission?: (d?: { mode?: string }) => Promise<string>;
    requestPermission?: (d?: { mode?: string }) => Promise<string>;
  };
  if (typeof anyH.queryPermission !== 'function') return true;
  const q = await anyH.queryPermission({ mode });
  if (q === 'granted') return true;
  if (q === 'denied') return false;
  if (typeof anyH.requestPermission !== 'function') return false;
  return (await anyH.requestPermission({ mode })) === 'granted';
}

// ---------------------------------------------------------------- 句柄持久化（独立 IndexedDB）

const IDB_NAME = 'ds-fs';
const STORE = 'handles';

function openFsDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(IDB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

export async function saveHandle(h: FileSystemDirectoryHandle): Promise<void> {
  const db = await openFsDb();
  if (!db) return;
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(h, 'root');
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    } catch {
      resolve();
    }
  });
  db.close();
}

export async function loadHandle(): Promise<FileSystemDirectoryHandle | null> {
  const db = await openFsDb();
  if (!db) return null;
  const h = await new Promise<FileSystemDirectoryHandle | null>((resolve) => {
    try {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get('root');
      req.onsuccess = () => resolve((req.result as FileSystemDirectoryHandle) ?? null);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  db.close();
  return h;
}

export async function clearHandle(): Promise<void> {
  const db = await openFsDb();
  if (!db) return;
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete('root');
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
  db.close();
}
