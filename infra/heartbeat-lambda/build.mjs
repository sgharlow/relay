// Bundles handler.ts (and the lib/ops modules it imports) into dist/index.mjs for nodejs22.x.
// The AWS SDK clients are bundled, not taken from the runtime, so what runs is what package-lock pins.
import { build } from 'esbuild';

await build({
  entryPoints: ['handler.ts'],
  outfile: 'dist/index.mjs',
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  minify: false,
  sourcemap: false,
  legalComments: 'none',
  // ESM bundles of CJS deps need a require() shim.
  banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
});
console.log('built dist/index.mjs');
