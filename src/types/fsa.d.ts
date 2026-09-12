export {};

declare global {
  interface Window {
    /** File System Access API：Chromium 系可用，其余浏览器走 webkitdirectory 兜底 */
    showDirectoryPicker?: (opts?: {
      id?: string;
      mode?: 'read' | 'readwrite';
    }) => Promise<FileSystemDirectoryHandle>;
    /** 原生「另存为」对话框：可导航到任意文件夹并改文件名，体验等同下载 */
    showSaveFilePicker?: (opts?: {
      id?: string;
      suggestedName?: string;
      types?: { description: string; accept: Record<string, string[]> }[];
      excludeAcceptAllOption?: boolean;
    }) => Promise<FileSystemFileHandle>;
  }
}
