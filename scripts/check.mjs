// Syntax-check every API handler before deploy.
// Vercel does NOT syntax-check serverless functions: a broken handler ships
// clean and crashes on first request as FUNCTION_INVOCATION_FAILED. Run this
// (npm run check) before every `npm run deploy`.
import { readdirSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let failed = 0;
let checked = 0;

// 1. Every API handler via `node --check`.
try {
  const apiDir = join(root, 'api');
  for (const f of readdirSync(apiDir).filter((f) => f.endsWith('.js'))) {
    checked++;
    try {
      execFileSync(process.execPath, ['--check', join(apiDir, f)], { stdio: 'pipe' });
      console.log(`ok   api/${f}`);
    } catch (err) {
      failed++;
      console.error(`FAIL api/${f}`);
      console.error(err.stderr?.toString() || err.message);
    }
  }
} catch { console.log('No api/ directory yet.'); }

// 2. Inline <script> blocks (without src=) in public/*.html.
// new Function() compiles without executing, so it surfaces syntax errors only.
try {
  const pubDir = join(root, 'public');
  const re = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi;
  for (const f of readdirSync(pubDir).filter((f) => f.endsWith('.html'))) {
    const html = readFileSync(join(pubDir, f), 'utf8');
    let m, idx = 0, fileOk = true;
    while ((m = re.exec(html)) !== null) {
      const code = m[1].trim();
      if (!code) continue;
      idx++;
      checked++;
      try { new Function(code); }
      catch (err) { failed++; fileOk = false; console.error(`FAIL public/${f} (script #${idx}): ${err.message}`); }
    }
    if (fileOk && idx) console.log(`ok   public/${f} (${idx} inline script${idx > 1 ? 's' : ''})`);
  }
} catch { /* no public dir */ }

if (failed) {
  console.error(`\n${failed} check(s) failed.`);
  process.exit(1);
}
console.log(`\nAll ${checked} check(s) passed.`);
