import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { Readable } from 'stream';
import type { IncomingMessage, ServerResponse } from 'http';
import { saveReport, listReports, handleBugReportRequest } from '../../server/bugreport/plugin';

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('data')]);
const ID = /^BR-\d{8}-\d{6}-[a-z0-9]{4}$/;

let dir: string;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'br-test-')); });
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

function call(method: string, url: string, body = '', opts: { addr?: string; type?: string } = {}) {
  const req = Readable.from(body ? [Buffer.from(body)] : []) as unknown as IncomingMessage;
  Object.assign(req, {
    method, url,
    headers: opts.type === undefined ? { 'content-type': 'application/json' } : opts.type ? { 'content-type': opts.type } : {},
    socket: { remoteAddress: opts.addr ?? '127.0.0.1' },
  });
  const out = { statusCode: 0, headers: {} as Record<string, string>, body: '' };
  const res = {
    get statusCode() { return out.statusCode; },
    set statusCode(v: number) { out.statusCode = v; },
    setHeader(k: string, v: string) { out.headers[k] = v; },
    end(b?: string | Buffer) { out.body = b ? b.toString() : ''; },
  } as unknown as ServerResponse;
  return handleBugReportRequest(req, res, dir).then(() => out);
}

describe('saveReport', () => {
  it('writes report.json and screenshot.png', () => {
    const { id, folder } = saveReport(dir, { report: { description: 'x' }, screenshotPngBase64: PNG.toString('base64') });
    expect(id).toMatch(ID);
    expect(JSON.parse(fs.readFileSync(path.join(folder, 'report.json'), 'utf8')).id).toBe(id);
    expect(fs.readFileSync(path.join(folder, 'screenshot.png')).equals(PNG)).toBe(true);
  });
  it('rejects a non-PNG screenshot', () => {
    expect(() => saveReport(dir, { report: {}, screenshotPngBase64: Buffer.from('not a png at all').toString('base64') })).toThrow(/PNG/);
  });
  it('works without a screenshot', () => {
    const { folder } = saveReport(dir, { report: { description: 'x' } });
    expect(fs.existsSync(path.join(folder, 'report.json'))).toBe(true);
    expect(fs.existsSync(path.join(folder, 'screenshot.png'))).toBe(false);
  });
  it('lists saved reports', () => {
    const { id } = saveReport(dir, { report: { description: 'hello', section: 's' } });
    const list = listReports(dir);
    expect(list.map(r => r.id)).toContain(id);
    expect(list[0]!.description).toBe('hello');
  });
});

describe('handleBugReportRequest', () => {
  it('403 for non-loopback', async () => {
    expect((await call('GET', '/', '', { addr: '192.168.1.5' })).statusCode).toBe(403);
  });
  it('POST saves, GET lists and fetches', async () => {
    const post = await call('POST', '/', JSON.stringify({ report: { description: 'd' }, screenshotPngBase64: PNG.toString('base64') }));
    expect(post.statusCode).toBe(201);
    const { id, folder } = JSON.parse(post.body);
    expect(fs.existsSync(path.join(folder, 'report.json'))).toBe(true);
    expect(fs.existsSync(path.join(folder, 'screenshot.png'))).toBe(true);
    const list = await call('GET', '/');
    expect(list.statusCode).toBe(200);
    expect(JSON.parse(list.body).reports.map((r: { id: string }) => r.id)).toContain(id);
    const got = await call('GET', `/${id}/report.json`);
    expect(got.statusCode).toBe(200);
    expect(JSON.parse(got.body).id).toBe(id);
  });
  it('404 for bad id and traversal', async () => {
    expect((await call('GET', '/BR-bad/report.json')).statusCode).toBe(404);
    expect((await call('GET', '/../../package.json')).statusCode).toBe(404);
    expect((await call('GET', '/BR-..%2F..%2Fx/report.json')).statusCode).toBe(404);
  });
  it('415 for wrong content type', async () => {
    expect((await call('POST', '/', '{}', { type: 'text/plain' })).statusCode).toBe(415);
  });
});
