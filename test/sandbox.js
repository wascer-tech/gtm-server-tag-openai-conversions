// Shim das APIs do sandbox do GTM server, para rodar o template.js fora do
// container. Nao e um emulador completo: cobre o que a tag usa, e o suficiente
// para conferir o payload que sai antes de subir num container de verdade.
const crypto = require('crypto');

function getType(v) {
  if (v === null) return 'null';
  if (v === undefined) return 'undefined';
  if (Array.isArray(v)) return 'array';
  return typeof v;
}

function makeString(v) {
  if (v === null || v === undefined) return '';
  return String(v);
}

// Lista curta de sufixos com dois rotulos, suficiente para os dominios de teste.
const TWO_LABEL = ['com.br', 'co.uk', 'com.ar', 'com.mx', 'co.jp'];

function computeEffectiveTldPlusOne(host) {
  if (!host) return '';
  const parts = host.split('.');
  for (const suffix of TWO_LABEL) {
    if (host.endsWith('.' + suffix) || host === suffix) {
      return parts.slice(-3).join('.');
    }
  }
  return parts.slice(-2).join('.');
}

function parseUrl(url) {
  let u;
  try { u = new URL(url); } catch (e) { return undefined; }
  const searchParams = {};
  u.searchParams.forEach((value, key) => { searchParams[key] = value; });
  return {
    href: u.href, protocol: u.protocol, hostname: u.hostname,
    port: u.port, pathname: u.pathname, search: u.search,
    hash: u.hash, origin: u.origin, searchParams
  };
}

// Constroi o ambiente para uma execucao. `env` traz eventData, cookies,
// headers e o modo de envio.
function createSandbox(env) {
  const captured = { requests: [], cookies: [], logs: [], promises: [] };
  let clock = env.nowMillis || 1756231200000;

  const api = {
    computeEffectiveTldPlusOne,
    createRegex: (pattern, flags) => new RegExp(pattern, flags),
    decodeUriComponent: (v) => { try { return decodeURIComponent(v); } catch (e) { return v; } },
    encodeUriComponent: (v) => encodeURIComponent(v),
    toBase64: (v) => Buffer.from(v, 'utf8').toString('base64'),
    fromBase64: (v) => { try { return Buffer.from(v, 'base64').toString('utf8'); } catch (e) { return ''; } },
    testRegex: (re, str) => {
      const fresh = new RegExp(re.source, re.flags.replace('g', ''));
      return fresh.test(makeString(str));
    },
    generateRandom: (min, max) => min + Math.floor((env.random || 0.42) * (max - min)),
    getAllEventData: () => JSON.parse(JSON.stringify(env.eventData || {})),
    getEventData: (path) => (env.eventData || {})[path],
    // Espelha o contrato do GTM: getCookieValues(name[, noDecode]) e
    // setCookie(name, value[, options[, noEncode]]), ambos com default false.
    getCookieValues: (name, noDecode) => {
      const v = (env.cookies || {})[name];
      if (v === undefined) return [];
      return [noDecode ? v : decodeURIComponent(v)];
    },
    getRequestHeader: (name) => (env.headers || {})[name.toLowerCase()],
    getTimestampMillis: () => clock,
    getType,
    JSON: { parse: JSON.parse, stringify: JSON.stringify },
    // O sandbox nao expoe Object direto: quem quiser tem que dar require,
    // inclusive dentro do bloco ___TESTS___.
    Object: {
      keys: (o) => Object.keys(o),
      values: (o) => Object.values(o),
      entries: (o) => Object.entries(o),
      freeze: (o) => Object.freeze(o),
      delete: (o, key) => {
        delete o[key];
      }
    },
    logToConsole: (...args) => { captured.logs.push(args); if (env.verbose) console.log('   [log]', ...args); },
    makeInteger: (v) => {
      const n = Number(v);
      return n < 0 ? Math.ceil(n) : Math.floor(n);
    },
    makeNumber: (v) => Number(v),
    makeString,
    Math: { round: Math.round, floor: Math.floor, ceil: Math.ceil, abs: Math.abs, max: Math.max, min: Math.min, pow: Math.pow, sqrt: Math.sqrt },
    parseUrl,
    Promise: Object.assign(
      { all: (p) => Promise.all(p), create: (fn) => new Promise(fn) },
      {}
    ),
    sendHttpRequest: (url, options, body) => {
      captured.requests.push({ url, options, body: body ? JSON.parse(body) : undefined });
      const p = env.live ? env.live(url, options, body)
        : Promise.resolve({ statusCode: 200, headers: {}, body: '{"events_received":1}' });
      captured.promises.push(p);
      return p;
    },
    setCookie: (name, value, options, noEncode) => {
      captured.cookies.push({ name, value, options, stored: noEncode ? value : encodeURIComponent(value) });
    },
    sha256Sync: (input, options) => {
      const hex = crypto.createHash('sha256').update(input, 'utf8').digest('hex');
      return options && options.outputEncoding === 'base64'
        ? Buffer.from(hex, 'hex').toString('base64') : hex;
    }
  };

  // O bloco ___TESTS___ troca uma API por outra com mock(). A troca entra por
  // cima do shim, do mesmo jeito.
  // mock(nome, valor) do bloco ___TESTS___. Funcao entra como esta. Valor cru
  // entra como esta quando a API e um objeto, tipo templateStorage, e vira
  // funcao que devolve o valor quando a API e uma funcao, tipo getAllEventData.
  Object.keys(env.mocks || {}).forEach((name) => {
    const replacement = env.mocks[name];
    if (typeof replacement === 'function' || typeof api[name] !== 'function') {
      api[name] = replacement;
    } else {
      api[name] = () => replacement;
    }
  });

  return { api, captured };
}

// Roda o template.js como o GTM roda: com `require` e `data` injetados e
// `return` permitido no topo.
function runTemplate(source, data, env) {
  const { api, captured } = createSandbox(env);
  const result = { success: false, failure: false, captured };

  const fakeRequire = (name) => {
    if (!(name in api)) throw new Error('API nao disponivel no sandbox: ' + name);
    return api[name];
  };

  const tagData = Object.assign({}, data, {
    gtmOnSuccess: () => { result.success = true; },
    gtmOnFailure: (e) => { result.failure = true; result.failureReason = e; }
  });

  const fn = new Function('require', 'data', source);
  let pending;
  try { pending = fn(fakeRequire, tagData); }
  catch (e) { result.error = e; return Promise.resolve(result); }

  // A tag nao devolve a promise final, entao esperamos os envios e deixamos
  // a fila de microtasks drenar antes de ler gtmOnSuccess/gtmOnFailure.
  return Promise.resolve(pending)
    .then(() => Promise.allSettled(captured.promises))
    .then(() => flush())
    .then(() => result, (e) => { result.error = e; return result; });
}

function flush() {
  let chain = Promise.resolve();
  for (let i = 0; i < 6; i++) chain = chain.then(() => new Promise((r) => setImmediate(r)));
  return chain;
}

// Uma variavel (`"type": "MACRO"`) devolve valor em vez de chamar
// gtmOnSuccess. O harness compartilhado usa esta porta.
function runVariable(source, data, env) {
  const { api, captured } = createSandbox(env || {});
  const fakeRequire = (name) => {
    if (!(name in api)) throw new Error('API nao disponivel no sandbox: ' + name);
    return api[name];
  };
  return { value: new Function('require', 'data', source)(fakeRequire, Object.assign({}, data)), captured };
}

module.exports = {
  runTemplate,
  runVariable,
  createSandbox,
  getType,
  computeEffectiveTldPlusOne,
  parseUrl
};
