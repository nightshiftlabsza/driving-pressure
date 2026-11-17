import fs from 'fs';
import path from 'path';

function checkBundleKeys() {
  const envPath = path.resolve(process.cwd(), '.env.local');
  if (!fs.existsSync(envPath)) {
    console.log('No .env.local file found');
    return;
  }

  const envContent = fs.readFileSync(envPath, 'utf8');
  const geminiMatch = envContent.match(/GEMINI_API_KEY\s*=\s*([^\r\n]+)/);
  const groqMatch = envContent.match(/GROQ_API_KEY\s*=\s*([^\r\n]+)/);

  const geminiKey = geminiMatch ? geminiMatch[1].trim() : '';
  const groqKey = groqMatch ? groqMatch[1].trim() : '';

  const distDir = path.resolve(process.cwd(), 'dist');
  if (!fs.existsSync(distDir)) {
    console.log('dist directory not found');
    return;
  }

  function scanDir(dir: string): string[] {
    let files: string[] = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        files = files.concat(scanDir(full));
      } else {
        files.push(full);
      }
    }
    return files;
  }

  const allFiles = scanDir(distDir);
  let geminiInDist = false;
  let groqInDist = false;

  for (const f of allFiles) {
    const content = fs.readFileSync(f, 'utf8');
    if (geminiKey && geminiKey.length > 5 && content.includes(geminiKey)) {
      geminiInDist = true;
    }
    if (groqKey && groqKey.length > 5 && content.includes(groqKey)) {
      groqInDist = true;
    }
  }

  console.log('GEMINI_API_KEY in dist/:', geminiInDist ? 'found' : 'not found');
  console.log('GROQ_API_KEY in dist/:', groqInDist ? 'found' : 'not found');

  // Also check git committed files and logs
  const usageLog = path.resolve(process.cwd(), '.tutor-data/usage.jsonl');
  if (fs.existsSync(usageLog)) {
    const logContent = fs.readFileSync(usageLog, 'utf8');
    const geminiInLog = geminiKey && geminiKey.length > 5 && logContent.includes(geminiKey);
    const groqInLog = groqKey && groqKey.length > 5 && logContent.includes(groqKey);
    console.log('GEMINI_API_KEY in usage.jsonl:', geminiInLog ? 'found' : 'not found');
    console.log('GROQ_API_KEY in usage.jsonl:', groqInLog ? 'found' : 'not found');
  }
}

checkBundleKeys();
