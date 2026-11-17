import fs from 'fs';
import path from 'path';

export interface BudgetConfig {
  geminiDailyLimit: number;
  groqDailyLimit: number;
  dataDir: string;
}

interface BudgetData {
  date: string;
  geminiCount: number;
  groqCount: number;
}

export class BudgetTracker {
  private dataDir: string;
  private budgetFile: string;
  private usageLogFile: string;
  private geminiLimit: number;
  private groqLimit: number;

  constructor(config: Partial<BudgetConfig> = {}) {
    this.dataDir = config.dataDir || path.resolve(process.cwd(), '.tutor-data');
    this.budgetFile = path.join(this.dataDir, 'budget.json');
    this.usageLogFile = path.join(this.dataDir, 'usage.jsonl');
    this.geminiLimit = config.geminiDailyLimit ?? 200;
    this.groqLimit = config.groqDailyLimit ?? 300;
    this.ensureDir();
  }

  private ensureDir(): void {
    if (!fs.existsSync(this.dataDir)) {
      try {
        fs.mkdirSync(this.dataDir, { recursive: true });
      } catch {
        // ignore if already exists or permission issues
      }
    }
  }

  private getTodayString(): string {
    return new Date().toISOString().slice(0, 10);
  }

  private readBudgetData(): BudgetData {
    this.ensureDir();
    const today = this.getTodayString();
    const defaultData: BudgetData = { date: today, geminiCount: 0, groqCount: 0 };

    if (!fs.existsSync(this.budgetFile)) {
      return defaultData;
    }

    try {
      const raw = fs.readFileSync(this.budgetFile, 'utf8');
      const data = JSON.parse(raw) as BudgetData;
      if (data.date !== today) {
        return defaultData;
      }
      return data;
    } catch {
      return defaultData;
    }
  }

  private saveBudgetData(data: BudgetData): void {
    this.ensureDir();
    try {
      fs.writeFileSync(this.budgetFile, JSON.stringify(data, null, 2), 'utf8');
    } catch {
      // ignore write failures
    }
  }

  hasBudget(provider: 'gemini' | 'groq'): boolean {
    const data = this.readBudgetData();
    if (provider === 'gemini') {
      return data.geminiCount < this.geminiLimit;
    }
    if (provider === 'groq') {
      return data.groqCount < this.groqLimit;
    }
    return true;
  }

  getRemaining(provider: 'gemini' | 'groq'): number {
    const data = this.readBudgetData();
    if (provider === 'gemini') {
      return Math.max(0, this.geminiLimit - data.geminiCount);
    }
    if (provider === 'groq') {
      return Math.max(0, this.groqLimit - data.groqCount);
    }
    return Infinity;
  }

  consume(provider: 'gemini' | 'groq'): void {
    const data = this.readBudgetData();
    if (provider === 'gemini') {
      data.geminiCount += 1;
    } else if (provider === 'groq') {
      data.groqCount += 1;
    }
    this.saveBudgetData(data);
  }

  logUsage(entry: {
    provider: string;
    model: string;
    tokens?: { inputTokens: number; outputTokens: number };
    latencyMs: number;
    outcome: 'success' | 'failure';
    error?: string;
  }): void {
    this.ensureDir();
    const record = {
      timestamp: new Date().toISOString(),
      provider: entry.provider,
      model: entry.model,
      tokens: entry.tokens ?? { inputTokens: 0, outputTokens: 0 },
      latencyMs: entry.latencyMs,
      outcome: entry.outcome,
      error: entry.error,
    };
    try {
      fs.appendFileSync(this.usageLogFile, JSON.stringify(record) + '\n', 'utf8');
    } catch {
      // ignore log write errors
    }
  }
}
