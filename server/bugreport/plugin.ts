/**
 * Local bug-report store. The trainer posts a report (diagnostics JSON plus a PNG screenshot) and this writes
 * it into a folder beside the app: bug-reports/<id>/report.json and bug-reports/<id>/screenshot.png.
 * Nothing leaves this computer. Only requests from this computer are accepted.
 */
import type { Plugin } from 'vite';
import type { IncomingMessage, ServerResponse } from 'http';
import fs from 'fs';
import path from 'path';

export const MAX_BODY_BYTES = 20 * 1024 * 1024;
const ID_RE = /^BR-\d{8}-\d{6}-[a-z0-9]{4}$/;
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export interface BugReportStoreOptions {
  /** Folder that holds the reports. Default: <cwd>/bug-reports. */
  dir?: string;
}

export interface StoredReportSummary {
  id: string;
  createdAt: string;
  description: string;
  section: string;
  hasScreenshot: boolean;
}

export function newReportId(now = new Date(), rand = Math.random): string {
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  const date = `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}`;
  const time = `${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}`;
  const suffix = Array.from({ length: 4 }, () => 'abcdefghjkmnpqrstuvwxyz23456789'[Math.floor(rand() * 31)]).join('');
  return `BR-${date}-${time}-${suffix}`;
}

function isLoopback(addr: string | undefined): boolean {
  if (!addr) return false;
  return addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1';
}

/** Saves one report. Returns its id and folder. Throws on malformed input. */
export function saveReport(dir: string, body: unknown, now = new Date()): { id: string; folder: string } {
  if (!body || typeof body !== 'object') throw new Error('Report must be a JSON object.');
  const { report, screenshotPngBase64 } = body as { report?: unknown; screenshotPngBase64?: unknown };
  if (!report || typeof report !== 'object' || Array.isArray(report)) throw new Error('Missing "report" object.');
  let png: Buffer | null = null;
  if (typeof screenshotPngBase64 === 'string' && screenshotPngBase64.length > 0) {
    png = Buffer.from(screenshotPngBase64.replace(/^data:image\/png;base64,/, ''), 'base64');
    if (png.length < PNG_MAGIC.length || !png.subarray(0, PNG_MAGIC.length).equals(PNG_MAGIC)) {
      throw new Error('Screenshot is not a PNG image.');
    }
  }
  const id = newReportId(now);
  const folder = path.join(dir, id);
  fs.mkdirSync(folder, { recursive: true });
  const record = { ...(report as Record<string, unknown>), id, savedAt: now.toISOString(), screenshotFile: png ? 'screenshot.png' : null };
  fs.writeFileSync(path.join(folder, 'report.json'), JSON.stringify(record, null, 2), 'utf8');
  if (png) fs.writeFileSync(path.join(folder, 'screenshot.png'), png);
  return { id, folder };
}

export function listReports(dir: string): StoredReportSummary[] {
  if (!fs.existsSync(dir)) return [];
  const out: StoredReportSummary[] = [];
  for (const name of fs.readdirSync(dir)) {
    if (!ID_RE.test(name)) continue;
    try {
      const r = JSON.parse(fs.readFileSync(path.join(dir, name, 'report.json'), 'utf8')) as Record<string, unknown>;
      out.push({
        id: name,
        createdAt: typeof r.createdAt === 'string' ? r.createdAt : String(r.savedAt ?? ''),
        description: typeof r.description === 'string' ? r.description.slice(0, 200) : '',
        section: typeof r.section === 'string' ? r.section : '',
        hasScreenshot: fs.existsSync(path.join(dir, name, 'screenshot.png')),
      });
    } catch { /* unreadable report: skip it, keep listing the rest */ }
  }
  return out.sort((a, b) => (a.id < b.id ? 1 : -1));
}

function send(res: ServerResponse, status: number, payload: unknown): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(payload));
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY_BYTES) { reject(new Error('Report is too large.')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

export async function handleBugReportRequest(req: IncomingMessage, res: ServerResponse, dir: string): Promise<void> {
  if (!isLoopback(req.socket.remoteAddress)) return send(res, 403, { success: false, error: 'Bug reports are accepted from this computer only.' });
  const url = (req.url ?? '/').split('?')[0] ?? '/';
  if (req.method === 'GET' && (url === '/' || url === '')) {
    return send(res, 200, { success: true, folder: dir, reports: listReports(dir) });
  }
  if (req.method === 'GET') {
    const m = url.match(/^\/(BR-[\w-]+)\/(report\.json|screenshot\.png)$/);
    if (!m || !ID_RE.test(m[1]!)) return send(res, 404, { success: false, error: 'Not found.' });
    const file = path.join(dir, m[1]!, m[2]!);
    if (!fs.existsSync(file)) return send(res, 404, { success: false, error: 'Not found.' });
    res.statusCode = 200;
    res.setHeader('Content-Type', m[2] === 'report.json' ? 'application/json' : 'image/png');
    res.end(fs.readFileSync(file));
    return;
  }
  if (req.method === 'POST' && (url === '/' || url === '')) {
    if (!String(req.headers['content-type'] ?? '').includes('application/json')) return send(res, 415, { success: false, error: 'Send JSON.' });
    try {
      const saved = saveReport(dir, JSON.parse(await readBody(req)));
      return send(res, 201, { success: true, id: saved.id, folder: saved.folder });
    } catch (e) {
      return send(res, 400, { success: false, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return send(res, 405, { success: false, error: 'Method not allowed.' });
}

export function bugReportPlugin(options: BugReportStoreOptions = {}): Plugin {
  const dir = options.dir ?? path.resolve(process.cwd(), 'bug-reports');
  const middleware = (req: IncomingMessage, res: ServerResponse) => {
    void handleBugReportRequest(req, res, dir).catch(e => send(res, 500, { success: false, error: String(e) }));
  };
  return {
    name: 'bug-report-store',
    configureServer(server) { server.middlewares.use('/api/bug-report', middleware); },
    configurePreviewServer(server) { server.middlewares.use('/api/bug-report', middleware); },
  };
}
