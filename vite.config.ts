import { cpSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { defineConfig, type Plugin } from 'vite';

const require = createRequire(import.meta.url);
const pdfjsRoot = dirname(dirname(require.resolve('pdfjs-dist')));
const pdfjsAssetDirectories = ['cmaps', 'standard_fonts', 'iccs', 'wasm'];

function copyPdfJsAssets(): Plugin {
  return {
    name: 'copy-pdfjs-assets',
    buildStart() {
      const targetRoot = join(process.cwd(), 'public', 'pdfjs');
      mkdirSync(targetRoot, { recursive: true });

      for (const directory of pdfjsAssetDirectories) {
        cpSync(join(pdfjsRoot, directory), join(targetRoot, directory), {
          recursive: true,
          force: true,
        });
      }
    },
  };
}

export default defineConfig({
  // Relative URLs make both `vite preview` and a repository GitHub Pages URL work.
  base: './',
  plugins: [copyPdfJsAssets()],
  build: {
    target: 'es2022',
    sourcemap: true,
  },
});
