import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import AutoImport from 'unplugin-auto-import/vite'
import Components from 'unplugin-vue-components/vite'
import { ElementPlusResolver } from 'unplugin-vue-components/resolvers'
import path from 'node:path'

export default defineConfig({
  plugins: [
    vue(),
    AutoImport({ resolvers: [ElementPlusResolver()] }),
    Components({ resolvers: [ElementPlusResolver()] }),
  ],
  resolve: {
    alias: { '@': path.resolve(__dirname, 'src') },
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
    // 不 watch 用户数据和内置演示照片（避免 Windows 文件锁导致 Vite EBUSY）
    watch: {
      ignored: [
        '**/pipe data/**',
        '**/pipe_data/**',
        '**/public/data/demo/soil/*.jpg',
        '**/public/data/demo/dc-stray/*.jpg',
      ],
    },
    proxy: {
      // 后端联调时配置：所有 /api/* 请求代理到后端服务
      // 后端跑起来后改这里即可
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
  build: {
    target: 'es2020',
    outDir: 'dist',
    sourcemap: false,
    chunkSizeWarningLimit: 1500,
  },
})
