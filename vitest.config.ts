import { defineConfig } from 'vitest/config'

// Standalone from vite.config.ts on purpose: the app's Vite config wires in
// vite-plugin-pwa and React, neither of which the scoring module (pure
// computation, no I/O, no React) needs for its tests. Reusing Vite's
// transform pipeline for TypeScript is the point of choosing Vitest at all;
// pulling in the PWA plugin's manifest/service-worker generation is not.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
