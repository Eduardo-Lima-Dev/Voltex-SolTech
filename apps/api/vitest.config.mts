import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { include: ['src/**/*.test.ts'], environment: 'node' },
  // SWC emite os metadados de decorators que o Nest precisa para injeção de dependência.
  plugins: [swc.vite({ module: { type: 'es6' } })],
});
