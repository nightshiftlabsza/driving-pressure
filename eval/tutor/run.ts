import fs from 'fs';
import path from 'path';
import { GeminiProvider } from '../../server/tutor/providers/gemini';
import { GroqProvider } from '../../server/tutor/providers/groq';
import { OllamaProvider } from '../../server/tutor/providers/ollama';
import type { TutorProvider } from '../../server/tutor/providers/types';
import { GEMINI_RESPONSE_SCHEMA, TUTOR_JSON_SCHEMA } from '../../server/tutor/providers/schema';
import { loadSystemPrompt } from '../../server/tutor/router';
import { validateTutorResponse } from '../../src/tutor/validate';
import type { TutorResponse } from '../../src/tutor/types';

interface EvalItem {
  id: string;
  category: string;
  clinicalContext: string;
  learnerInput: string;
  referenceGrade: string | null;
  acceptableHelpLevel: number;
  forbiddenPhrases: string[];
  keyPhysiologicalPoint: string;
  expectedMisconceptions?: string[];
}

interface EvalResultEntry {
  itemId: string;
  repeatIndex: number;
  provider: string;
  model: string;
  latencyMs: number;
  schemaValid: boolean;
  helpLevelUsed: number;
  helpLevelRespected: boolean;
  reasoningGrade: string | null;
  gradeAgreement: boolean | null;
  leakageDetected: boolean;
  leakedTerms: string[];
  rawResponse: TutorResponse | null;
  error?: string;
}

function parseArgs() {
  const args = process.argv.slice(2);
  let provider = 'groq';
  let limit = 5;
  let repeat = 1;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--provider' && args[i + 1]) {
      provider = args[++i];
    } else if (args[i] === '--limit' && args[i + 1]) {
      limit = parseInt(args[++i], 10);
    } else if (args[i] === '--repeat' && args[i + 1]) {
      repeat = parseInt(args[++i], 10);
    }
  }

  return { provider, limit, repeat };
}

function loadEnvKey(name: string): string {
  if (process.env[name]) return process.env[name]!;
  const envPath = path.resolve(process.cwd(), '.env.local');
  if (fs.existsSync(envPath)) {
    const raw = fs.readFileSync(envPath, 'utf8');
    const match = raw.match(new RegExp(`${name}\\s*=\\s*([^\\r\\n]+)`));
    if (match) return match[1].trim();
  }
  return '';
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
  const { provider: providerName, limit, repeat } = parseArgs();
  console.log(`\n======================================================`);
  console.log(`Starting Tutor Eval: Provider=${providerName}, Limit=${limit}, Repeat=${repeat}`);
  console.log(`======================================================\n`);

  const resultsDir = path.resolve(process.cwd(), 'eval/tutor/results');
  if (!fs.existsSync(resultsDir)) {
    fs.mkdirSync(resultsDir, { recursive: true });
  }

  const itemsPath = path.resolve(process.cwd(), 'eval/tutor/items.json');
  const items = JSON.parse(fs.readFileSync(itemsPath, 'utf8')) as EvalItem[];
  const selectedItems = items.slice(0, limit);

  // Initialize Provider
  let provider: TutorProvider;
  let minIntervalMs = 1000;
  const systemPrompt = loadSystemPrompt();

  if (providerName === 'gemini') {
    const key = loadEnvKey('GEMINI_API_KEY');
    if (!key) throw new Error('GEMINI_API_KEY missing in .env.local');
    provider = new GeminiProvider(key);
    minIntervalMs = 8000; // 8 requests per minute max
  } else if (providerName === 'groq') {
    const key = loadEnvKey('GROQ_API_KEY');
    if (!key) throw new Error('GROQ_API_KEY missing in .env.local');
    provider = new GroqProvider(key);
    minIntervalMs = 8000; // at most 1 every 8 seconds
  } else if (providerName === 'ollama') {
    provider = new OllamaProvider();
    minIntervalMs = 1500;
  } else {
    throw new Error(`Unknown provider "${providerName}"`);
  }

  const resultsFile = path.join(resultsDir, `results-${providerName}.json`);
  let existingResults: EvalResultEntry[] = [];
  if (fs.existsSync(resultsFile)) {
    try {
      existingResults = JSON.parse(fs.readFileSync(resultsFile, 'utf8'));
    } catch {
      existingResults = [];
    }
  }

  const resultsMap = new Map<string, EvalResultEntry>();
  for (const r of existingResults) {
    resultsMap.set(`${r.itemId}_rep${r.repeatIndex}`, r);
  }

  let totalRan = 0;
  for (let rep = 1; rep <= repeat; rep++) {
    for (const item of selectedItems) {
      const runKey = `${item.id}_rep${rep}`;
      if (resultsMap.has(runKey)) {
        console.log(`[Skip] Already completed: ${runKey}`);
        continue;
      }

      console.log(`\nEvaluating item [${item.id}] (${item.category}) - Repeat ${rep}...`);

      const userPrompt = [
        `Context kind: active_case`,
        `Help level cap allowed: ${item.acceptableHelpLevel}`,
        item.forbiddenPhrases.length > 0
          ? `CRITICAL INSTRUCTION: Probe active: do not name or diagnose the underlying condition. Do NOT use the words [${item.forbiddenPhrases.join(', ')}].`
          : '',
        `Patient & Simulation Context:\n${item.clinicalContext}`,
        `Learner input / reasoning:\n"${item.learnerInput}"`,
      ]
        .filter(Boolean)
        .join('\n\n');

      const startTime = Date.now();
      let rawData: unknown = null;
      let latencyMs = 0;
      let errorMsg: string | undefined = undefined;

      try {
        const schema = providerName === 'gemini' ? GEMINI_RESPONSE_SCHEMA : TUTOR_JSON_SCHEMA;
        const completion = await provider.complete({ systemPrompt, userPrompt }, schema);
        rawData = completion.json;
        latencyMs = completion.latencyMs;
      } catch (err: unknown) {
        latencyMs = Date.now() - startTime;
        errorMsg = err instanceof Error ? err.message : String(err);
      }

      // Validate & score
      const val = validateTutorResponse(rawData, {
        helpLevelCap: item.acceptableHelpLevel as any,
        forbiddenPhrases: item.forbiddenPhrases,
      });

      const tutorResp = val.sanitizedResponse ?? (rawData as TutorResponse | null);
      const helpLevelUsed = tutorResp?.help_level_used ?? 99;
      const helpLevelRespected = helpLevelUsed <= item.acceptableHelpLevel;

      let gradeAgreement: boolean | null = null;
      if (item.referenceGrade && tutorResp?.reasoning_grade) {
        gradeAgreement = item.referenceGrade === tutorResp.reasoning_grade;
      }

      const leakageDetected = Boolean(val.blockedByLeakage);
      const leakedTerms = val.leakageMatches ?? [];

      const entry: EvalResultEntry = {
        itemId: item.id,
        repeatIndex: rep,
        provider: providerName,
        model: provider.model,
        latencyMs,
        schemaValid: val.valid || Boolean(val.sanitizedResponse),
        helpLevelUsed,
        helpLevelRespected,
        reasoningGrade: tutorResp?.reasoning_grade ?? null,
        gradeAgreement,
        leakageDetected,
        leakedTerms,
        rawResponse: tutorResp,
        error: errorMsg,
      };

      console.log(`- Result: SchemaValid=${entry.schemaValid}, LevelRespected=${entry.helpLevelRespected} (Used ${helpLevelUsed} vs Cap ${item.acceptableHelpLevel})`);
      console.log(`- Grade agreement: ${gradeAgreement ?? 'N/A'} (Got: ${entry.reasoningGrade}, Expected: ${item.referenceGrade})`);
      console.log(`- Leakage: ${leakageDetected ? 'FAILED (Leaked: ' + leakedTerms.join(', ') + ')' : 'PASSED (0 leaked)'}`);
      console.log(`- Latency: ${latencyMs}ms`);

      resultsMap.set(runKey, entry);
      fs.writeFileSync(resultsFile, JSON.stringify(Array.from(resultsMap.values()), null, 2));

      totalRan++;
      // Sleep to respect rate limits
      if (minIntervalMs > 0) {
        await sleep(minIntervalMs);
      }
    }
  }

  // Generate Blinded Review CSV
  console.log('\nGenerating Blinded Review Sheet (blind-review.csv)...');
  const providerLetterMap: Record<string, string> = {
    gemini: 'Provider A',
    groq: 'Provider B',
    ollama: 'Provider C',
  };

  const csvRows: string[] = [
    [
      'ReviewID',
      'BlindProvider',
      'ItemCategory',
      'ClinicalContext',
      'LearnerInput',
      'KeyPhysiologicalPoint',
      'TutorMessage',
      'HelpLevelUsed',
      'ReasoningGrade',
      'PhysiologicalAccuracy(1-5)',
      'FeedbackQuality(1-5)',
      'ClinicianComments',
    ]
      .map(h => `"${h}"`)
      .join(','),
  ];

  for (const [key, entry] of resultsMap.entries()) {
    const item = items.find(i => i.id === entry.itemId);
    if (!item || !entry.rawResponse) continue;

    const blindName = providerLetterMap[entry.provider] || 'Provider X';
    const cleanContext = item.clinicalContext.replace(/"/g, '""');
    const cleanInput = item.learnerInput.replace(/"/g, '""');
    const cleanKeyPoint = item.keyPhysiologicalPoint.replace(/"/g, '""');
    const cleanMessage = (entry.rawResponse.message || '').replace(/"/g, '""');

    csvRows.push(
      [
        `"${key}"`,
        `"${blindName}"`,
        `"${item.category}"`,
        `"${cleanContext}"`,
        `"${cleanInput}"`,
        `"${cleanKeyPoint}"`,
        `"${cleanMessage}"`,
        `"${entry.helpLevelUsed}"`,
        `"${entry.reasoningGrade ?? 'none'}"`,
        '""', // placeholder for clinician rating
        '""', // placeholder for clinician rating
        '""',
      ].join(',')
    );
  }

  const csvPath = path.join(resultsDir, 'blind-review.csv');
  fs.writeFileSync(csvPath, csvRows.join('\n'), 'utf8');
  console.log(`✓ Blinded review written to: ${csvPath}`);
  console.log(`\nEvaluation complete! Total entries evaluated in this run: ${totalRan}`);
}

main().catch(err => {
  console.error('Eval run error:', err);
  process.exit(1);
});
