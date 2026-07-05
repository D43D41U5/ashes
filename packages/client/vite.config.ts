import { defineConfig } from 'vite'

export default defineConfig({
  server: { port: 3000 },
  build: {
    outDir: 'dist',
    rollupOptions: {
      output: {
        // Capital Manif : isoler le chunk Phaser (~2 Mo) pour la stabilité du cache.
        manualChunks: { phaser: ['phaser'] },
      },
    },
  },
})
