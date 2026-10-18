'use strict';
// Repeatable backend tests. A local mock server stands in for OpenAI and Gemini,
// so these tests spend NO API credits and never touch the real providers.
process.env.QUIET = '1';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const net = require('node:net');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const { createApp, loadConfig, scrub } = require('../server');

const OPENAI_KEY = 'sk-test-OPENAI-SECRET-123456789';
const GEMINI_KEY = 'AIzaTESTGEMINISECRET1234567890abcd';

const freePort = () => new Promise(r => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });

/** Mock upstream: `handler(req, bodyObj, res)` decides the reply; requests are recorded. */
async function mockUpstream(handler) {
  const seen = [];
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', c => raw += c);
    req.on('end', () => {
      let body = null; try { body = JSON.parse(raw); } catch (_) {}
      seen.push({ url: req.url, headers: req.headers, body });
      handler(req, body, res);
    });
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  return { seen, base: `http://127.0.0.1:${server.address().port}`, close: () => new Promise(r => { server.closeAllConnections && server.closeAllConnections(); server.close(r); }) };
}
const json = (res, status, obj) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };

async function boot(over = {}, up = {}) {
  const port = await freePort();
  const cfg = loadConfig({
    PORT: String(port), HOST: '127.0.0.1',
    OPENAI_API_KEY: OPENAI_KEY, GEMINI_API_KEY: GEMINI_KEY,
    OPENAI_BASE_URL: up.openai || 'http://127.0.0.1:1', GEMINI_BASE_URL: up.gemini || 'http://127.0.0.1:1',
    REQUEST_TIMEOUT_MS: '2000', ...over,
  });
  const server = await new Promise(r => { const s = createApp(cfg).listen(port, '127.0.0.1', () => r(s)); });
  const base = `http://127.0.0.1:${port}`;
  const call = (p, opt = {}) => fetch(base + p, opt);
  const post = (p, body, headers = {}) => call(p, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) });
  return { base, port, post, call, close: () => new Promise(r => { server.closeAllConnections && server.closeAllConnections(); server.close(r); }) };
}
const chatBody = (o = {}) => ({ provider: 'openai', messages: [{ role: 'user', content: 'Explain photosynthesis' }], ...o });

test('health endpoint works and status never leaks keys', async () => {
  const a = await boot();
  try {
    const h = await (await a.call('/api/health')).json();
    assert.equal(h.ok, true);
    const raw = await (await a.call('/api/status')).text();
    assert.ok(!raw.includes(OPENAI_KEY) && !raw.includes(GEMINI_KEY), 'status must not contain keys');
    const s = JSON.parse(raw);
    assert.equal(s.providers.openai.configured, true);
    assert.equal(s.providers.gemini.configured, true);
    assert.deepEqual(s.providers.openai.models, ['gpt-6-luna', 'gpt-6.1-sol']);
  } finally { await a.close(); }
});

test('missing keys: status says not configured, chat returns not_configured', async () => {
  const a = await boot({ OPENAI_API_KEY: '', GEMINI_API_KEY: '' });
  try {
    const s = await (await a.call('/api/status')).json();
    assert.equal(s.providers.openai.configured, false);
    const r = await a.post('/api/chat', chatBody());
    assert.equal(r.status, 400);
    assert.equal((await r.json()).code, 'not_configured');
  } finally { await a.close(); }
});

test('invalid requests are rejected with clear codes', async () => {
  const a = await boot();
  try {
    const cases = [
      [chatBody({ provider: 'claude' }), 400, 'bad_request'],
      [chatBody({ model: 'gpt-evil-expensive' }), 400, 'bad_model'],
      [chatBody({ messages: [] }), 400, 'bad_request'],
      [chatBody({ messages: [{ role: 'system', content: 'x' }] }), 400, 'bad_request'],
      [chatBody({ messages: [{ role: 'assistant', content: 'hi' }] }), 400, 'bad_request'],
      [chatBody({ messages: [{ role: 'user', content: '   ' }] }), 400, 'bad_request'],
      [chatBody({ messages: [{ role: 'user', content: 'x'.repeat(25000) }] }), 413, 'too_long'],
      [chatBody({ system: 42 }), 400, 'bad_request'],
    ];
    for (const [body, status, code] of cases) {
      const r = await a.post('/api/chat', body);
      assert.equal(r.status, status, JSON.stringify(body).slice(0, 80));
      assert.equal((await r.json()).code, code);
    }
    const bad = await a.post('/api/chat', '{not json');
    assert.equal(bad.status, 400);
    const huge = await a.post('/api/chat', JSON.stringify({ x: 'y'.repeat(200000) }));
    assert.equal(huge.status, 413);
    const nf = await a.call('/api/nope');
    assert.equal(nf.status, 404);
  } finally { await a.close(); }
});

test('OpenAI adapter: correct request shape, response normalised', async () => {
  const up = await mockUpstream((req, body, res) => json(res, 200, {
    status: 'completed',
    output: [{ type: 'reasoning', summary: [] }, { type: 'message', content: [{ type: 'output_text', text: 'Plants make sugar from light.' }] }],
    usage: { input_tokens: 12, output_tokens: 7 },
  }));
  const a = await boot({}, { openai: up.base });
  try {
    const r = await a.post('/api/chat', chatBody({ system: 'Grade 7, English', maxOutputTokens: 300 }));
    const j = await r.json();
    assert.equal(r.status, 200);
    assert.equal(j.ok, true); assert.equal(j.text, 'Plants make sugar from light.');
    assert.equal(j.model, 'gpt-6-luna'); assert.deepEqual(j.usage, { inputTokens: 12, outputTokens: 7 });
    const q = up.seen[0];
    assert.equal(q.url, '/v1/responses');
    assert.equal(q.headers.authorization, `Bearer ${OPENAI_KEY}`);
    assert.equal(q.body.model, 'gpt-6-luna');
    assert.equal(q.body.max_output_tokens, 300);
    assert.equal(q.body.store, false);
    assert.equal(q.body.input[0].role, 'system');
    assert.match(q.body.input[0].content, /Study OS Tutor/);
    assert.match(q.body.input[0].content, /Grade 7, English/);
    assert.deepEqual(q.body.input[1], { role: 'user', content: 'Explain photosynthesis' });
    assert.equal(q.body.reasoning, undefined);
    assert.ok(!JSON.stringify(r).includes(OPENAI_KEY));
  } finally { await a.close(); await up.close(); }
});

test('Gemini adapter: header auth (not URL), role mapping, JSON mode, response normalised', async () => {
  const up = await mockUpstream((req, body, res) => json(res, 200, {
    candidates: [{ content: { parts: [{ text: '{"a":' }, { text: '1}' }] }, finishReason: 'STOP' }],
    usageMetadata: { promptTokenCount: 20, candidatesTokenCount: 5 },
  }));
  const a = await boot({}, { gemini: up.base });
  try {
    const r = await a.post('/api/chat', {
      provider: 'gemini', model: 'gemini-3.8-flash', json: true, temperature: 0.2,
      messages: [{ role: 'user', content: 'q1' }, { role: 'assistant', content: 'a1' }, { role: 'user', content: 'q2' }],
    });
    const j = await r.json();
    assert.equal(r.status, 200); assert.equal(j.text, '{"a":1}');
    assert.deepEqual(j.usage, { inputTokens: 20, outputTokens: 5 });
    const q = up.seen[0];
    assert.equal(q.url, '/v1beta/models/gemini-3.8-flash:generateContent');
    assert.ok(!q.url.includes('key='), 'key must not be in the URL');
    assert.equal(q.headers['x-goog-api-key'], GEMINI_KEY);
    assert.deepEqual(q.body.contents.map(c => c.role), ['user', 'model', 'user']);
    assert.equal(q.body.generationConfig.responseMimeType, 'application/json');
    assert.equal(q.body.generationConfig.temperature, 0.2);
    assert.match(q.body.systemInstruction.parts[0].text, /single valid JSON/);
  } finally { await a.close(); await up.close(); }
});

test('provider switching: each provider hits only its own upstream', async () => {
  const o = await mockUpstream((q, b, res) => json(res, 200, { status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: 'from-openai' }] }] }));
  const g = await mockUpstream((q, b, res) => json(res, 200, { candidates: [{ content: { parts: [{ text: 'from-gemini' }] }, finishReason: 'STOP' }] }));
  const a = await boot({}, { openai: o.base, gemini: g.base });
  try {
    const t = async p => (await (await a.post('/api/chat', chatBody({ provider: p }))).json()).text;
    assert.equal(await t('openai'), 'from-openai');
    assert.equal(await t('gemini'), 'from-gemini');
    assert.equal(await t('openai'), 'from-openai');
    assert.equal(o.seen.length, 2); assert.equal(g.seen.length, 1);
  } finally { await a.close(); await o.close(); await g.close(); }
});

test('upstream failures map to friendly codes and never leak secrets', async () => {
  const cases = [
    [401, 'invalid_key', 502], [403, 'invalid_key', 502], [404, 'model_unavailable', 502],
    [429, 'provider_rate_limited', 429], [500, 'provider_error', 502], [400, 'provider_rejected', 502],
  ];
  for (const [status, code, outStatus] of cases) {
    // The mock echoes the real key back in its error text to prove scrubbing works.
    const up = await mockUpstream((q, b, res) => json(res, status, { error: { message: `bad key ${OPENAI_KEY} and ${GEMINI_KEY}` } }));
    const a = await boot({}, { openai: up.base, gemini: up.base });
    try {
      for (const p of ['openai', 'gemini']) {
        const r = await a.post('/api/chat', chatBody({ provider: p }));
        const raw = await r.text();
        assert.equal(r.status, outStatus, `${p} ${status}`);
        assert.equal(JSON.parse(raw).code, code);
        assert.ok(!raw.includes(OPENAI_KEY) && !raw.includes(GEMINI_KEY) && !raw.includes('SECRET'), 'secret leaked: ' + raw);
      }
    } finally { await a.close(); await up.close(); }
  }
});

test('timeout, unreachable network, unreadable reply', async () => {
  const slow = await mockUpstream(() => { /* never answers */ });
  let a = await boot({ REQUEST_TIMEOUT_MS: '1000' }, { openai: slow.base });
  try {
    const r = await a.post('/api/chat', chatBody());
    assert.equal(r.status, 504); assert.equal((await r.json()).code, 'timeout');
  } finally { await a.close(); await slow.close(); }
  a = await boot({}, { openai: 'http://127.0.0.1:1' });
  try {
    const r = await a.post('/api/chat', chatBody());
    assert.equal(r.status, 502); assert.equal((await r.json()).code, 'network');
  } finally { await a.close(); }
  const junk = await mockUpstream((q, b, res) => { res.writeHead(200); res.end('<html>nope</html>'); });
  a = await boot({}, { openai: junk.base });
  try {
    const r = await a.post('/api/chat', chatBody());
    assert.equal((await r.json()).code, 'provider_error');
  } finally { await a.close(); await junk.close(); }
});

test('blocked, refused, truncated and empty answers', async () => {
  const replies = {
    gBlock: { candidates: [], promptFeedback: { blockReason: 'SAFETY' } },
    gSafetyStop: { candidates: [{ content: { parts: [] }, finishReason: 'SAFETY' }] },
    gTrunc: { candidates: [{ content: { parts: [{ text: 'partial answer' }] }, finishReason: 'MAX_TOKENS' }] },
    oRefuse: { status: 'completed', output: [{ type: 'message', content: [{ type: 'refusal', refusal: 'no' }] }] },
    oTruncEmpty: { status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' }, output: [] },
    oEmpty: { status: 'completed', output: [] },
  };
  let cur;
  const up = await mockUpstream((q, b, res) => json(res, 200, replies[cur]));
  const a = await boot({}, { openai: up.base, gemini: up.base });
  try {
    const run = async (k, p) => { cur = k; const r = await a.post('/api/chat', chatBody({ provider: p })); return [r.status, await r.json()]; };
    let [s, j] = await run('gBlock', 'gemini'); assert.equal(j.code, 'blocked'); assert.equal(s, 422);
    [s, j] = await run('gSafetyStop', 'gemini'); assert.equal(j.code, 'blocked');
    [s, j] = await run('gTrunc', 'gemini'); assert.equal(s, 200); assert.equal(j.truncated, true); assert.equal(j.text, 'partial answer');
    [s, j] = await run('oRefuse', 'openai'); assert.equal(j.code, 'blocked');
    [s, j] = await run('oTruncEmpty', 'openai'); assert.equal(j.code, 'truncated');
    [s, j] = await run('oEmpty', 'openai'); assert.equal(j.code, 'empty');
  } finally { await a.close(); await up.close(); }
});

test('connection test endpoint makes a tiny request and reports success', async () => {
  const up = await mockUpstream((q, b, res) => json(res, 200, { status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: 'OK' }] }] }));
  const a = await boot({}, { openai: up.base });
  try {
    const r = await a.post('/api/test', { provider: 'openai' });
    const j = await r.json();
    assert.equal(j.ok, true); assert.equal(j.text, 'OK');
    assert.equal(up.seen[0].body.max_output_tokens, 64);
  } finally { await a.close(); await up.close(); }
});

test('output limit is clamped to MAX_OUTPUT_TOKENS', async () => {
  const up = await mockUpstream((q, b, res) => json(res, 200, { status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: 'x' }] }] }));
  const a = await boot({ MAX_OUTPUT_TOKENS: '500' }, { openai: up.base });
  try {
    await a.post('/api/chat', chatBody({ maxOutputTokens: 999999 }));
    assert.equal(up.seen[0].body.max_output_tokens, 500);
  } finally { await a.close(); await up.close(); }
});

test('per-minute rate limit and daily cap are enforced', async () => {
  const up = await mockUpstream((q, b, res) => json(res, 200, { status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: 'x' }] }] }));
  let a = await boot({ RATE_LIMIT_PER_MINUTE: '2' }, { openai: up.base });
  try {
    assert.equal((await a.post('/api/chat', chatBody())).status, 200);
    assert.equal((await a.post('/api/chat', chatBody())).status, 200);
    const r = await a.post('/api/chat', chatBody());
    assert.equal(r.status, 429); assert.equal((await r.json()).code, 'rate_limited');
  } finally { await a.close(); }
  a = await boot({ DAILY_REQUEST_LIMIT: '1' }, { openai: up.base });
  try {
    assert.equal((await a.post('/api/chat', chatBody())).status, 200);
    const r = await a.post('/api/chat', chatBody());
    assert.equal(r.status, 429); assert.equal((await r.json()).code, 'daily_limit');
    const s = await (await a.call('/api/status')).json();
    assert.equal(s.limits.usedToday, 1);
  } finally { await a.close(); await up.close(); }
});

test('access token: required when set, constant-time compare, health stays open', async () => {
  const up = await mockUpstream((q, b, res) => json(res, 200, { status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: 'x' }] }] }));
  const a = await boot({ ACCESS_TOKEN: 'a-long-random-token-value' }, { openai: up.base });
  try {
    assert.equal((await a.post('/api/chat', chatBody())).status, 401);
    assert.equal((await a.post('/api/chat', chatBody(), { Authorization: 'Bearer wrong' })).status, 401);
    assert.equal((await a.call('/api/status')).status, 401);
    assert.equal((await a.post('/api/chat', chatBody(), { Authorization: 'Bearer a-long-random-token-value' })).status, 200);
    assert.equal((await a.call('/api/health')).status, 200);
  } finally { await a.close(); await up.close(); }
});

test('CORS allow-list, foreign origins blocked, DNS-rebinding Host blocked', async () => {
  const a = await boot({ ALLOWED_ORIGINS: 'https://my-study.example' });
  try {
    let r = await a.post('/api/chat', chatBody(), { Origin: 'https://evil.example' });
    assert.equal(r.status, 403); assert.equal((await r.json()).code, 'bad_origin');
    r = await a.call('/api/health', { headers: { Origin: 'https://my-study.example' } });
    assert.equal(r.headers.get('access-control-allow-origin'), 'https://my-study.example');
    r = await a.call('/api/health', { headers: { Origin: `http://localhost:${a.port}` } });
    assert.equal(r.status, 200);
  } finally { await a.close(); }
  // Raw request with a forged Host header.
  const b = await boot();
  try {
    const status = await new Promise(res => {
      const req = http.request({ host: '127.0.0.1', port: b.port, path: '/api/health', headers: { Host: 'attacker.example' } }, r => { r.resume(); res(r.statusCode); });
      req.end();
    });
    assert.equal(status, 421);
  } finally { await b.close(); }
});

test('frontend is served; secrets and source files are not', async () => {
  const a = await boot();
  try {
    const r = await a.call('/');
    assert.equal(r.status, 200); assert.match(await r.text(), /<title>Study OS<\/title>/);
    for (const p of ['/.env', '/server.js', '/package.json', '/../server.js', '/node_modules/express/package.json']) {
      const x = await a.call(p);
      assert.notEqual(x.status, 200, p);
    }
  } finally { await a.close(); }
});

test('server refuses to start publicly without ACCESS_TOKEN', () => {
  const r = spawnSync(process.execPath, ['-e', "require('./server').start(require('./server').loadConfig({HOST:'0.0.0.0',PORT:'0'}))"], { cwd: path.join(__dirname, '..'), encoding: 'utf8', env: { PATH: process.env.PATH } });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /ACCESS_TOKEN/);
});

test('scrub removes keys and key-shaped strings', () => {
  const cfg = loadConfig({ OPENAI_API_KEY: OPENAI_KEY, GEMINI_API_KEY: GEMINI_KEY, ACCESS_TOKEN: 'tok-1234567890' });
  const s = scrub(`x ${OPENAI_KEY} y ${GEMINI_KEY} z tok-1234567890 sk-abcdefghijklmnop AIza${'a'.repeat(30)}`, cfg);
  assert.ok(!/sk-|AIza|tok-1234/.test(s), s);
});
