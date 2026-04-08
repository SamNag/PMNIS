import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { wozPlugin } from './vite-woz-plugin'

// https://vite.dev/config/
export default defineConfig({
  plugins: [vue(), wozPlugin()],
})
