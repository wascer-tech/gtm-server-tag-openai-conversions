'use strict';
// Runs the sandboxed server code of template.tpl in node:vm with permission-aware
// API doubles. Not a Google sandbox compiler and not proof of live sGTM delivery.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const endpoint = 'https://system-log.wascer.internal/log';
const vendorUrl = 'https://bzr.openai.com/v1/events?pid=px-1';
const traceId = '12345678-1234-4234-8234-123456789abc';
const templatePath = path.resolve(__dirname, '../template.tpl');

function section(text, name) {
  return text.split('___' + name + '___')[1].split(/___[A-Z_]+___/)[0].trim();
}

function readTemplate() {
  const text = fs.readFileSync(templatePath, 'utf8');
  return {
    info: JSON.parse(section(text, 'INFO')),
    parameters: JSON.parse(section(text, 'TEMPLATE_PARAMETERS')),
    permissions: JSON.parse(section(text, 'SERVER_PERMISSIONS')),
    code: section(text, 'SANDBOXED_JS_FOR_SERVER'),
    tests: section(text, 'TESTS')
  };
}

function permissionOf(permissions, name) {
  const entry = permissions.find(p => p.instance.key.publicId === name);
  assert.ok(entry, 'template lacks permission ' + name);
  return Object.fromEntries(entry.instance.param.map(p => [p.key, p.value]));
}

function urlAllowed(permissions, url) {
  const scope = permissionOf(permissions, 'send_http');
  if (scope.allowedUrls.string === 'any') return true;
  return scope.urls.listItem.some((item) => {
    const pattern = item.string.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
    return new RegExp('^' + pattern + '$').test(url);
  });
}

function headerAllowed(permissions, key) {
  const scope = permissionOf(permissions, 'read_request');
  return scope.headerAccess.string === 'any' ||
    scope.headerWhitelist.listItem.some(p => p.mapValue.some(v => v.string === key));
}

const safeJSON = {
  stringify: JSON.stringify,
  parse(value) { try { return JSON.parse(value); } catch (e) { return undefined; } }
};

// Doubles with no state of their own. The stateful ones are built per run.
function pureApis() {
  let random = 0;
  return {
    JSON: safeJSON,
    Math,
    Object,
    Promise: { create: fn => new Promise(fn), all: Promise.all.bind(Promise) },
    getType: value => value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value,
    makeString: value => String(value),
    makeInteger: value => parseInt(value, 10),
    makeNumber: value => Number(value),
    encodeUriComponent: encodeURIComponent,
    decodeUriComponent(value) { try { return decodeURIComponent(value); } catch (e) { return undefined; } },
    sha256Sync: value => crypto.createHash('sha256').update(value, 'utf8').digest('hex'),
    generateRandom: (min, max) => min + (random++ % (max - min + 1)),
    computeEffectiveTldPlusOne: value => new URL(value).hostname.split('.').slice(-2).join('.'),
    parseUrl(value) {
      try {
        const url = new URL(value);
        return { hostname: url.hostname, searchParams: Object.fromEntries(url.searchParams) };
      } catch (e) { return undefined; }
    }
  };
}

function kindOf(url) {
  if (url === endpoint) return 'collector';
  if (url.indexOf('/database/get') !== -1) return 'storeRead';
  if (url.indexOf('/database/collections/') !== -1) return 'storeWrite';
  return 'vendor';
}

function baseEvent() {
  return {
    event_name: 'purchase', event_id: 'evt-1',
    page_location: 'https://shop.example.com/checkout',
    ip_override: '203.0.113.10', user_agent: 'Mozilla/5.0', user_id: 'user-1',
    currency: 'USD', value: 25.98,
    user_data: { email_address: ' Person@Example.com ', address: { city: ' Sao Paulo ', postal_code: '01311-000', country: 'br' } },
    items: [{ item_id: 'sku-1', item_name: 'Shirt', quantity: 2, price: 12.99 }]
  };
}

function baseData() {
  return {
    pixelId: 'px-1', apiKey: 'key-secret-1', eventNameSource: 'standard', eventNameStandard: 'order_created',
    actionSource: 'web', validateOnly: false, autoMapEventData: true, autoMapUserData: true,
    useStore: false, storeCollection: 'openai_ads', storeKeySource: 'obref', storeRead: true, storeWrite: true,
    setOpprefCookie: false, setObrefCookie: false, cookieDomain: 'auto', cookieSameSite: 'Lax',
    opprefExpiration: '30', obrefExpiration: '365', adStorageConsent: 'notRequired',
    debug: false, optimistic: false
  };
}

// options.code runs another program (e.g. the fixture from main) against the same doubles.
function setup(options = {}) {
  const template = readTemplate();
  const permissions = template.permissions;
  const permission = name => permissionOf(permissions, name);
  const calls = [], logs = [], consoleLogs = [], cookies = [], order = [];
  let success = 0, failure = 0, completeVendor;
  let now = 1000;
  const event = options.event || baseEvent();
  const headers = { 'x-wascer-log': '1', 'x-wascer-trace-id': traceId, ...options.headers };
  const data = {
    ...baseData(), ...options.data,
    gtmOnSuccess() { success++; order.push('gtmOnSuccess'); },
    gtmOnFailure() { failure++; order.push('gtmOnFailure'); }
  };
  function sendHttpRequest(url, httpOptions, body) {
    assert.equal(typeof httpOptions, 'object', 'uses documented promise API');
    assert.ok(urlAllowed(permissions, url), 'send_http denied ' + url);
    const kind = kindOf(url);
    calls.push({ kind, url, options: structuredClone(httpOptions), body }); // clone: vm objects have another prototype
    order.push(kind);
    if (kind === 'collector') {
      logs.push(JSON.parse(body));
      if (options.collectorMode === 'throw') throw new Error('collector synchronous error');
      if (options.collectorMode === 'pending') return new Promise(() => {});
      if (options.collectorMode === 'reject') return Promise.reject({ reason: 'failed' });
      return Promise.resolve({ statusCode: 202, body: '' });
    }
    if (kind === 'storeRead') {
      if (options.storeReadError) return Promise.reject(options.storeReadError);
      return Promise.resolve({ statusCode: 200, body: JSON.stringify({ data: options.stored || { oppref: 'op-from-store' } }) });
    }
    if (kind === 'storeWrite') {
      if (options.storeWriteError) return Promise.reject(options.storeWriteError);
      return Promise.resolve({ statusCode: options.storeWriteStatus || 201, body: '{"stored":true}' });
    }
    return new Promise((resolve, reject) => {
      completeVendor = () => {
        now += 37;
        if (options.vendorError) reject(options.vendorError);
        else resolve({
          statusCode: options.status === undefined ? 200 : options.status,
          body: options.responseBody === undefined ? '{"ok":true}\n' : options.responseBody,
          headers: { authorization: 'response-credential-never-copy' }
        });
      };
      if (!options.vendorPending) completeVendor();
    });
  }
  const apis = {
    ...pureApis(),
    sendHttpRequest,
    getRequestHeader(key) {
      assert.ok(headerAllowed(permissions, key), 'read_request denied ' + key);
      return headers[key];
    },
    getAllEventData() { assert.equal(permission('read_event_data').eventDataAccess.string, 'any'); return structuredClone(event); },
    getEventData(key) {
      assert.equal(permission('read_event_data').eventDataAccess.string, 'any');
      return key.split('.').reduce((value, part) => value ? value[part] : undefined, event);
    },
    getCookieValues: name => (options.cookies && options.cookies[name]) || [],
    setCookie: (name, value, cookieOptions) => cookies.push({ name, value, options: structuredClone(cookieOptions) }),
    getTimestampMillis: () => now,
    logToConsole: (...args) => consoleLogs.push(JSON.parse(JSON.stringify(args)))
  };
  const context = vm.createContext({
    data,
    require(name) { assert.ok(name in apis, 'unexpected sandbox API: ' + name); return apis[name]; }
  });
  const code = options.code === undefined ? template.code : options.code;
  new vm.Script('(function(){\n' + code + '\n})()').runInContext(context, { timeout: 1000 });
  return {
    calls, logs, consoleLogs, cookies, order, data, info: template.info, parameters: template.parameters,
    permissions, permission,
    get success() { return success; }, get failure() { return failure; },
    completeVendor: () => completeVendor(),
    async settle() { for (let i = 0; i < 30; i++) await Promise.resolve(); }
  };
}

// ___TESTS___ emulation: the scenarios are written for the GTM template editor. This
// runs them against the same doubles so a change that breaks one shows up locally.
// It is an approximation of the editor's test runner, not a replacement for it.
function readScenarios() {
  const lines = readTemplate().tests.split('\n');
  const scenarios = [];
  let setupCode = '', target = null;
  for (const line of lines) {
    const name = /^- name: (.*)$/.exec(line);
    if (name) { target = { name: name[1], code: [] }; scenarios.push(target); continue; }
    if (line === 'setup: |-') { target = { code: [] }; setupCode = target; continue; }
    if (line === 'scenarios:' || line === '  code: |-') continue;
    assert.ok(target, 'unexpected line in ___TESTS___: ' + line);
    target.code.push(line.replace(/^ {2,4}/, ''));
  }
  return { scenarios: scenarios.map(s => ({ name: s.name, code: s.code.join('\n') })), setup: setupCode.code.join('\n') };
}

function runScenario(scenario, setupCode, code) {
  const template = readTemplate();
  const mocks = {}, called = {};
  const hit = name => { called[name] = (called[name] || 0) + 1; };
  const defaults = {
    ...pureApis(),
    getAllEventData: () => ({}), getEventData: () => undefined, getRequestHeader: () => undefined,
    getCookieValues: () => [], setCookie() {}, logToConsole() {},
    getTimestampMillis: () => 1700000000000,
    sendHttpRequest: () => Promise.resolve({ statusCode: 200, body: '' })
  };
  function sandboxRequire(name) {
    assert.ok(name in defaults, 'unexpected sandbox API: ' + name);
    if (typeof defaults[name] !== 'function' || name === 'Object') return defaults[name];
    return function () {
      hit(name);
      if (name === 'getRequestHeader' && !(name in mocks)) {
        assert.ok(headerAllowed(template.permissions, arguments[0]), 'read_request denied ' + arguments[0]);
      }
      return (mocks[name] || defaults[name]).apply(null, arguments);
    };
  }
  const context = vm.createContext({
    require: sandboxRequire,
    mock(name, fn) { mocks[name] = fn; },
    runCode(data) {
      const tagData = Object.assign({}, data, {
        gtmOnSuccess() { hit('gtmOnSuccess'); }, gtmOnFailure() { hit('gtmOnFailure'); }
      });
      const inner = vm.createContext({ data: tagData, require: sandboxRequire });
      new vm.Script('(function(){\n' + (code === undefined ? template.code : code) + '\n})()').runInContext(inner, { timeout: 1000 });
    },
    assertThat(actual) {
      return { isEqualTo(expected) { assert.deepEqual(structuredClone(actual), structuredClone(expected)); } };
    },
    assertApi(name) {
      return {
        wasCalled() { assert.ok(called[name] > 0, name + ' was not called'); },
        wasNotCalled() { assert.ok(!called[name], name + ' was called'); }
      };
    }
  });
  new vm.Script('(function(){\n' + setupCode + '\n' + scenario.code + '\n})()').runInContext(context, { timeout: 2000 });
}

module.exports = { setup, readTemplate, readScenarios, runScenario, baseEvent, endpoint, vendorUrl, traceId };
