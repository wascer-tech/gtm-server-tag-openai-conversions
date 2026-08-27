// Roda os cenarios do bloco ___TESTS___ do template.tpl fora do container.
//
// Este template ja esta publicado na galeria, e o bloco foi escrito no escuro:
// o Tag Manager rodava, a gente nao. Aqui ele roda no shim, que e o mesmo dos
// outros templates da casa.
const fs = require('fs');
const path = require('path');
const { runTagScenarios } = require('./gtm-tests');

const ROOT = path.join(__dirname, '..');
const TPL = fs.readFileSync(path.join(ROOT, 'template.tpl'), 'utf8');

function extractJs(tpl) {
  const marker = '___SANDBOXED_JS_FOR_SERVER___';
  const start = tpl.indexOf(marker);
  const rest = tpl.slice(start + marker.length);
  const end = rest.search(/^___[A-Z_]+___$/m);
  return rest.slice(0, end);
}

const results = runTagScenarios(extractJs(TPL), TPL);
let fail = 0;

results.forEach((scenario) => {
  if (scenario.ok) return;
  fail++;
  console.log('  FALHOU  ' + scenario.name);
  console.log('     ' + scenario.error);
});

console.log('');
console.log(
  (fail === 0 ? 'OK' : 'FALHAS') +
    '  ' +
    (results.length - fail) +
    ' cenarios passaram, ' +
    fail +
    ' falharam'
);
process.exit(fail === 0 ? 0 : 1);
