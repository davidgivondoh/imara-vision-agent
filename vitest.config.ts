import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
    },
  },
  resolve: {
    alias: {
      '@core': './src/core',
      '@inference': './src/inference',
      '@plugins': './src/plugins',
      '@engine': './src/engine',
      '@desktop': './src/desktop',
      '@products': './src/products',
      '@shared': './src/shared',
    },
  },
})
