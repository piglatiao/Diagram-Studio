// Electron preload（编译到 dist-electron/preload.js）
// 通过 contextBridge 把受限的原生能力暴露给渲染进程。
import { contextBridge, ipcRenderer } from 'electron';

export type AppInfo = {
  version: string;
  electron: string;
  node: string;
  chrome: string;
  platform: NodeJS.Platform;
  arch: string;
};

const api = {
  /** 获取应用信息(版本/平台等) */
  getInfo(): Promise<AppInfo> {
    return ipcRenderer.invoke('app:get-info');
  },
  /** 订阅主进程菜单事件(channel = 'menu:new' | 'menu:export') */
  onMenu(channel: 'new' | 'export', cb: () => void): () => void {
    const ch = `menu:${channel}`;
    const handler = () => cb();
    ipcRenderer.on(ch, handler);
    return () => ipcRenderer.removeListener(ch, handler);
  },
};

contextBridge.exposeInMainWorld('diagramStudio', api);

export type DiagramStudioApi = typeof api;
