/* Auditoria de interface: emojis, ids, refs, tags, gradientes, ícones */
const fs = require('fs');
const h = fs.readFileSync('/home/user/free-does/index.html', 'utf8');
let ok = 0, fail = 0;
const t = (n, c, e) => { c ? (ok++, console.log('  OK   ' + n)) : (fail++, console.log('  FALHA ' + n, e === undefined ? '' : JSON.stringify(e))); };

console.log('== emojis e pictogramas ==');
const emo = h.match(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}\u{200D}]/gu) || [];
t('nenhum emoji no site', emo.length === 0, emo.slice(0, 8));

console.log('== cores e estilo ==');
t('sem gradientes', !/gradient/i.test(h));
t('paleta vermelho/preto/branco por variáveis', /--red:#c22f24/.test(h) && /--ink:#1a1411/.test(h) && /--bg:#f7f2ec/.test(h));
const inlineBranco = (h.match(/style="[^"]*color:\s*#fff/g) || []).length;
t('nenhum texto branco em superfície clara (inline)', inlineBranco === 0, inlineBranco);

console.log('== estrutura ==');
const ids = [...h.matchAll(/id="([^"]+)"/g)].map(m => m[1]);
const dup = ids.filter((x, i) => ids.indexOf(x) !== i);
t('nenhum id duplicado', dup.length === 0, dup);
const refs = [...h.matchAll(/\$\('([^']+)'\)/g)].map(m => m[1]);
const quebradas = [...new Set(refs.filter(r => !ids.includes(r)))];
t('nenhum $() apontando para id inexistente', quebradas.length === 0, quebradas);
['div','section','button','select','textarea','header','footer','nav','article','dl','small','b'].forEach(tag => {
  const o = (h.match(new RegExp('<' + tag + '[\\s>]', 'gi')) || []).length;
  const c = (h.match(new RegExp('</' + tag + '>', 'gi')) || []).length;
  t('tags ' + tag + ' balanceadas', o === c, [o, c]);
});

console.log('== ícones ==');
const placeholders = (h.match(/data-ic="([a-z]+)"/g) || []).map(x => x.split('"')[1]);
const nomes = [...h.matchAll(/^\s*([a-z]+): '<svg/gm)].map(m => m[1]);
const semIcone = [...new Set(placeholders.filter(p => !nomes.includes(p)))];
t('todo data-ic tem um ícone definido', semIcone.length === 0, semIcone);
t('ícones usados também no JS', /ICO\.(bag|user|doc|trash|check|edit)/.test(h));
t('pintarIcones é chamado', /function pintarIcones/.test(h) && /pintarIcones\(\);/.test(h));

console.log('== segurança e privacidade ==');
t('nenhuma chave do Asaas no site', !/aact_/.test(h));
t('sem campos de cartão', !/id="cNumCartao"|id="cCvv"|id="cTitular"|id="cParc"/.test(h));
t('senha do painel continua adm', /SENHA_ADM = "adm"/.test(h));
const semConta = h.replace(/data-abrir-registro/g, '');
t('nenhuma dica do acesso secreto no site', !/9 toques|9 vezes|9 cliques|toques no logo|espaço 9/i.test(semConta));
t('nenhuma dica do acesso secreto nos comentários', !/gatilho secreto|toques\/cliques|9 toques/i.test(semConta));

console.log('== boot ==');
t('render inicial no DOMContentLoaded', /renderVitrine\(\); renderAdmin\(\); renderAuth\(\); preencherVendedor\(\);\n  sbBoot\(\); finBoot\(\);/.test(h));
t('garantirIds seguido de nova renderização', /garantirIds\(\);\n    renderVitrine\(\)/.test(h));

console.log('\nRESULTADO: ' + ok + ' passaram, ' + fail + ' falharam');
process.exit(fail ? 1 : 0);
