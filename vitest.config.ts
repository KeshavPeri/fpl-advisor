import { defineConfig } from 'vitest/config'

// Standalone from vite.config.ts on purpose: the app's Vite config wires in
// vite-plugin-pwa and React, neither of which the scoring module (pure
// computation, no I/O, no React) needs for its tests. Reusing Vite's
// transform pipeline for TypeScript is the point of choosing Vitest at all;
// pulling in the PWA plugin's manifest/service-worker generation is not.
//
// scripts/**/*.test.ts added by ticket #14: scripts/sync-squad.ts's parsing
// and reconciliation functions are pure Node computation, same shape as the
// scoring module — no reason to stand up a second Vitest config for them.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'scripts/**/*.test.ts'],
  },
})
