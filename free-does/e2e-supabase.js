const fs = require('fs');
const { JSDOM, VirtualConsole } = require('jsdom');
const html = fs.readFileSync('/home/user/free-does/index.html', 'utf8');
const sql  = fs.readFileSync('/home/user/free-does/supabase.sql', 'utf8');

let ok = 0, fail = 0;
const t = (n, c, e) => { if (c) { ok++; console.log('  OK   ' + n); } else { fail++; console.log('  FALHA ' + n, e === undefined ? '' : JSON.stringify(e)); } };

const ctxFake = new Proxy({}, { get: (o,k) => (k in o ? o[k] : (typeof k === 'string' && k !== 'then' ? (()=>{}) : undefined)), set: (o,k,v) => { o[k]=v; return true; } });
const erros = [];
const vc = new VirtualConsole(); vc.on('jsdomError', e => erros.push(e.message));

const dom = new JSDOM(html, {
  runScripts: 'dangerously', url: 'https://freedoes.test/', pretendToBeVisual: true, virtualConsole: vc,
  beforeParse(w){
    w.HTMLCanvasElement.prototype.getContext = () => ctxFake;
    w.matchMedia = () => ({ matches:false, addEventListener(){}, removeEventListener(){} });
    w.IntersectionObserver = class { constructor(cb){ this.cb = cb; this.vistos = []; } observe(el){ this.vistos.push(el); this.cb([{ isIntersecting:true, target:el }], this); } unobserve(){} disconnect(){} };
  }
});
const w = dom.window, d = w.document, $ = id => d.getElementById(id);

(async () => {
  // espera o DOM terminar de carregar (jsdom dispara DOMContentLoaded de forma assíncrona)
  for(let i = 0; i < 60 && (w.document.readyState === 'loading' || typeof w.sbBoot !== 'function'); i++) await new Promise(r => setTimeout(r, 50));
  await new Promise(r => setTimeout(r, 120));

  console.log('== animações e efeitos ==');
  t('sem erros de runtime', erros.length === 0, erros.slice(0,2));
  t('canvases de efeito e confete existem', !!$('fx') && !!$('confete'));
  t('barra de progresso existe', !!$('progresso'));
  t('halo do cursor existe', !!$('brilho'));
  t('módulo FX carregado', typeof w.eval('typeof FX') === 'string' && w.eval('typeof FX') === 'object');
  t('prefers-reduced-motion detectado', w.eval('typeof RM') === 'boolean');

  // revela ao rolar
  w.eval(`produtos.unshift({ id:'i1', nome:'Cadeira de Bebê', preco:'32,90', precoOld:'399,00', categoria:'DOAÇÃO', desc:'Item doado', link:'https://loja.com/x', img:'' });
          produtos.unshift({ id:'i2', nome:'Bicicleta Aro 20', preco:'48,00', categoria:'INFANTIL', desc:'Boa para criança', link:'https://loja.com/y', img:'' });
          gravar(KEY_PROD, produtos); renderVitrine();`);
  const cards = d.querySelectorAll('#grid .prod');
  t('cards renderizados', cards.length === 2);
  t('cards receberam classe reveal', [...cards].every(c => c.classList.contains('reveal')));
  t('cards foram revelados (classe em)', [...cards].every(c => c.classList.contains('em')));
  t('card tem brilho de varredura', !!cards[0].querySelector('.card-shine'));
  t('card mostra PRODUTO GRÁTIS', /PRODUTO GRÁTIS/.test(cards[0].innerHTML));
  t('card mostra o frete', /Você paga só o frete/.test($('grid').innerHTML) && /R\$ 32,90/.test($('grid').innerHTML) && /R\$ 48,00/.test($('grid').innerHTML));

  // contadores
  await new Promise(r => setTimeout(r, 1100));
  t('contador de itens animou até o total', $('statProd').textContent === '2', $('statProd').textContent);

  // ripple no clique
  const btn = cards[0].querySelector('.btn-main');
  btn.dispatchEvent(new w.MouseEvent('click', { bubbles:true, clientX:10, clientY:10 }));
  t('efeito ripple criado no clique', !!btn.querySelector('.ripple'));

  // confete não quebra
  let confeteOk = true;
  try { w.eval('FX.confete(20)'); } catch(e){ confeteOk = false; }
  t('confete roda sem erro', confeteOk);
  t('tilt registrado nos cards', (() => { try { w.eval("FX.tilt(document.querySelector('#grid .prod'), 5)"); return true; } catch(e){ return false; } })());

  console.log('== supabase: modo local sem chave ==');
  t('sbOn() falso sem chave', w.eval('sbOn()') === false);
  t('chip mostra modo local', /Modo local/.test($('sbChip').textContent), $('sbChip').textContent);
  t('status explica o modo local', /Sem chave configurada/.test($('sbStatus').innerHTML));
  t('url do projeto correta', w.eval('SUPABASE.url') === 'https://kilpznpvadshohvdybrf.supabase.co');

  console.log('== supabase: conexão com dados falsos ==');
  const chamadas = [];
  const resp = (dados, status) => ({ ok:(status||200) < 400, status: status||200, text: async () => JSON.stringify(dados) });
  w.fetch = async (url, opts) => {
    const u = String(url);
    chamadas.push({ u, op:(opts && opts.method) || 'GET', body: opts && opts.body });
    if(u.includes('/rest/v1/itens')) return resp([{
      id:'db-1', criado_em: 1700000000000, nome:'Sofá 3 lugares', descricao:'Doado, bom estado', imagem:'',
      link:'https://doador.com/sofa', frete: 39.9, valor_referencia: 899, categoria:'MÓVEIS', verificado:true, ativo:true
    }]);
    if(u.includes('/rest/v1/doacoes')) return resp([]);
    if(u.includes('/rest/v1/contas')) return resp([]);
    if(u.includes('/rest/v1/pedidos')) return resp([]);
    return resp([], 201);
  };
  w.eval("SUPABASE.key = 'eyJ' + 'a'.repeat(80); atualizarStatusSb();");
  t('sbOn() verdadeiro com chave', w.eval('sbOn()') === true);
  const carregou = await w.eval('cloudCarregar(true)');
  t('carregou da nuvem', carregou === true);
  t('bateu nas 4 tabelas', ['itens','doacoes','contas','pedidos'].every(tb => chamadas.some(c => c.u.includes(tb))));
  t('item da nuvem virou card', /Sofá 3 lugares/.test($('grid').innerHTML));
  t('frete formatado em reais', /R\$ 39,90/.test($('grid').innerHTML));
  t('valor de referência preservado', /R\$ 899,00/.test($('grid').innerHTML));
  t('selo de doador verificado', /DOADOR VERIFICADO/.test($('grid').innerHTML));
  t('id do banco preservado', w.eval('produtos[0].id') === 'db-1');
  t('chip mostra nuvem conectada', /Nuvem conectada/.test($('sbChip').textContent), $('sbChip').textContent);

  console.log('== supabase: gravação ==');
  chamadas.length = 0;
  w.eval(`salvarProdutoTeste = null; produtos.unshift({ id:'novo-1', nome:'Mesa de estudo', preco:'25,00', precoOld:'', desc:'', img:'', link:'', categoria:'', criadoEm: Date.now() });
          nuvem('upsert','itens', produtos[0]);`);
  await new Promise(r => setTimeout(r, 60));
  const envio = chamadas.find(c => c.op === 'POST');
  t('mandou POST para /itens', !!envio);
  const corpo = envio ? JSON.parse(envio.body) : {};
  t('corpo tem as colunas certas', corpo.id === 'novo-1' && corpo.frete === 25 && corpo.nome === 'Mesa de estudo' && corpo.ativo === true);
  t('nunca envia número de cartão', !('cartao' in corpo) && !('cvv' in corpo));

  console.log('== fila de sincronização ==');
  w.fetch = async () => { throw new Error('sem internet'); };
  w.eval("nuvem('upsert','itens',{ id:'off-1', nome:'Item offline', preco:'10,00' })");
  await new Promise(r => setTimeout(r, 80));
  t('operação falha entrou na fila', w.eval('filaSync.length') === 1, w.eval('filaSync.length'));
  t('chip avisa erro na nuvem', /erro/i.test($('sbChip').textContent), $('sbChip').textContent);
  let tentativas = 0;
  w.fetch = async () => { tentativas++; return resp([], 201); };
  const feitos = await w.eval('processarFila()');
  t('fila foi reenviada com sucesso', feitos === 1 && w.eval('filaSync.length') === 0, { feitos, resto: w.eval('filaSync.length') });
  t('pelo menos uma tentativa de reenvio', tentativas >= 1);

  console.log('== ida e volta: app -> banco -> app ==');
  const volta = w.eval(`(function(){
    const original = {
      id:'rt-1', nome:'Guarda-roupa', preco:'55,00', precoOld:'1.299,90', desc:'Doado por vizinho',
      img:'http://x/foto.jpg', link:'https://d.com/g', categoria:'MÓVEIS', verificado:true, criadoEm: 1712345678000
    };
    const linha = MAPA.itens.para(original);
    const devolta = MAPA.itens.de(linha);
    return { linha, devolta };
  })()`);
  t('ida: frete numérico 55', volta.linha.frete === 55);
  t('ida: valor de referência numérico 1299.9', volta.linha.valor_referencia === 1299.9);
  t('volta: nome igual', volta.devolta.nome === 'Guarda-roupa');
  t('volta: frete no formato do app', volta.devolta.preco === '55,00', volta.devolta.preco);
  t('volta: valor de referência no formato do app', volta.devolta.precoOld === '1299,90', volta.devolta.precoOld);
  t('volta: timestamp preservado', volta.devolta.criadoEm === 1712345678000);

  const pedido = w.eval(`(function(){
    const o = {
      id:'PD-ABC123', criadoEm: 1712345678000,
      produto:{ nome:'Bicicleta', tipo:'doação', link:'https://d.com/b', img:'', preco:'48,00', frete:'48,00', valorReferencia:'899,00' },
      comprador:{ nome:'Maria Souza', cpf:'529.982.247-25', nasc:'05/08/1998', idade:28, email:'m@x.com', tel:'(85) 99999-8888' },
      endereco:{ cep:'60000-000', rua:'Rua A', numero:'120', comp:'Apto 3', bairro:'Centro', cidade:'Horizonte', uf:'CE' },
      pagamento:{ metodo:'Cartão de crédito', bandeira:'VISA', ultimos4:'1111', titular:'MARIA S', validade:'12/30', parcelas:3, valorParcela:16, total:48, numeroCompletoArmazenado:false },
      status:'aguardando', conta:'m@x.com'
    };
    const linha = MAPA.pedidos.para(o);
    const devolta = MAPA.pedidos.de(linha);
    return { linha, devolta, linhaTexto: JSON.stringify(linha) };
  })()`);
  t('pedido: idade salva', pedido.linha.comprador_idade === 28);
  t('pedido: frete pago salvo', pedido.linha.pg_total === 48);
  t('pedido: endereço completo', pedido.linha.end_cidade === 'Horizonte' && pedido.linha.end_uf === 'CE');
  t('pedido: cartão só com 4 dígitos', pedido.linha.pg_ultimos4 === '1111' && pedido.linha.pg_numero_guardado === false);
  t('pedido: nenhum número completo no payload', !/\d{13,16}/.test(pedido.linhaTexto.replace(/1712345678000/,'')));
  t('pedido: nada de CVV', !/cvv/i.test(pedido.linhaTexto));
  t('pedido: ida e volta do nome', pedido.devolta.comprador.nome === 'Maria Souza');
  t('pedido: idade na volta', pedido.devolta.comprador.idade === 28);

  console.log('== sql x app (colunas batem) ==');
  const colunasSQL = {};
  for(const m of sql.matchAll(/create table if not exists public\.(\w+)\s*\(([\s\S]*?)\n\);/g)){
    colunasSQL[m[1]] = [...m[2].matchAll(/^\s{2}([a-z_0-9]+)\s+(?:text|bigint|timestamptz|numeric|boolean|integer)/gm)].map(x => x[1])
      .filter(c => c !== 'atualizado_em');
  }
  // colunas adicionadas depois via ALTER TABLE (ex.: dados do PIX)
  for(const m of sql.matchAll(/alter table public\.(\w+) add column if not exists ([a-z_0-9]+)/g)){
    if(!colunasSQL[m[1]]) colunasSQL[m[1]] = [];
    if(!colunasSQL[m[1]].includes(m[2])) colunasSQL[m[1]].push(m[2]);
  }
  for(const [tab, amostra] of Object.entries({
    itens:   `{ id:'x', criadoEm:1, nome:'n', desc:'d', img:'', link:'', preco:'10,00', precoOld:'', categoria:'', verificado:false }`,
    doacoes: `{ id:'x', enviadoEm:1, vendedor:'v', whats:'w', produto:'p', link:'', preco:'10,00', categoria:'', desc:'', img:'', email:'', verificado:false, status:'pendente' }`,
    contas:  `{ id:'x', criadoEm:1, nome:'n', email:'e', senhaHash:'h', zap:'', emailVerificado:true, face:null, doc:{tipo:'RG',frente:'f',verso:'v',selfieDoc:'s'}, obs:'', status:'pendente', motivo:'' }`,
    pedidos: `{ id:'x', criadoEm:1, produto:{nome:'n',tipo:'doação',link:'',img:'',preco:'',frete:'',valorReferencia:''}, comprador:{nome:'n',cpf:'',nasc:'',idade:20,email:'',tel:''}, endereco:{cep:'',rua:'',numero:'',comp:'',bairro:'',cidade:'',uf:''}, pagamento:{metodo:'',bandeira:'',ultimos4:'',titular:'',validade:'',parcelas:1,valorParcela:0,total:0}, status:'aguardando', conta:'' }`
  })){
    const chavesJS = w.eval(`Object.keys(MAPA.${tab}.para(${amostra})).sort()`);
    const cols = (colunasSQL[tab] || []).sort();
    const faltandoNoSQL = chavesJS.filter(k => !cols.includes(k));
    const sobrandoNoSQL = cols.filter(k => !chavesJS.includes(k));
    t(`tabela "${tab}" bate com o SQL (${cols.length} colunas)`, !faltandoNoSQL.length && !sobrandoNoSQL.length, { faltandoNoSQL, sobrandoNoSQL });
  }

  console.log('\nRESULTADO: ' + ok + ' passaram, ' + fail + ' falharam');
  process.exit(fail ? 1 : 0);
})();
