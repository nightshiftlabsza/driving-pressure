import * as fs from 'node:fs';
import * as path from 'node:path';
import { validatePracticePack } from '../src/practice/validate';

const privateDir = path.resolve(process.cwd(), 'src/practice/private');

if (!fs.existsSync(privateDir)) {
  console.log('No private practice folder found at src/practice/private. (Personal practice pack not installed)');
  process.exit(0);
}

const files = fs.readdirSync(privateDir).filter(f => f.endsWith('.json'));

if (files.length === 0) {
  console.log('No practice item JSON files found in src/practice/private.');
  process.exit(0);
}

let totalValid = 0;
let hasError = false;

console.log(`Checking practice item files in ${privateDir}...`);

for (const f of files) {
  const filePath = path.join(privateDir, f);
  try {
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    const items = Array.isArray(raw) ? raw : (raw.items ?? []);
    const { validCount, errors } = validatePracticePack(items);
    if (errors.length > 0) {
      hasError = true;
      console.error(`FAIL: ${f} has ${errors.length} errors:`);
      for (const err of errors.slice(0, 5)) {
        console.error(`  - item [${err.id ?? err.index}]: ${err.error}`);
      }
      if (errors.length > 5) {
        console.error(`  ... and ${errors.length - 5} more errors`);
      }
    } else {
      console.log(`OK:   ${f} (${validCount} items valid)`);
      totalValid += validCount;
    }
  } catch (err: any) {
    hasError = true;
    console.error(`ERROR reading ${f}: ${err.message}`);
  }
}

console.log(`\nPractice validation summary: ${totalValid} total items valid across ${files.length} files.`);

if (hasError) {
  process.exit(1);
} else {
  process.exit(0);
}
