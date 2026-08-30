import { fileURLToPath } from 'url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'happy-dom',
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    // Run as the deployed container does — UTC — not as the developer's machine
    // does. On a Tehran-local host the Jalali formatter's `Asia/Tehran` pin is
    // invisible: its tests pass even when the pin is removed.
    env: { TZ: 'UTC' },
  },
});
