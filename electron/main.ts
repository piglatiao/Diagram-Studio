// Electron 主进程入口（编译到 dist-electron/main.js，CommonJS）
// 作用：装载打包好的 dist/index.html（vite single-file 11MB+），提供应用窗口、菜单、IPC。
import { app, BrowserWindow, Menu, type MenuItemConstructorOptions, ipcMain, dialog, shell } from 'electron';
import { writeFileSync } from 'node:fs';
import path from 'node:path';

let mainWindow: BrowserWindow | null = null;

// dist-electron/main.cjs 与 dist/index.html 同级,都位于 app 根
const INDEX_HTML = path.join(__dirname, '..', 'dist', 'index.html');
const PRELOAD_JS = path.join(__dirname, 'preload.cjs');

// 启动自检:设置 DS_SMOKE_OUT 后,窗口加载完页面就把 DOM 探针结果写进该文件并退出。
// 用于打包后验证「exe 能起来 + 渲染层真的挂载了」,不弹窗、不需人工看。
const SMOKE_OUT = process.env.DS_SMOKE_OUT ?? '';

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    title: 'Diagram Studio',
    backgroundColor: '#ffffff',
    show: false,
    autoHideMenuBar: false,
    webPreferences: {
      preload: PRELOAD_JS,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.once('ready-to-show', () => {
    // 自检模式不弹窗
    if (!SMOKE_OUT) mainWindow?.show();
  });

  // 阻止外链打开新窗口,统一走系统浏览器
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  // 阻止内嵌导航(主页面是 file://，不应该 navigate 到其它地方)
  mainWindow.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('file://')) {
      e.preventDefault();
      if (url.startsWith('http://') || url.startsWith('https://')) {
        shell.openExternal(url);
      }
    }
  });

  void mainWindow.loadFile(INDEX_HTML);
}

function buildMenu(): void {
  const isMac = process.platform === 'darwin';
  const send = (channel: string) => () => mainWindow?.webContents.send(channel);

  const template: MenuItemConstructorOptions[] = [
    ...(isMac ? [{ role: 'appMenu' as const }] : []),
    {
      label: '文件(&F)',
      submenu: [
        { label: '新建画布', accelerator: 'CmdOrCtrl+N', click: send('menu:new') },
        { type: 'separator' },
        { label: '导出 SVG…', accelerator: 'CmdOrCtrl+E', click: send('menu:export') },
        { type: 'separator' },
        isMac ? { role: 'close', label: '关闭窗口' } : { role: 'quit', label: '退出' },
      ],
    },
    {
      label: '编辑(&E)',
      submenu: [
        { role: 'undo', label: '撤销' },
        { role: 'redo', label: '重做' },
        { type: 'separator' },
        { role: 'cut', label: '剪切' },
        { role: 'copy', label: '复制' },
        { role: 'paste', label: '粘贴' },
        { role: 'selectAll', label: '全选' },
      ],
    },
    {
      label: '视图(&V)',
      submenu: [
        { role: 'reload', label: '重新加载' },
        { role: 'forceReload', label: '强制重载' },
        { role: 'toggleDevTools', label: '开发者工具' },
        { type: 'separator' },
        { role: 'resetZoom', label: '重置缩放' },
        { role: 'zoomIn', label: '放大' },
        { role: 'zoomOut', label: '缩小' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: '全屏' },
      ],
    },
    {
      label: '帮助(&H)',
      submenu: [
        {
          label: '关于 Diagram Studio',
          click: async () => {
            if (!mainWindow) return;
            await dialog.showMessageBox(mainWindow, {
              type: 'info',
              title: '关于 Diagram Studio',
              message: 'Diagram Studio',
              detail:
                '纯本地绘图工作台(Mermaid + PlantUML 本地渲染)\n' +
                `版本 ${app.getVersion()}\n` +
                `Electron ${process.versions.electron}\n` +
                `Node ${process.versions.node}\n` +
                `Chrome ${process.versions.chrome}`,
            });
          },
        },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// —— IPC —— 占位:前端可通过 window.diagramStudio.* 访问
ipcMain.handle('app:get-info', () => ({
  version: app.getVersion(),
  electron: process.versions.electron,
  node: process.versions.node,
  chrome: process.versions.chrome,
  platform: process.platform,
  arch: process.arch,
}));

// —— 启动自检 ——
function runSmoke(): void {
  const w = mainWindow;
  if (!w || !SMOKE_OUT) {
    app.exit(9);
    return;
  }
  const dump = (obj: unknown): void => {
    try {
      writeFileSync(SMOKE_OUT, JSON.stringify(obj, null, 2), 'utf-8');
    } catch {
      /* ignore */
    }
  };
  const timer = setTimeout(() => {
    dump({ ok: false, reason: 'timeout' });
    app.exit(5);
  }, 40_000);

  w.webContents.once('did-fail-load', (_e, code, desc) => {
    clearTimeout(timer);
    dump({ ok: false, reason: 'did-fail-load', code, desc });
    app.exit(4);
  });

  w.webContents.once('did-finish-load', () => {
    void (async () => {
      try {
        const probe = (await w.webContents.executeJavaScript(`
          (() => {
            const q = (s) => !!document.querySelector(s);
            const txt = (document.body && document.body.textContent) || '';
            return {
              title: document.title,
              hasApp: q('.app'),
              hasEditor: q('.cm-editor'),
              hasSvg: document.querySelectorAll('svg').length > 0,
              svgCount: document.querySelectorAll('svg').length,
              elementCount: document.querySelectorAll('*').length,
              bodyLength: document.body ? document.body.innerHTML.length : 0,
              uiMermaid: txt.includes('Mermaid'),
              uiPlantUml: txt.includes('PlantUML'),
              uiFlow: txt.includes('流程图'),
              // 关键能力：保存到磁盘 / 文件夹工作区依赖 File System Access API
              fsApi: {
                saveFilePicker: typeof window.showSaveFilePicker,
                directoryPicker: typeof window.showDirectoryPicker,
                indexedDB: typeof window.indexedDB,
                isSecureContext: window.isSecureContext,
                origin: String(window.location.origin),
              },
            };
          })()
        `)) as { hasApp: boolean; bodyLength: number; elementCount: number } | null;
        const ok = !!probe && probe.hasApp && probe.bodyLength > 2000 && probe.elementCount > 50;
        clearTimeout(timer);
        dump({ ok, probe, indexHtml: INDEX_HTML });
        app.exit(ok ? 0 : 2);
      } catch (e) {
        clearTimeout(timer);
        dump({ ok: false, reason: 'probe-error', error: String(e) });
        app.exit(3);
      }
    })();
  });
}

app.whenReady().then(() => {
  // Windows: 让任务栏/开始菜单正确归组并显示应用图标
  if (process.platform === 'win32') {
    app.setAppUserModelId('com.diagramstudio.app');
  }

  createWindow();
  buildMenu();

  if (SMOKE_OUT) runSmoke();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
