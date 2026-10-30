import { defineConfig } from 'vitest/config'
import preact from '@preact/preset-vite'

export default defineConfig({
  plugins: [preact()],
  define: { __TEST_MODE__: 'true', __APP_VERSION__: JSON.stringify('30.10.2026 12:00 · test') },
  test: {
    environment: 'happy-dom',
    setupFiles: ['tests/setup.ts'],
    include: ['tests/unit/**/*.test.{ts,tsx}'],
    coverage: { include: ['src/core/**'], reporter: ['text-summary', 'text'] },
  },
})
