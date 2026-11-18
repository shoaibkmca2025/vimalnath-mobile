// Builds the API for Neon Functions into deploy/function: one bundled index.mjs, plus sharp and its WebAssembly build
// (the only native-style dependency; WebAssembly runs on any Node, so no Linux binary is needed). See README.md.
import { cpSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { build } from 'esbuild';

const here = path.dirname(fileURLToPath(import.meta.url));
const server = path.join(here, '..', 'server');
const out = path.join(here, 'function');

rmSync(out, { recursive: true, force: true });
await build({
  entryPoints: [path.join(server, 'src', 'function.ts')],
  outfile: path.join(out, 'index.mjs'),
  bundle: true,
  platform: 'node',
  target: 'node24',
  format: 'esm',
  external: ['sharp'],
  // Bundled CommonJS packages (nodemailer, postgres) still call require and __dirname.
  banner: { js: "import{createRequire as ___cr}from'module';import{fileURLToPath as ___f}from'url';import{dirname as ___d}from'path';const require=___cr(import.meta.url);const __filename=___f(import.meta.url);const __dirname=___d(__filename);" },
  logLevel: 'warning',
});

for (const name of ['sharp', '@img/sharp-wasm32', '@img/colour', '@emnapi/runtime', 'tslib', 'detect-libc', 'semver']) {
  mkdirSync(path.dirname(path.join(out, 'node_modules', name)), { recursive: true });
  cpSync(path.join(server, 'node_modules', name), path.join(out, 'node_modules', name), { recursive: true });
}
console.log(`Built ${path.relative(process.cwd(), out)}: index.mjs and sharp (WebAssembly).`);
