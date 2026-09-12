import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';

// 纯本地工具：产出单个自包含 index.html，双击即可离线使用，无任何外网请求。
export default defineConfig({
  base: './',
  plugins: [react(), viteSingleFile()],
  optimizeDeps: {
    include: ['mermaid', 'elkjs/lib/elk.bundled.js'],
  },
  build: {
    target: 'es2020',
    // 单文件产物体积大，压缩阶段的内存峰值过高；本地工具不需要压缩
    minify: false,
    chunkSizeWarningLimit: 8000,
    assetsInlineLimit: 100 * 1024 * 1024,
    cssCodeSplit: false,
    reportCompressedSize: false,
  },
});
