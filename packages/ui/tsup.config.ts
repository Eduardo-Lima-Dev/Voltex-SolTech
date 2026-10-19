import { defineConfig } from 'tsup';

export default defineConfig((options) => ({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  // Em watch não limpa o dist: o build inicial do Turborepo pode estar escrevendo ao mesmo tempo.
  clean: !options.watch,
  sourcemap: true,
  target: 'es2023',
  external: ['react', 'react-dom', 'react-hook-form'],
}));
