import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],

  // 开发服务器配置
  server: {
    port: 5173,
    host: "localhost",
    strictPort: true,
    cors: true,
  },

  // 构建配置
  build: {
    outDir: "dist",
    assetsDir: "assets",
    sourcemap: process.env.NODE_ENV === "development",
    minify: "esbuild",
    target: "chrome120", // Electron使用的Chrome版本
    rollupOptions: {
      input: {
        main: path.resolve(__dirname, "index.html"),
        history: path.resolve(__dirname, "history.html"),
        settings: path.resolve(__dirname, "settings.html"),
      },
      output: {
        manualChunks: {
          vendor: ["react", "react-dom"],
          utils: ["clsx", "tailwind-merge", "class-variance-authority"],
        },
      },
    },
    // 优化配置
    chunkSizeWarningLimit: 1000,
  },

  // [20260815_Refactor_DepsLean] Removed the unused "@/..." alias map (zero
  // importers in src/), the explicit postcss path that pointed at a
  // nonexistent ../postcss.config.js — Vite auto-discovers the real
  // postcss.config.ts at the repo root — and the scss preprocessorOptions
  // block referencing a src/styles/ directory that does not exist.

  // 环境变量配置
  envPrefix: ["VITE_", "ELECTRON_"],

  // CSS配置
  css: {
    devSourcemap: true,
  },

  // 优化依赖
  optimizeDeps: {
    include: ["react", "react-dom", "lucide-react", "@radix-ui/react-slot"],
    exclude: ["electron"],
  },

  // 定义全局常量
  define: {
    __APP_VERSION__: JSON.stringify(process.env.npm_package_version || "1.0.0"),
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
    __DEV__: process.env.NODE_ENV === "development",
  },

  // 基础路径配置
  base: "./",

  // 公共目录
  publicDir: "../assets",

  // 清除控制台
  clearScreen: false,

  // 日志级别
  logLevel: "info",

  // 预览配置
  preview: {
    port: 4173,
    host: "localhost",
    strictPort: true,
  },
});
