// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { parseUserAgent, describeTarget, registerBugContext, collectReport, resetDiagnosticsForTest } from './diagnostics';

describe('parseUserAgent', () => {
  it('Chrome on Windows', () => {
    const r = parseUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36');
    expect(r).toEqual({ browser: 'Chrome', browserVersion: '126.0.0.0', os: 'Windows 10 or 11' });
  });
  it('Edge', () => {
    const r = parseUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.2592.81');
    expect(r.browser).toBe('Edge');
    expect(r.browserVersion).toBe('126.0.2592.81');
  });
  it('Firefox', () => {
    const r = parseUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:128.0) Gecko/20100101 Firefox/128.0');
    expect(r.browser).toBe('Firefox');
    expect(r.browserVersion).toBe('128.0');
  });
  it('iPhone Safari', () => {
    const r = parseUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1');
    expect(r).toEqual({ browser: 'Safari', browserVersion: '17.5', os: 'iOS 17.5' });
  });
});

describe('describeTarget', () => {
  it('names a button by test id and text', () => {
    document.body.innerHTML = '<button data-testid="go">  Start   now </button>';
    expect(describeTarget(document.querySelector('button'))).toBe('button[go] "Start now"');
  });
  it('never includes a typed value', () => {
    document.body.innerHTML = '<input data-testid="pw" name="secret" />';
    const input = document.querySelector('input')!;
    input.value = 'hunter2';
    const d = describeTarget(input);
    expect(d).toContain('input[pw]');
    expect(d).not.toContain('hunter2');
  });
});

describe('collectReport', () => {
  beforeEach(() => resetDiagnosticsForTest());

  it('collects context, section, sizes, trimmed description', () => {
    registerBugContext('app', () => ({ section: 'Lab' }));
    registerBugContext('bad', () => { throw new Error('nope'); });
    const r = collectReport('  hi  ', '1.0');
    expect(r.context.app).toEqual({ section: 'Lab' });
    expect(r.section).toBe('Lab');
    expect(r.context.bad).toEqual({ error: 'Error: nope' });
    expect(r.description).toBe('hi');
    expect(typeof r.environment.viewport.width).toBe('number');
    expect(typeof r.environment.viewport.height).toBe('number');
    expect(typeof r.environment.screen.width).toBe('number');
    expect(typeof r.environment.screen.height).toBe('number');
  });

  it('records errors, clicks and failed requests after install', async () => {
    vi.resetModules();
    window.fetch = vi.fn(async () => new Response('x', { status: 500 })) as unknown as typeof fetch;
    const mod = await import('./diagnostics');
    mod.installDiagnostics();
    console.error('boom');
    document.body.innerHTML = '<button data-testid="b1">Press</button>';
    document.querySelector('button')!.click();
    await window.fetch('http://example.test/api/x?token=abc');
    const r = mod.collectReport('', '1');
    expect(r.recentErrors.some(e => e.kind === 'console.error' && e.message.includes('boom'))).toBe(true);
    expect(r.recentActions.some(a => a.kind === 'click' && a.target.includes('b1'))).toBe(true);
    expect(r.failedRequests).toHaveLength(1);
    expect(r.failedRequests[0]).toMatchObject({ url: 'http://example.test/api/x', status: 500 });
  });
});
