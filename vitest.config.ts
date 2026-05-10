import { defineConfig } from 'vitest/config';
import { transformWithEsbuild } from 'vite';

export default defineConfig({
  plugins: [
    {
      name: 'esbuild-ts-decorator-transform',
      enforce: 'pre',
      async transform(code: string, id: string) {
        if (!id.endsWith('.ts')) return null;
        return transformWithEsbuild(code, id, { target: 'es2023', loader: 'ts' });
      },
    },
  ],
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
