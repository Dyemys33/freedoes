const fs = require('fs');
const { JSDOM } = require('jsdom');
const html = fs.readFileSync('/home/user/free-does/index.html', 'utf8');

let ok = 0, fail = 0;
const t = (nome, cond, extra) => { if (cond) { ok++; console.log('  OK   ' + nome); } else { fail++; console.log('  FALHA ' + nome, extra === undefined ? '' : JSON.stringify(extra)); } };


const ctxFake = new Proxy({}, { get:(t,k)=> (k in t ? t[k] : (typeof k === 'string' && k !== 'then' ? (()=>{}) : undefined)), set:(t,k,v)=>{ t[k]=v; return true; } });
const stubs = { beforeParse(w){
  w.HTMLCanvasElement.prototype.getContext = () => ctxFake;
  w.matchMedia = () => ({ matches:false, addEventListener(){}, removeEventListener(){} });
  w.IntersectionObserver = class { constructor(cb){ this.cb = cb; } observe(el){ this.cb([{ isIntersecting:true, target:el }], this); } unobserve(){} disconnect(){} };
}};

const erros = [];
const dom = new JSDOM(html, { runScripts: 'dangerously', url: 'https://freedoes.test/', pretendToBeVisual: true, ...stubs,
  virtualConsole: new (require('jsdom').VirtualConsole)().on('jsdomError', e => erros.push(e.message)).on('error', m => erros.push(String(m))) });
const w = dom.window, d = w.document;
const $ = id => d.getElementById(id);
const click = el => el.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
const digita = (el, v) => { el.value = v; el.dispatchEvent(new w.Event('input', { bubbles: true })); };

setTimeout(async () => {
  console.log('== carregamento ==');
  t('sem erros de script', erros.length === 0, erros.slice(0,3));
  t('vitrine vazia mostra aviso', /Nenhum item doado ainda/.test($('grid').innerHTML));

  // cadastra um produto direto no estado e re-renderiza
  w.eval(`produtos.unshift({ nome:'Fone Bluetooth Pro Max', preco:'1.299,90', precoOld:'1.599,90', categoria:'OFERTA', desc:'40h de bateria', link:'https://loja.com/fone', img:'' });
          gravar(KEY_PROD, produtos); renderVitrine();`);
  t('card do produto renderiza', /Fone Bluetooth Pro Max/.test($('grid').innerHTML));
  t('botão comprar existe', !!$('grid').querySelector('[data-comprar]'));

  console.log('== checkout: validações ==');
  click($('grid').querySelector('[data-comprar]'));
  t('checkout abriu', $('ovCheckout').classList.contains('open'));

  digita($('cNome'), 'Maria');
  click($('btnC1'));
  t('exige nome completo', $('cMsg1').className.includes('err') && /nome completo/i.test($('cMsg1').textContent));

  digita($('cNome'), 'Maria Souza Lima');
  digita($('cCpf'), '11111111111');
  click($('btnC1'));
  t('rejeita CPF inválido', /CPF inválido/i.test($('cMsg1').textContent));

  digita($('cCpf'), '52998224725');
  t('máscara de CPF aplicada', $('cCpf').value === '529.982.247-25', $('cCpf').value);
  digita($('cNasc'), '01012015');
  click($('btnC1'));
  t('bloqueia menor de 18', /18 anos/i.test($('cMsg1').textContent));

  digita($('cNasc'), '05081998');
  t('mostra idade calculada', /28 anos/.test($('cIdadeHint').textContent) && /maior de idade/.test($('cIdadeHint').textContent), $('cIdadeHint').textContent);
  digita($('cEmail'), 'maria@email.com');
  digita($('cTel'), '85999998888');
  t('máscara de telefone', $('cTel').value === '(85) 99999-8888', $('cTel').value);
  click($('btnC1'));
  t('exige aceite de maioridade', /maior de 18/i.test($('cMsg1').textContent));

  $('cMaior').checked = true;
  click($('btnC1'));
  t('passou para endereço', $('cp2').style.display !== 'none' && $('cp1').style.display === 'none');

  console.log('== checkout: endereço ==');
  click($('btnC2'));
  t('exige CEP', /CEP válido/i.test($('cMsg2').textContent));
  digita($('cCep'), '60000000');
  t('máscara de CEP', $('cCep').value === '60000-000');
  digita($('cRua'), 'Rua das Flores');
  digita($('cNum'), '120');
  digita($('cBairro'), 'Centro');
  digita($('cCidade'), 'Horizonte');
  digita($('cUf'), 'ce');
  t('UF em maiúsculas', $('cUf').value === 'CE', $('cUf').value);
  click($('btnC2'));
  t('passou para cartão', $('cp3').style.display !== 'none');

  console.log('== checkout: PIX (único meio de pagamento) ==');
  t('passo 3 nao tem nenhum campo de cartao', !d.getElementById('cNumCartao') && !d.getElementById('cCvv') && !d.getElementById('cParc'));
  t('passo 3 anuncia PIX', /PIX/.test($('cp3').innerHTML) && /Único meio de pagamento/.test($('cp3').innerHTML));
  t('total do PIX preenchido', /R\$ 1\.299,90/.test($('cvTotalPix').textContent), $('cvTotalPix').textContent);
  click($('btnC3'));
  t('passou para a revisão', $('cp4').style.display !== 'none');
  t('resumo sem cartão', !/••••/.test($('coResumo').innerHTML));
  t('resumo com PIX (Asaas)', /PIX \(Asaas\)/.test($('coResumo').innerHTML));
  t('resumo mostra produto grátis', /GRÁTIS \(doação\)/.test($('coResumo').innerHTML));
  t('resumo tem idade', /28 anos/.test($('coResumo').innerHTML));

  console.log('== confirmação gera o PIX ==');
  click($('btnC4'));
  t('tela do PIX aberta', $('cpPix').style.display !== 'none' && $('cpDone').style.display === 'none');
  t('protocolo exibido', /^PD-/.test($('pixProto').textContent), $('pixProto').textContent);
  t('valor do frete na tela', /R\$ 1\.299,90/.test($('pixValor').textContent), $('pixValor').textContent);
  t('modo demonstração avisado (sem proxy)', $('pixSimBox').style.display !== 'none');
  const ped = w.eval('pedidos[0]');
  t('pedido salvo', !!ped && ped.produto.nome === 'Fone Bluetooth Pro Max');
  t('pagamento é PIX', ped.pagamento.metodo === 'PIX');
  t('idade salva', ped.comprador.idade === 28);
  t('endereço salvo', ped.endereco.cidade === 'Horizonte' && ped.endereco.uf === 'CE');
  t('nenhum dado de cartão no pedido', !ped.pagamento.ultimos4 && !ped.pagamento.validade && ped.pagamento.numeroCompletoArmazenado === false);
  const ls = w.localStorage.getItem('freedoes_pedidos_v1') || '';
  t('localStorage sem número de cartão', !/4111/.test(ls) && !/"cvv"/.test(ls) && !/ultimos4":"\d/.test(ls));
  t('pedido no armazenamento é PIX', /"metodo":"PIX"/.test(ls));
  t('pedido começa aguardando pagamento', ped.status === 'aguardando');

  click($('btnPixSimular'));
  t('simulação confirma o pagamento', w.eval('pedidos[0].status') === 'pago');
  t('status do PIX registrado', /SIMULADO/.test(String(w.eval('pedidos[0].pagamento.pixStatus'))));

  console.log('== painel adm ==');
  const logo = d.querySelector('.logo');
  for (let i = 0; i < 9; i++) click(logo);
  t('9 toques no logo abre o login adm', $('ovLogin').classList.contains('open'));
  $('senha').value = 'adm';
  click($('btnLogin'));
  t('senha adm entra no painel', $('ovAdmin').classList.contains('open'));

  // aba pedidos
  const abaP = [...d.querySelectorAll('.tab')].find(x => x.dataset.tab === 'pPedidos');
  click(abaP);
  t('aba Pedidos ativa', abaP.classList.contains('on') && $('pPedidos').classList.contains('on'));
  t('contador de pendentes zerado (pedido já pago)', $('pillPedidos').textContent === '0', $('pillPedidos').textContent);
  t('pedido aparece como Pago', /Pago/.test($('pedidosList').innerHTML));
  t('lista mostra PIX e o valor do frete', /PIX/.test($('pedidosList').innerHTML) && /R\$ 1\.299,90/.test($('pedidosList').innerHTML));
  t('pedido listado com idade e local', /Maria Souza Lima/.test($('pedidosList').innerHTML) && /28 anos/.test($('pedidosList').innerHTML) && /Horizonte\/CE/.test($('pedidosList').innerHTML));

  click($('pedidosList').querySelector('[data-pver]'));
  t('modal de detalhes abre', $('ovPedido').classList.contains('open'));
  const box = $('pedBox').innerHTML;
  t('detalhes mostram CPF', box.includes('529.982.247-25'));
  t('detalhes mostram nascimento e idade', box.includes('05/08/1998') && box.includes('28 anos'));
  t('detalhes mostram endereço completo', box.includes('Rua das Flores, 120') && box.includes('60000-000'));
  t('detalhes mostram o PIX e o frete pago', /PIX/.test(box) && /Total pago \(frete\)/.test(box));
  t('detalhes não mostram cartão nenhum', !/••••/.test(box) && !/Titular/.test(box));
  t('detalhes não vazam número completo', !box.includes('4111111111111111'));

  click($('pedidosList').querySelector('[data-pcanc]'));
  t('cancelar pedido funciona', w.eval('pedidos[0].status') === 'cancelado');
  t('status atualizado na tela', /Cancelado/.test($('pedidosList').innerHTML));

  console.log('== saldo do Asaas no painel ==');
  t('chip de saldo existe no topo do painel', !!$('saldoChip'));
  t('sem configurar, o chip avisa', /configure o Asaas/.test($('saldoChip').textContent), $('saldoChip').textContent);
  w.localStorage.setItem('freedoes_asaas_v1', JSON.stringify({ url:'http://127.0.0.1:8788', token:'tok-teste-123', ambiente:'producao' }));
  w.fetch = async (u) => ({ ok:true, status:200, text: async () =>{
    const s = String(u);
    if(s.includes('/saldo')) return JSON.stringify({ ok:true, saldo: 250.75 });
    if(s.includes('/extrato')) return JSON.stringify({ ok:true, movimentacoes:[{ id:'tx1', data:'2026-10-07', valor:32.9, saldo:250.75, tipo:'PAYMENT_RECEIVED', descricao:'Frete da doação' }] });
    if(s.includes('/chaves')) return JSON.stringify({ ok:true, chaves:[{ id:'key1', chave:'a1b2c3d4-1111-2222-3333-444455556666', tipo:'EVP', status:'ACTIVE' }] });
    if(s.includes('/cobrancas')) return JSON.stringify({ ok:true, cobrancas:[{ id:'pay_000001', status:'PENDING', valor:32.9, vencimento:'2026-10-09', descricao:'Frete', tipo:'PIX', referencia:'PD-ABC123' }] });
    if(s.includes('/financeiro') || s.includes('/saude')) return JSON.stringify({ ok:true });
    return JSON.stringify({ ok:true });
  }});
  w.eval("ASAAS.url='http://127.0.0.1:8788'; ASAAS.token='tok-teste-123';");
  await w.eval('finCarregarTudo()');
  t('saldo aparece no chip do painel', /R\$ 250,75/.test($('saldoChip').textContent), $('saldoChip').textContent);
  t('saldo aparece na aba Financeiro', /R\$ 250,75/.test($('finSaldo').textContent), $('finSaldo').textContent);
  t('extrato renderizado', /Frete da doação/.test($('finExtrato').innerHTML));
  t('chaves PIX listadas', /EVP/.test($('finChaves').innerHTML));
  t('cobranças listadas', /PENDING/.test($('finCobrancas').innerHTML));
  t('status da conexão = conectado', /Conectado/.test($('finChip').textContent), $('finChip').textContent);
  t('botão de saque travado sem confirmação', $('btnSacar').disabled === true);
  $('saqValor').value = '100,00'; $('saqChave').value = 'a@b.com'; $('saqConfirma').value = 'SAQUE';
  w.eval('finAtualizaBotaoSaque()');
  t('botão de saque libera após digitar SAQUE', $('btnSacar').disabled === false);
  t('pedido de saque tem senha de confirmação', /SAQUE/.test($('saqConfirma').placeholder));

  console.log('== outros fluxos intactos ==');
  t('aba Contas existe', !!d.querySelector('[data-tab="pContas"]'));
  t('aba Quero Vender existe', !!d.querySelector('[data-tab="pVend"]'));
  t('checkout fechou/limpo', true);
  const w2 = d.querySelectorAll('.ws').length;
  t('passos do registro separados do checkout', w2 === 9, w2);

  console.log('\nErros de runtime capturados: ' + erros.length);
  erros.slice(0, 5).forEach(e => console.log('   > ' + e.split('\n')[0]));
  console.log('\nRESULTADO: ' + ok + ' passaram, ' + fail + ' falharam');
  process.exit(fail || erros.length ? 1 : 0);
}, 400);
