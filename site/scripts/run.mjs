// Runs a TypeScript script of the site with Vite's module runner, which compiles it on the fly:
// `node site/scripts/run.mjs site/scripts/check-code.ts [arguments]`. The script exports
// `main(args)`, which returns the exit code.
import { resolve } from 'node:path';
import { runnerImport } from 'vite';

const [script, ...args] = process.argv.slice(2);

if (!script) {
  console.error('Usage: node site/scripts/run.mjs <script.ts> [arguments]');
  process.exit(2);
}

const { module } = await runnerImport(resolve(script), { configFile: false, logLevel: 'error' });
process.exitCode = await module.main(args);
