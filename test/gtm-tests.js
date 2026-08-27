// Roda o bloco ___TESTS___ do template.tpl fora do Tag Manager.
//
// Esse bloco e o que a revisao da galeria executa. O harness de test/run.js
// confere o contrato do nosso lado; este aqui confere que os cenarios escritos
// dentro do .tpl passam de verdade, em vez de irem para a submissao no escuro.
//
// Cobre o que um template de VARIAVEL usa: runCode, assertThat e fail. Tag usa
// mais coisa (mock, mockData, assertApi), que entra quando for preciso.
const { runVariable, createSandbox } = require('./sandbox');

// Le o bloco `setup: |-`, que o Tag Manager roda antes de cada cenario.
function parseSetup(tpl) {
  const start = tpl.indexOf('___TESTS___');
  if (start === -1) return '';
  const rest = tpl.slice(start + '___TESTS___'.length);
  const end = rest.search(/^___[A-Z_]+___$/m);
  const lines = (end === -1 ? rest : rest.slice(0, end)).split('\n');

  const code = [];
  let collecting = false;
  lines.forEach((line) => {
    if (/^setup: \|-?\s*$/.test(line)) {
      collecting = true;
      return;
    }
    if (!collecting) return;
    if (line.trim() === '') {
      code.push('');
      return;
    }
    const indented = line.match(/^ {2}(.*)$/);
    if (indented) code.push(indented[1]);
    else collecting = false;
  });
  return code.join('\n').trim();
}

// Le os cenarios do bloco ___TESTS___. O formato e sempre o mesmo, gerado pelo
// editor do Tag Manager: uma lista de `- name:` com um `code: |-` indentado.
function parseScenarios(tpl) {
  const start = tpl.indexOf('___TESTS___');
  if (start === -1) return [];
  const rest = tpl.slice(start + '___TESTS___'.length);
  const end = rest.search(/^___[A-Z_]+___$/m);
  const block = (end === -1 ? rest : rest.slice(0, end)).split('\n');

  const scenarios = [];
  let current = null;
  let collecting = false;

  block.forEach((line) => {
    const header = line.match(/^- name: (.*)$/);
    if (header) {
      if (current) scenarios.push(current);
      current = { name: header[1].trim(), code: [] };
      collecting = false;
      return;
    }
    if (!current) return;
    if (/^\s+code: \|-?\s*$/.test(line)) {
      collecting = true;
      return;
    }
    if (collecting) {
      if (line.trim() === '') {
        current.code.push('');
        return;
      }
      const indented = line.match(/^ {4}(.*)$/);
      if (indented) current.code.push(indented[1]);
      else collecting = false;
    }
  });
  if (current) scenarios.push(current);

  return scenarios.map((s) => ({ name: s.name, code: s.code.join('\n').trim() }));
}

function deepEquals(a, b) {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null || typeof a !== 'object') return a === b;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a),
    kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  return ka.every((k) => deepEquals(a[k], b[k]));
}

const show = (v) => (v === undefined ? 'undefined' : JSON.stringify(v));

function makeAssertThat(subject, label) {
  const fail = (expectation) => {
    throw new Error(
      (label ? label + ': ' : '') + 'esperado ' + expectation + ', recebido ' + show(subject)
    );
  };
  return {
    isEqualTo: (expected) => {
      if (!deepEquals(subject, expected)) fail(show(expected));
    },
    isNotEqualTo: (expected) => {
      if (deepEquals(subject, expected)) fail('diferente de ' + show(expected));
    },
    isStrictlyEqualTo: (expected) => {
      if (subject !== expected) fail('identico a ' + show(expected));
    },
    isNotStrictlyEqualTo: (expected) => {
      if (subject === expected) fail('nao identico a ' + show(expected));
    },
    isUndefined: () => {
      if (subject !== undefined) fail('undefined');
    },
    isDefined: () => {
      if (subject === undefined) fail('um valor definido');
    },
    isNull: () => {
      if (subject !== null) fail('null');
    },
    isNotNull: () => {
      if (subject === null) fail('nao null');
    },
    isTrue: () => {
      if (subject !== true) fail('true');
    },
    isFalse: () => {
      if (subject !== false) fail('false');
    },
    isArray: () => {
      if (!Array.isArray(subject)) fail('um array');
    },
    isObject: () => {
      if (subject === null || typeof subject !== 'object' || Array.isArray(subject))
        fail('um objeto');
    },
    isString: () => {
      if (typeof subject !== 'string') fail('uma string');
    },
    isNumber: () => {
      if (typeof subject !== 'number') fail('um numero');
    },
    isBoolean: () => {
      if (typeof subject !== 'boolean') fail('um booleano');
    },
    isLessThan: (n) => {
      if (!(subject < n)) fail('menor que ' + show(n));
    },
    isGreaterThan: (n) => {
      if (!(subject > n)) fail('maior que ' + show(n));
    },
    contains: (...items) => {
      items.forEach((item) => {
        const found = (subject || []).some
          ? subject.some((entry) => deepEquals(entry, item))
          : false;
        if (!found) fail('conter ' + show(item));
      });
    }
  };
}

// Roda todos os cenarios de um template de variavel.
function runVariableScenarios(source, tpl, env) {
  const scenarios = parseScenarios(tpl);
  const results = [];

  scenarios.forEach((scenario) => {
    const runCode = (mockData) => runVariable(source, mockData || {}, env).value;
    const assertThat = (subject, label) => makeAssertThat(subject, label);
    const failNow = (message) => {
      throw new Error(message || 'fail()');
    };
    const log = () => {};

    try {
      new Function('runCode', 'assertThat', 'fail', 'log', scenario.code)(
        runCode,
        assertThat,
        failNow,
        log
      );
      results.push({ name: scenario.name, ok: true });
    } catch (e) {
      results.push({ name: scenario.name, ok: false, error: e.message });
    }
  });

  return results;
}

// ---- Modo tag --------------------------------------------------------------
// Um template de TAG nao devolve valor: ele chama APIs. O cenario confere o
// que saiu com assertApi, e troca o que quiser com mock. O runCode aqui e
// sincrono, como dentro do Tag Manager, entao um mock de sendHttpRequest tem
// que responder na hora, que e o que resolvedRequest faz no bloco de setup.
function runTagScenarios(source, tpl, env) {
  const scenarios = parseScenarios(tpl);
  const setup = parseSetup(tpl);
  const results = [];

  scenarios.forEach((scenario) => {
    const mocks = {};
    const calls = {};
    const record = (name, args) => {
      if (!calls[name]) calls[name] = [];
      calls[name].push(args);
    };

    // Guarda o valor cru. Quem decide se ele vira funcao e o sandbox, que sabe
    // se a API original e funcao (getAllEventData) ou objeto (templateStorage).
    const mock = (name, replacement) => {
      mocks[name] = replacement;
    };

    const runCode = (data) => {
      const built = createSandbox(Object.assign({}, env, { mocks: mocks }));
      const api = built.api;

      // Cada API passa por um gravador antes de chegar no template.
      const watched = {};
      Object.keys(api).forEach((name) => {
        const original = api[name];
        watched[name] =
          typeof original === 'function'
            ? function () {
                const args = [];
                for (let i = 0; i < arguments.length; i++) args.push(arguments[i]);
                record(name, args);
                return original.apply(null, args);
              }
            : original;
      });

      const tagData = Object.assign({}, data || {}, {
        gtmOnSuccess: (...args) => record('gtmOnSuccess', args),
        gtmOnFailure: (...args) => record('gtmOnFailure', args)
      });

      const fakeRequire = (name) => {
        if (!(name in watched)) throw new Error('API nao disponivel no sandbox: ' + name);
        return watched[name];
      };

      new Function('require', 'data', source)(fakeRequire, tagData);
      return undefined;
    };

    const assertApi = (name) => ({
      wasCalled: () => {
        if (!calls[name]) throw new Error(name + ' nao foi chamada');
      },
      wasNotCalled: () => {
        if (calls[name]) throw new Error(name + ' foi chamada ' + calls[name].length + ' vez(es)');
      },
      wasCalledWith: (...expected) => {
        const found = (calls[name] || []).some((args) => deepEquals(args, expected));
        if (!found) {
          throw new Error(
            name + ' nao foi chamada com ' + show(expected) + '. Chamadas: ' + show(calls[name])
          );
        }
      }
    });

    try {
      // O codigo do bloco de teste tambem pode dar require nas APIs, como
      // dentro do Tag Manager.
      const testRequire = (name) => {
        const built = createSandbox(Object.assign({}, env, { mocks: mocks }));
        if (!(name in built.api)) throw new Error('API nao disponivel no sandbox: ' + name);
        return built.api[name];
      };

      new Function(
        'runCode',
        'assertThat',
        'assertApi',
        'fail',
        'log',
        'mock',
        'require',
        setup + '\n' + scenario.code
      )(
        runCode,
        (subject, label) => makeAssertThat(subject, label),
        assertApi,
        (message) => {
          throw new Error(message || 'fail()');
        },
        () => {},
        mock,
        testRequire
      );
      results.push({ name: scenario.name, ok: true });
    } catch (e) {
      results.push({ name: scenario.name, ok: false, error: e.message });
    }
  });

  return results;
}

module.exports = { runVariableScenarios, runTagScenarios, parseScenarios, parseSetup, deepEquals };
