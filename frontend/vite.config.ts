import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import AutoImport from 'unplugin-auto-import/vite'
import Components from 'unplugin-vue-components/vite'
import { ElementPlusResolver } from 'unplugin-vue-components/resolvers'
import path from 'node:path'
import sqlApi from './server/sqlApi.mjs'

export default defineConfig({
  plugins: [
    // SQL API 插件必须先注册，拦截 /api/sql/* 不让 proxy 转给现场检测后端
    sqlApi(),
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
      // 现场检测后端（src.20270721）：HTTPS + 自签证书
      //  - 前端用 /api/* 同源访问，避免浏览器 CORS + 证书警告
      //  - secure: false 跳过上游证书校验（自签证书场景）
      //  - changeOrigin: true 让后端看到正确的 Host header
      //  - SQL 路由 /api/sql/* 已被 sqlApi 插件拦截，不会走到这里
      '/api': {
        target: 'https://192.168.20.40:3000',
        changeOrigin: true,
        secure: false,
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
