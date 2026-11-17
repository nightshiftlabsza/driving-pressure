/**
 * Diagnostics for bug reports. Keeps a short rolling record of errors, failed requests and recent clicks,
 * and lets each screen say what it is showing (case id, ventilator settings, lab stage...).
 * Privacy: nothing typed into a field is recorded, only which control was pressed. Patients are synthetic.
 * Everything stays in memory until the learner presses "Report a problem".
 */

const MAX_ERRORS = 30;
const MAX_ACTIONS = 30;
const MAX_REQUESTS = 15;

export interface LoggedError { at: string; kind: 'console.error' | 'console.warn' | 'error' | 'unhandledrejection'; message: string }
export interface LoggedAction { at: string; kind: 'click' | 'navigate'; target: string }
export interface LoggedRequest { at: string; method: string; url: string; status: number | 'network-error' }

const errors: LoggedError[] = [];
const actions: LoggedAction[] = [];
const failedRequests: LoggedRequest[] = [];
const contextProviders = new Map<string, () => unknown>();
let installed = false;

function push<T>(list: T[], item: T, max: number): void {
  list.push(item);
  if (list.length > max) list.splice(0, list.length - max);
}

function text(v: unknown): string {
  if (v instanceof Error) return `${v.name}: ${v.message}`;
  if (typeof v === 'string') return v;
  try { return JSON.stringify(v) ?? String(v); } catch { return String(v); }
}

/** A short, value-free name for the control that was pressed. */
export function describeTarget(el: Element | null): string {
  const hit = el?.closest('button, a, [role="tab"], [role="button"], select, input, textarea, label');
  if (!hit) return el ? el.tagName.toLowerCase() : 'unknown';
  const tag = hit.tagName.toLowerCase();
  const testId = hit.getAttribute('data-testid');
  const label = hit.getAttribute('aria-label')
    ?? (tag === 'input' || tag === 'textarea' || tag === 'select' ? hit.getAttribute('name') ?? hit.getAttribute('placeholder') : hit.textContent);
  const name = (label ?? '').replace(/\s+/g, ' ').trim().slice(0, 60);
  return `${tag}${testId ? `[${testId}]` : ''}${name ? ` "${name}"` : ''}`;
}

export function logNavigation(to: string): void {
  push(actions, { at: new Date().toISOString(), kind: 'navigate', target: to }, MAX_ACTIONS);
}

/** Screens register what they are showing. Returns the function that removes the registration. */
export function registerBugContext(key: string, provider: () => unknown): () => void {
  contextProviders.set(key, provider);
  return () => { if (contextProviders.get(key) === provider) contextProviders.delete(key); };
}

/** Starts recording. Safe to call more than once. */
export function installDiagnostics(): void {
  if (installed || typeof window === 'undefined') return;
  installed = true;

  for (const level of ['error', 'warn'] as const) {
    const original = console[level].bind(console);
    console[level] = (...args: unknown[]) => {
      push(errors, { at: new Date().toISOString(), kind: `console.${level}`, message: args.map(text).join(' ').slice(0, 600) }, MAX_ERRORS);
      original(...args);
    };
  }
  window.addEventListener('error', e => {
    push(errors, { at: new Date().toISOString(), kind: 'error', message: `${e.message} (${e.filename?.split('/').pop() ?? ''}:${e.lineno})`.slice(0, 600) }, MAX_ERRORS);
  });
  window.addEventListener('unhandledrejection', e => {
    push(errors, { at: new Date().toISOString(), kind: 'unhandledrejection', message: text(e.reason).slice(0, 600) }, MAX_ERRORS);
  });
  document.addEventListener('click', e => {
    if (!(e.target instanceof Element)) return;
    push(actions, { at: new Date().toISOString(), kind: 'click', target: describeTarget(e.target) }, MAX_ACTIONS);
  }, true);

  if (typeof window.fetch === 'function') {
    const originalFetch = window.fetch.bind(window);
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
      const rawUrl = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const url = rawUrl.split('?')[0] ?? rawUrl; // never keep query strings
      try {
        const res = await originalFetch(input, init);
        if (!res.ok) push(failedRequests, { at: new Date().toISOString(), method, url, status: res.status }, MAX_REQUESTS);
        return res;
      } catch (err) {
        push(failedRequests, { at: new Date().toISOString(), method, url, status: 'network-error' }, MAX_REQUESTS);
        throw err;
      }
    };
  }
}

export function parseUserAgent(ua: string): { browser: string; browserVersion: string; os: string } {
  const pick = (re: RegExp) => ua.match(re)?.[1] ?? '';
  let browser = 'Unknown';
  let browserVersion = '';
  if (/Edg\//.test(ua)) { browser = 'Edge'; browserVersion = pick(/Edg\/([\d.]+)/); }
  else if (/OPR\//.test(ua)) { browser = 'Opera'; browserVersion = pick(/OPR\/([\d.]+)/); }
  else if (/Firefox\//.test(ua)) { browser = 'Firefox'; browserVersion = pick(/Firefox\/([\d.]+)/); }
  else if (/Chrome\//.test(ua)) { browser = 'Chrome'; browserVersion = pick(/Chrome\/([\d.]+)/); }
  else if (/Safari\//.test(ua)) { browser = 'Safari'; browserVersion = pick(/Version\/([\d.]+)/); }
  let os = 'Unknown';
  if (/Windows NT 10/.test(ua)) os = 'Windows 10 or 11';
  else if (/Windows/.test(ua)) os = 'Windows';
  else if (/Android/.test(ua)) os = `Android ${pick(/Android ([\d.]+)/)}`.trim();
  else if (/iPhone|iPad/.test(ua)) os = `iOS ${pick(/OS ([\d_]+)/).replace(/_/g, '.')}`.trim();
  else if (/Mac OS X/.test(ua)) os = `macOS ${pick(/Mac OS X ([\d_.]+)/).replace(/_/g, '.')}`.trim();
  else if (/Linux/.test(ua)) os = 'Linux';
  return { browser, browserVersion, os };
}

export interface BugReport {
  schema: 1;
  createdAt: string;
  description: string;
  app: { version: string; commit: string };
  section: string;
  url: { path: string; hash: string; search: string };
  theme: string;
  environment: {
    browser: string; browserVersion: string; os: string; userAgent: string; language: string;
    screen: { width: number; height: number };
    viewport: { width: number; height: number };
    devicePixelRatio: number;
    online: boolean;
  };
  context: Record<string, unknown>;
  recentErrors: LoggedError[];
  failedRequests: LoggedRequest[];
  recentActions: LoggedAction[];
}

declare const __APP_COMMIT__: string | undefined;

export function collectReport(description: string, appVersion: string): BugReport {
  const context: Record<string, unknown> = {};
  for (const [key, provider] of contextProviders) {
    try { context[key] = provider(); } catch (e) { context[key] = { error: text(e) }; }
  }
  const root = document.querySelector('.vt');
  const app = (context.app ?? {}) as { section?: unknown };
  return {
    schema: 1,
    createdAt: new Date().toISOString(),
    description: description.trim(),
    app: { version: appVersion, commit: typeof __APP_COMMIT__ === 'string' ? __APP_COMMIT__ : 'unknown' },
    section: typeof app.section === 'string' ? app.section : 'unknown',
    url: { path: location.pathname, hash: location.hash, search: location.search },
    theme: root?.getAttribute('data-theme') ?? 'unknown',
    environment: {
      ...parseUserAgent(navigator.userAgent),
      userAgent: navigator.userAgent,
      language: navigator.language,
      screen: { width: window.screen.width, height: window.screen.height },
      viewport: { width: window.innerWidth, height: window.innerHeight },
      devicePixelRatio: window.devicePixelRatio,
      online: navigator.onLine,
    },
    context,
    recentErrors: [...errors],
    failedRequests: [...failedRequests],
    recentActions: [...actions],
  };
}

/** For tests. */
export function resetDiagnosticsForTest(): void {
  errors.length = 0; actions.length = 0; failedRequests.length = 0; contextProviders.clear();
}
