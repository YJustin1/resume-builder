// Tests run from the project root. Without this file Vitest would load
// vite.config.ts, whose root is src/client (the UI build).
//
// Many test files launch Chrome, Vite or child servers; running one per core
// oversubscribed a 10-core machine (load average ~49) and made timing-bounded
// tests (print timeouts, startup waits) flaky. Half the cores, at most 4.
import { availableParallelism } from 'node:os';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    maxWorkers: Math.max(1, Math.min(4, Math.floor(availableParallelism() / 2))),
    // Generous defaults for process- and browser-level tests on a busy machine.
    // D20's own tests pass explicit short timeouts, so they still check the bound.
    testTimeout: 30_000,
    env: { RB_PRINT_TIMEOUT_MS: '60000' },
  },
});
