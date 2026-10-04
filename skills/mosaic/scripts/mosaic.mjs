#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
const bundled = new URL('../assets/runtime/tools/cli.mjs', import.meta.url);
const checkout = new URL('../../../tools/cli.mjs', import.meta.url);
const entry = existsSync(bundled) ? bundled : checkout;
if (!existsSync(entry)) throw new Error('Runtime missing. Install the complete mosaic skill bundle or run npm run build in its repository.');
process.argv[1] = fileURLToPath(entry);
await import(pathToFileURL(process.argv[1]).href);
