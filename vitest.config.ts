// Tests run from the project root. Without this file Vitest would load
// vite.config.ts, whose root is src/client (the UI build).
import { defineConfig } from 'vitest/config';

export default defineConfig({ test: { include: ['tests/**/*.test.ts'] } });
