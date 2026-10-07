const fs = require('fs');
const src = fs.readFileSync('/home/user/free-does/index.html', 'utf8');
const js = src.match(/<script>([\s\S]*)<\/script>/)[1];
const i = js.indexOf('const soDig ='), j = js.indexOf('/* --- fluxo --- */');
eval(js.slice(i, j) + '\nglobalThis.masc = masc; globalThis.soDig = soDig;');

const num = v => { if(v==null) return NaN;
  return parseFloat(String(v).replace(/[^\d,.-]/g,'').replace(/\.(?=\d{3}(\D|$))/g,'').replace(',','.')); };
const brl = v => { const n=num(v); if(isNaN(n)) return null;
  return "R$ "+n.toFixed(2).replace('.',',').replace(/\B(?=(\d{3})+(?!\d))/g,'.'); };

let ok=0, fail=0;
function t(nome, cond, extra){ if(cond){ ok++; console.log("  OK   "+nome); } else { fail++; console.log("  FALHA "+nome, extra===undefined?"":extra); } }

console.log("== CPF ==");
t("CPF válido (529.982.247-25)", cpfValido("529.982.247-25"));
t("CPF válido (111.444.777-35)", cpfValido("11144477735"));
t("CPF inválido (111.111.111-11)", !cpfValido("111.111.111-11"));
t("CPF inválido (123.456.789-00)", !cpfValido("12345678900"));

console.log("== PIX: a API é usada apenas para PIX ==");
t("funções de cartão removidas do site", typeof luhn === 'undefined' && typeof bandeiraDe === 'undefined' && typeof parcelaValor === 'undefined');

console.log("== boot e sincronização (regressões) ==");
const bruto = src;
t("sbBoot e finBoot rodam no boot", /renderVitrine\(\); renderAdmin\(\); renderAuth\(\); preencherVendedor\(\);\n  sbBoot\(\); finBoot\(\);/.test(bruto));
t("cloudCarregar volta a renderizar a tela", /garantirIds\(\);\n    renderVitrine\(\)/.test(bruto));
t("bloco sbBoot não ficou preso dentro do cloudCarregar", !/garantirIds\(\);\n  renderVitrine/.test(bruto));

console.log("== Idade ==");
const h=new Date();
t("nasc 18 anos exatos hoje", idadeDe(`01/01/${h.getFullYear()-18}`).idade===18);
t("nasc 31/12/ano-17 => 16 anos hoje", idadeDe(`31/12/${h.getFullYear()-17}`).idade===16);
t("data futura rejeitada", idadeDe(`01/01/${h.getFullYear()+1}`)===null);
t("31/02 inválido rejeitado", idadeDe("31/02/2000")===null);
t("formato errado rejeitado", idadeDe("2000-01-01")===null);
t("texto vira null", idadeDe("abacaxi")===null);

console.log("== Máscaras ==");
t("cpf 12345678909 -> 123.456.789-09", masc.cpf("12345678909")==="123.456.789-09", masc.cpf("12345678909"));
t("nasc 05082001 -> 05/08/2001", masc.nasc("05082001")==="05/08/2001", masc.nasc("05082001"));
t("tel 85999998888 -> (85) 99999-8888", masc.tel("85999998888")==="(85) 99999-8888", masc.tel("85999998888"));
t("tel fixo 8532223344", masc.tel("8532223344")==="(85) 3222-3344", masc.tel("8532223344"));
t("cep 60000000 -> 60000-000", masc.cep("60000000")==="60000-000");
t("máscaras de cartão não existem mais", masc.cartao === undefined && masc.validade === undefined && masc.cvv === undefined);

console.log("\nRESULTADO: "+ok+" passaram, "+fail+" falharam");
process.exit(fail?1:0);
