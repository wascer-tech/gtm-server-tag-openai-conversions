'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { setup, readScenarios, runScenario, endpoint, vendorUrl, traceId } = require('./harness.cjs');

const ENVELOPE_KEYS = ['trace_id', 'platform', 'tag_name', 'event_name', 'event_type',
  'request_method', 'request_url', 'request_body', 'response_status', 'response_body', 'duration_ms'];
// fixture = seção SANDBOXED_JS_FOR_SERVER de `git show origin/main:template.tpl` antes desta mudança
const mainCode = fs.readFileSync(path.resolve(__dirname, 'fixtures/sandboxed-js.main.txt'), 'utf8');
const storeHeaders = {
  'x-url-api': 'https://abc.soureicdn.com/database',
  'x-container-identifier': 'container-1', 'x-user-id': 'owner-1'
};
const storeOn = { useStore: true, storeRead: true, storeWrite: true };
const kinds = s => s.calls.map(c => c.kind);

test('sem x-wascer-log: uma chamada só (OpenAI), nenhuma ao coletor', async () => {
  const s = setup({ headers: { 'x-wascer-log': undefined } });
  await s.settle();
  assert.deepEqual(kinds(s), ['vendor']);
  assert.equal(s.calls[0].url, vendorUrl);
  assert.equal(s.logs.length, 0);
  assert.equal(s.success, 1);
  assert.equal(s.failure, 0);
});

for (const flag of ['0', 'true', '1 ', '01', '', 1, true, 'header-value']) {
  test('x-wascer-log = ' + JSON.stringify(flag) + ': nenhuma chamada ao coletor', async () => {
    const s = setup({ headers: { 'x-wascer-log': flag } });
    await s.settle();
    assert.deepEqual(kinds(s), ['vendor']);
    assert.equal(s.logs.length, 0);
    assert.equal(s.success, 1);
  });
}

test('x-wascer-log = "1" e OpenAI 200: uma cópia para o coletor com o envelope exato', async () => {
  const s = setup({ vendorPending: true });
  assert.deepEqual(kinds(s), ['vendor'], 'só a OpenAI antes da resposta');
  assert.equal(s.logs.length, 0, 'nada é copiado antes de a OpenAI responder');
  s.completeVendor();
  await s.settle();
  assert.deepEqual(kinds(s), ['vendor', 'collector']);
  assert.equal(s.logs.length, 1);
  const [vendor, collector] = s.calls;
  const row = s.logs[0];
  assert.equal(collector.url, endpoint);
  assert.equal(collector.options.method, 'POST');
  assert.deepEqual(Object.keys(row).sort(), ENVELOPE_KEYS.slice().sort());
  assert.equal(row.trace_id, traceId);
  assert.equal(row.platform, 'openai');
  assert.equal(row.tag_name, 'OpenAI Conversions');
  assert.equal(row.event_name, 'purchase');
  assert.equal(row.event_type, 'purchase');
  assert.equal(row.request_method, 'POST');
  assert.equal(row.request_url, vendor.url);
  assert.equal(row.request_url, vendorUrl);
  assert.equal(typeof vendor.body, 'string');
  assert.equal(row.request_body, vendor.body, 'string idêntica, byte a byte');
  assert.equal(JSON.parse(row.request_body).events[0].user.ip_address, '203.0.113.10', 'sem máscara');
  assert.equal(row.response_status, 200);
  assert.equal(row.response_body, '{"ok":true}\n');
  assert.ok(Number.isInteger(row.duration_ms) && row.duration_ms >= 0);
  assert.equal(row.duration_ms, 37);
  assert.ok(!JSON.stringify(row).includes('response-credential-never-copy'), 'headers da resposta não vão');
  assert.ok(!JSON.stringify(row).includes('key-secret-1'), 'o header Authorization não faz parte do envelope');
  assert.equal(s.success, 1);
  assert.equal(s.failure, 0);
  assert.deepEqual(s.order, ['vendor', 'gtmOnSuccess', 'collector']);
});

for (const status of [400, 503]) {
  test('OpenAI ' + status + ': cópia com o status e o body, e a tag chama gtmOnFailure', async () => {
    const s = setup({ status, responseBody: '{"error":"nope"}' });
    await s.settle();
    assert.equal(s.logs.length, 1);
    assert.equal(s.logs[0].response_status, status);
    assert.equal(s.logs[0].response_body, '{"error":"nope"}');
    assert.equal(s.failure, 1);
    assert.equal(s.success, 0);
  });
}

test('erro de rede na OpenAI: cópia com response_status 0 e a tag chama gtmOnFailure', async () => {
  const s = setup({ vendorError: { reason: 'timed_out' } });
  await s.settle();
  assert.equal(s.logs.length, 1);
  assert.equal(s.logs[0].response_status, 0);
  assert.equal(s.logs[0].response_body, 'timed_out');
  assert.equal(s.logs[0].request_body, s.calls[0].body);
  assert.equal(s.logs[0].request_url, vendorUrl);
  assert.equal(s.failure, 1);
  assert.equal(s.success, 0);
});

test('erro de rede com error.body: response_body usa o body; erro sem detalhe: string vazia', async () => {
  const withBody = setup({ vendorError: { reason: 'failed', body: 'raw error body' } });
  await withBody.settle();
  assert.equal(withBody.logs[0].response_body, 'raw error body');
  const bare = setup({ vendorError: 'store is down' });
  await bare.settle();
  assert.equal(bare.logs.length, 1);
  assert.equal(bare.logs[0].response_status, 0);
  assert.equal(bare.logs[0].response_body, '');
  assert.equal(bare.failure, 1);
});

test('modo optimistic: gtmOnSuccess sai antes da resposta e a cópia vem depois, com o status real', async () => {
  const ok = setup({ data: { optimistic: true }, vendorPending: true });
  assert.equal(ok.success, 1, 'sucesso reportado antes de a OpenAI responder');
  assert.equal(ok.logs.length, 0);
  ok.completeVendor();
  await ok.settle();
  assert.deepEqual(kinds(ok), ['vendor', 'collector']);
  assert.equal(ok.logs[0].response_status, 200);
  assert.equal(ok.logs[0].request_body, ok.calls[0].body);
  const refused = setup({ data: { optimistic: true }, status: 422, responseBody: 'bad' });
  await refused.settle();
  assert.equal(refused.logs[0].response_status, 422);
  assert.equal(refused.logs[0].response_body, 'bad');
  const down = setup({ data: { optimistic: true }, vendorError: { reason: 'timed_out' } });
  await down.settle();
  assert.equal(down.logs.length, 1);
  assert.equal(down.logs[0].response_status, 0);
  assert.equal(down.logs[0].response_body, 'timed_out');
  for (const s of [ok, refused, down]) {
    assert.equal(s.success, 1);
    assert.equal(s.failure, 0);
  }
});

test('chamadas auxiliares à Wascer Store (leitura e escrita) não geram cópia', async () => {
  const s = setup({ headers: storeHeaders, data: storeOn, cookies: { __obref: ['ob-1'] } });
  await s.settle();
  assert.deepEqual(kinds(s).sort(), ['collector', 'storeRead', 'storeWrite', 'vendor']);
  assert.equal(s.logs.length, 1, 'só a entrega à OpenAI é copiada');
  assert.equal(s.logs[0].request_url, vendorUrl);
  assert.equal(s.logs[0].request_body, s.calls.find(c => c.kind === 'vendor').body);
  assert.equal(s.success, 1);
});

test('Store falhando (leitura e escrita) com o log ligado: nenhuma cópia das chamadas da Store', async () => {
  const s = setup({
    headers: storeHeaders, data: storeOn, cookies: { __obref: ['ob-1'] },
    storeReadError: { reason: 'down' }, storeWriteError: { reason: 'down' }
  });
  await s.settle();
  assert.equal(s.logs.length, 1);
  assert.equal(s.logs[0].request_url, vendorUrl);
  assert.equal(s.success, 1);
});

test('evento que não chega à OpenAI (validação, consentimento, preview) não gera cópia', async () => {
  const invalid = setup({ data: { apiKey: '' } });
  const noConsent = setup({ data: { adStorageConsent: 'required' } });
  const preview = setup({ event: { event_name: 'purchase', page_location: 'https://gtm-msr.appspot.com/render' } });
  await Promise.all([invalid.settle(), noConsent.settle(), preview.settle()]);
  for (const s of [invalid, noConsent, preview]) {
    assert.equal(s.calls.length, 0);
    assert.equal(s.logs.length, 0);
  }
  assert.equal(invalid.failure, 1);
  assert.equal(noConsent.success, 1);
  assert.equal(preview.success, 1);
});

test('campo "Event type (System Log)" preenchido: event_type usa o campo; vazio: usa event_name', async () => {
  const filled = setup({ data: { systemLogEventType: 'compra-site' } });
  await filled.settle();
  assert.equal(filled.logs[0].event_type, 'compra-site');
  assert.equal(filled.logs[0].event_name, 'purchase');
  const empty = setup({ data: { systemLogEventType: '' } });
  await empty.settle();
  assert.equal(empty.logs[0].event_type, 'purchase');
  const advanced = empty.parameters.find(p => p.name === 'advancedGroup').subParams;
  const field = advanced[advanced.length - 1];
  assert.equal(field.name, 'systemLogEventType', 'último campo do grupo Advanced');
  assert.equal(field.type, 'TEXT');
  assert.equal(field.displayName, 'Event type (System Log)');
  assert.equal(field.simpleValueType, true);
  assert.equal(empty.parameters[empty.parameters.length - 1].name, 'advancedGroup', 'Advanced é o último grupo');
});

for (const [label, event] of [['ausente', { event_name: undefined }], ['não-string', { event_name: 42 }]]) {
  test('event_name ' + label + ': event_name e event_type vão como string vazia', async () => {
    const s = setup({ event: { ...require('./harness.cjs').baseEvent(), ...event } });
    await s.settle();
    assert.equal(s.logs[0].event_name, '');
    assert.equal(s.logs[0].event_type, '');
    assert.equal(s.success, 1);
  });
}

for (const mode of ['reject', 'throw', 'pending']) {
  test('coletor ' + mode + ': resultado e chamadas à OpenAI idênticos ao caso sem cópia, sem exceção', async () => {
    for (const options of [{ status: 200 }, { status: 503 }, { vendorError: { reason: 'timed_out' } },
      { status: 200, data: { optimistic: true } }]) {
      const off = setup({ ...options, headers: { 'x-wascer-log': undefined } });
      await off.settle();
      const on = setup({ ...options, collectorMode: mode });
      await on.settle();
      assert.equal(on.success, off.success);
      assert.equal(on.failure, off.failure);
      assert.equal(on.logs.length, 1);
      assert.deepEqual(on.calls.filter(c => c.kind !== 'collector'), off.calls);
    }
  });
}

test('x-wascer-log = "1" sem x-wascer-trace-id: a tag termina normalmente', async () => {
  const s = setup({ headers: { 'x-wascer-trace-id': undefined } });
  await s.settle();
  assert.equal(s.success, 1);
  assert.equal(s.failure, 0);
  assert.equal(s.logs[0].trace_id, '');
});

test('a cópia usa timeout de 500 ms e só o header Content-Type', async () => {
  const s = setup();
  await s.settle();
  const collector = s.calls[1];
  assert.equal(collector.options.timeout, 500);
  assert.deepEqual(collector.options.headers, { 'Content-Type': 'application/json' });
});

test('permissões: headers e URL do System Log liberados, sem alargar o resto', () => {
  const s = setup();
  const scope = s.permission('read_request');
  const names = scope.headerWhitelist.listItem.map(p => p.mapValue[0].string);
  assert.deepEqual(names, ['x-container-identifier', 'x-user-id', 'x-url-api', 'x-gtm-server-preview',
    'referer', 'x-wascer-log', 'x-wascer-trace-id']);
  assert.equal(scope.headerAccess.string, 'specific');
  const http = s.permission('send_http');
  assert.equal(http.allowedUrls.string, 'specific');
  assert.deepEqual(http.urls.listItem.map(i => i.string),
    ['https://bzr.openai.com/*', 'https://*.soureicdn.com/*', endpoint]);
  assert.equal(s.permission('read_event_data').eventDataAccess.string, 'any');
});

test('com a cópia desligada, tudo é idêntico ao template da main; ligada, a OpenAI recebe o mesmo', async () => {
  const cases = [
    {},
    { data: { validateOnly: true, eventNameStandard: 'page_viewed' } },
    { data: { optimistic: true, debug: true } },
    { data: { eventNameSource: 'custom', eventNameCustom: 'quote_requested' } },
    { data: { setOpprefCookie: true, setObrefCookie: true }, cookies: { __oppref: ['op-1'] } },
    { data: storeOn, headers: storeHeaders, cookies: { __obref: ['ob-1'] } },
    { data: storeOn, headers: storeHeaders, cookies: { __obref: ['ob-1'] }, storeReadError: { reason: 'down' } },
    { data: { apiKey: '' } },
    { status: 500, responseBody: 'boom', data: { debug: true } },
    { vendorError: { reason: 'timed_out' } }
  ];
  for (const options of cases) {
    const off = { ...options, headers: { ...options.headers, 'x-wascer-log': undefined } };
    const before = setup({ ...off, code: mainCode });
    const after = setup(off);
    const withLog = setup({ ...options, headers: { ...options.headers } });
    await Promise.all([before.settle(), after.settle(), withLog.settle()]);
    assert.deepEqual(after.calls, before.calls);
    assert.deepEqual(after.order, before.order);
    assert.deepEqual(after.cookies, before.cookies);
    assert.deepEqual(after.consoleLogs, before.consoleLogs);
    assert.equal(after.success, before.success);
    assert.equal(after.failure, before.failure);
    assert.deepEqual(withLog.calls.filter(c => c.kind !== 'collector'), before.calls,
      'ligar o log não muda as chamadas à OpenAI nem à Store');
    assert.equal(withLog.success, before.success);
    assert.equal(withLog.failure, before.failure);
    assert.deepEqual(withLog.cookies, before.cookies);
  }
});

// Emulação local dos cenários de ___TESTS___ (o runner de verdade é o editor do GTM).
const { scenarios, setup: setupCode } = readScenarios();
test('___TESTS___: os cenários foram lidos', () => {
  assert.ok(scenarios.length >= 21);
});
for (const scenario of scenarios) {
  test('___TESTS___ (emulado): ' + scenario.name, () => {
    runScenario(scenario, setupCode);
  });
}
