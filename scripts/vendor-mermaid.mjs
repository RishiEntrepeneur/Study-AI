#!/usr/bin/env node
/**
 * Copies Mermaid's prebuilt browser bundle into public/vendor so the app can
 * load it at runtime instead of bundling it.
 *
 * Why: Mermaid is enormous (its ELK layout chunk alone exhausts the bundler's
 * memory on smaller machines), and it only runs in the browser anyway. Serving
 * the ready-made file keeps builds fast and light while staying self-hosted.
 *
 * Runs automatically on `npm install`, `npm run dev` and `npm run build`.
 */
import { copyFileSync, mkdirSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = require.resolve("mermaid/dist/mermaid.min.js");
const targetDir = join(root, "public", "vendor");
const target = join(targetDir, "mermaid.min.js");

mkdirSync(targetDir, { recursive: true });
copyFileSync(source, target);
console.log(`[vendor-mermaid] copied mermaid.min.js (${(statSync(target).size / 1e6).toFixed(1)} MB) to public/vendor/`);
