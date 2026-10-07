const fs=require('fs'), {JSDOM, VirtualConsole}=require('jsdom');
const html=fs.readFileSync('/home/user/free-does/index.html','utf8');
let ok=0,fail=0; const t=(n,c,e)=>{c?(ok++,console.log('  OK   '+n)):(fail++,console.log('  FALHA '+n,e===undefined?'':JSON.stringify(e)));};

const ctxFake = new Proxy({}, { get:(t,k)=> (k in t ? t[k] : (typeof k === 'string' && k !== 'then' ? (()=>{}) : undefined)), set:(t,k,v)=>{ t[k]=v; return true; } });
const stubs = { beforeParse(w){
  w.HTMLCanvasElement.prototype.getContext = () => ctxFake;
  w.matchMedia = () => ({ matches:false, addEventListener(){}, removeEventListener(){} });
  w.IntersectionObserver = class { constructor(cb){ this.cb = cb; } observe(el){ this.cb([{ isIntersecting:true, target:el }], this); } unobserve(){} disconnect(){} };
}};

const erros=[];
const vc=new VirtualConsole(); vc.on('jsdomError',e=>erros.push(e.message));
const dom=new JSDOM(html,{runScripts:'dangerously',url:'https://freedoes.test/',pretendToBeVisual:true,virtualConsole:vc,...stubs});
const w=dom.window,d=w.document,$=id=>d.getElementById(id);
const click=el=>el.dispatchEvent(new w.MouseEvent('click',{bubbles:true}));
const dig=(el,v)=>{el.value=v;el.dispatchEvent(new w.Event('input',{bubbles:true}));};

setTimeout(()=>{
  console.log('== Quero Vender ==');
  dig($('vNomeVend'),'Loja do João'); dig($('vWhats'),'85988887777');
  dig($('vProduto'),'Caixa de Som X'); dig($('vLink'),'https://loja.com/som');
  dig($('vPreco'),'249,90'); dig($('vCategoria'),'Áudio');
  click($('vEnviar'));
  t('cadastro de vendedor criado', w.eval('vendedores.length')===1);
  t('mensagem de sucesso', /Doação enviada/.test($('vMsg').textContent));
  t('campos limpos (menos nome/whats)', $('vProduto').value===''&&$('vNomeVend').value==='Loja do João');

  console.log('== aprovação no adm publica na vitrine ==');
  for(let i=0;i<9;i++) click(d.querySelector('.logo'));
  $('senha').value='adm'; click($('btnLogin'));
  const abaV=[...d.querySelectorAll('.tab')].find(x=>x.dataset.tab==='pVend'); click(abaV);
  t('vendedor listado', /Caixa de Som X/.test($('vendedoresList').innerHTML));
  click($('vendedoresList').querySelector('[data-apr]'));
  t('produto publicado na vitrine', /Caixa de Som X/.test($('grid').innerHTML));
  t('sem selo de verificado (vendedor não verificado)', /VERIFICADO/.test($('grid').innerHTML)===false);

  console.log('== registro de conta: passo 1 -> 2 ==');
  click([...d.querySelectorAll('[data-abrir-registro]')][0]);
  t('wizard abriu', $('ovRegistro').classList.contains('open') && $('rp1').style.display!=='none');
  dig($('rgNome'),'Ana Paula Souza'); dig($('rgEmail'),'ana@email.com');
  dig($('rgSenha'),'123456'); dig($('rgSenha2'),'1234567');
  click($('btnR1'));
  t('senhas diferentes bloqueia', /senhas não são iguais/i.test($('rMsg1').textContent));
  dig($('rgSenha2'),'123456'); click($('btnR1'));
  t('exige aceite dos termos', /termos/i.test($('rMsg1').textContent));
  $('rgAceite').checked=true; click($('btnR1'));
  setTimeout(()=>{
  t('avançou para o código de e-mail', $('rp2').style.display!=='none');
  t('código de 6 dígitos gerado', /^\d{6}$/.test(String(w.eval('reg.codigo'))), w.eval('reg.codigo'));
  t('mostra o código (modo demonstração)', w.eval('reg.codigo') && $('demoBox').textContent.includes(w.eval('reg.codigo')));
  dig($('rgCodigo'),'000000'); click($('btnR2'));
  t('código errado é recusado', /incorreto/i.test($('rMsg2').textContent));
  dig($('rgCodigo'),w.eval('reg.codigo')); click($('btnR2'));
  t('passou para a etapa facial', $('rp3').style.display!=='none');

  console.log('== etapas e navegação ==');
  t('barra de passos do registro marcada', d.querySelector('#wizSteps .ws[data-s="3"]').classList.contains('on'));
  t('passos do checkout não foram afetados', !d.querySelector('#coSteps .ws').classList.contains('on'));
  t('sem erros de runtime', erros.length===0, erros.slice(0,3));
  console.log('\nRESULTADO: '+ok+' passaram, '+fail+' falharam');
  process.exit(fail||erros.length?1:0);
  }, 500);
},400);
