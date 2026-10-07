/* ============================================================================
 *  FREE DOES — PROXY DE PAGAMENTOS ASAAS
 * ----------------------------------------------------------------------------
 *  POR QUE ISSO EXISTE?
 *  1) A API do Asaas NÃO envia cabeçalhos CORS — o navegador não pode chamá-la
 *     direto (dá erro de CORS e a requisição nunca sai).
 *  2) Sua chave de API dá controle TOTAL da conta (inclusive SAQUES). Se ela
 *     ficar no HTML do site, qualquer visitante copia e esvazia sua conta.
 *     Aqui ela fica só no servidor, em variável de ambiente.
 *
 *  COMO RODAR (Node 18+, sem instalar nada):
 *      ASAAS_KEY="$aact_prod_..." ADM_TOKEN="escolha-um-token-forte" node asaas-proxy.js
 *      (opcional) ASAAS_URL=https://api-sandbox.asaas.com/v3  para testar em sandbox
 *      (opcional) MAX_SAQUE=500   limita o valor de cada saque
 *      (opcional) ORIGENS=https://seusite.com,https://outro.com  restringe quem pode chamar
 *
 *  No site (painel adm → aba Financeiro) preencha:
 *      URL do proxy:  http://localhost:8787    (ou o domínio onde você publicar)
 *      Token adm:     o mesmo valor de ADM_TOKEN
 * ============================================================================ */

'use strict';

const http = require('http');
const { URL } = require('url');

const ASAAS_KEY   = process.env.ASAAS_KEY   || '';
const ADM_TOKEN   = process.env.ADM_TOKEN   || '';
const ASAAS_URL   = (process.env.ASAAS_URL  || 'https://api.asaas.com/v3').replace(/\/+$/, '');
const PORT        = Number(process.env.PORT || 8787);
const MAX_SAQUE   = Number(process.env.MAX_SAQUE || 0);      // 0 = sem limite
const ORIGENS     = (process.env.ORIGENS || '').split(',').map(s => s.trim()).filter(Boolean);
const TIMEOUT_MS  = 25000;

/* ---------------------------------------------------------------- utilidades */
function cabecalhos(origem) {
  const permite = ORIGENS.length === 0 ? '*' : (ORIGENS.includes(origem) ? origem : ORIGENS[0]);
  return {
    'Access-Control-Allow-Origin': permite,
    'Access-Control-Allow-Headers': 'Content-Type, x-fd-token',
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin'
  };
}
function responder(res, status, dados, origem) {
  const corpo = JSON.stringify(dados);
  res.writeHead(status, Object.assign({
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(corpo)
  }, cabecalhos(origem)));
  res.end(corpo);
}
function lerCorpo(req) {
  return new Promise((resolve, reject) => {
    let dados = '', tamanho = 0;
    req.on('data', c => {
      tamanho += c.length;
      if (tamanho > 2 * 1024 * 1024) { reject(new Error('Corpo grande demais')); req.destroy(); return; }
      dados += c;
    });
    req.on('end', () => {
      if (!dados) return resolve({});
      try { resolve(JSON.parse(dados)); } catch (e) { reject(new Error('JSON inválido')); }
    });
    req.on('error', reject);
  });
}
const soDigitos = v => String(v || '').replace(/\D/g, '');

/* ------------------------------------------------------------ chamada Asaas */
async function asaas(metodo, caminho, corpo) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(ASAAS_URL + caminho, {
      method: metodo,
      headers: { 'access_token': ASAAS_KEY, 'Content-Type': 'application/json', 'User-Agent': 'FreeDoes/1.0' },
      body: corpo ? JSON.stringify(corpo) : undefined,
      signal: ctrl.signal
    });
    const txt = await r.text();
    let json = null;
    try { json = txt ? JSON.parse(txt) : null; } catch (e) { json = { resposta: txt }; }
    if (!r.ok) {
      const err = new Error('Asaas ' + r.status);
      err.status = r.status;
      err.asaas = json;
      throw err;
    }
    return json;
  } finally { clearTimeout(t); }
}

function hojeMais(dias) {
  const d = new Date(Date.now() + dias * 86400000);
  return d.toISOString().slice(0, 10);
}

/* ------------------------------------------------------------ rotas Asaas */
const rotas = {

  /* ---- cria cobrança PIX e devolve QR Code + copia e cola ---- */
  async 'POST /api/cobranca-pix'(corpo) {
    const nome = String(corpo.nome || '').trim();
    const cpf = soDigitos(corpo.cpf);
    const valor = Number(String(corpo.valor).replace(',', '.'));
    if (nome.length < 5) throw badRequest('Informe o nome completo do pagador.');
    if (cpf.length !== 11 && cpf.length !== 14) throw badRequest('Informe um CPF/CNPJ válido.');
    if (!(valor > 0)) throw badRequest('Valor da cobrança inválido.');

    // reaproveita o cliente se já existir
    let cliente = null;
    const busca = await asaas('GET', '/customers?cpfCnpj=' + cpf + '&limit=1');
    if (busca && Array.isArray(busca.data) && busca.data.length) cliente = busca.data[0];
    if (!cliente) {
      cliente = await asaas('POST', '/customers', {
        name: nome, cpfCnpj: cpf,
        email: corpo.email || undefined,
        phone: corpo.telefone ? soDigitos(corpo.telefone) : undefined,
        externalReference: corpo.externalReference || undefined,
        notificationDisabled: true
      });
    }

    const cobranca = await asaas('POST', '/payments', {
      customer: cliente.id,
      billingType: 'PIX',
      value: Number(valor.toFixed(2)),
      dueDate: hojeMais(3),
      description: (corpo.descricao || 'Free Does — frete da doação').slice(0, 200),
      externalReference: corpo.externalReference || undefined
    });

    let qr = null;
    try { qr = await asaas('GET', '/payments/' + cobranca.id + '/pixQrCode'); } catch (e) { qr = null; }

    return {
      ok: true,
      cobrancaId: cobranca.id,
      status: cobranca.status,
      valor: cobranca.value,
      vencimento: cobranca.dueDate,
      fatura: cobranca.invoiceUrl || null,
      clienteId: cliente.id,
      qrImagem: qr && qr.encodedImage ? ('data:image/png;base64,' + qr.encodedImage) : null,
      copiaECola: qr ? qr.payload : null,
      expiraEm: qr ? qr.expirationDate : null
    };
  },

  /* ---- consulta uma cobrança (usado para saber se foi paga) ---- */
  async 'GET /api/cobranca'(_, q) {
    if (!q.get('id')) throw badRequest('Informe o id da cobrança.');
    const c = await asaas('GET', '/payments/' + encodeURIComponent(q.get('id')));
    const pago = ['RECEIVED', 'CONFIRMED', 'RECEIVED_IN_CASH'].includes(c.status);
    return { ok: true, cobrancaId: c.id, status: c.status, pago,
             valor: c.value, pagoEm: c.paymentDate || c.confirmedDate || null,
             fatura: c.invoiceUrl || null };
  },

  /* ---- lista cobranças recentes ---- */
  async 'GET /api/cobrancas'(_, q) {
    const lim = Math.min(100, Number(q.get('limite')) || 20);
    const r = await asaas('GET', '/payments?limit=' + lim + '&offset=0');
    return { ok: true, total: r.totalCount, cobrancas: (r.data || []).map(c => ({
      id: c.id, status: c.status, valor: c.value, vencimento: c.dueDate,
      descricao: c.description || '', cliente: c.customer, referencia: c.externalReference || '',
      fatura: c.invoiceUrl || null, tipo: c.billingType
    })) };
  },

  /* ---- saldo ---- */
  async 'GET /api/saldo'() {
    const s = await asaas('GET', '/finance/balance');
    return { ok: true, saldo: Number(s.balance) || 0 };
  },

  /* ---- extrato ---- */
  async 'GET /api/extrato'(_, q) {
    const lim = Math.min(100, Number(q.get('limite')) || 30);
    const r = await asaas('GET', '/financialTransactions?limit=' + lim + '&offset=0');
    return { ok: true, movimentacoes: (r.data || []).map(m => ({
      id: m.id, data: m.date, valor: Number(m.value) || 0, saldo: Number(m.balance) || 0,
      tipo: m.type, descricao: m.description || '', cobrancaId: m.paymentId || null,
      transferenciaId: m.transferId || null
    })) };
  },

  /* ---- chaves PIX da conta ---- */
  async 'GET /api/chaves'() {
    const r = await asaas('GET', '/pix/addressKeys?limit=50');
    return { ok: true, chaves: (r.data || []).map(k => ({
      id: k.id, chave: k.key, tipo: k.type, status: k.status, criadaEm: k.createdDate || null
    })) };
  },

  /* ---- cria chave aleatória (EVP) — a API só permite esse tipo ---- */
  async 'POST /api/chaves'() {
    const r = await asaas('POST', '/pix/addressKeys', { type: 'EVP' });
    return { ok: true, chave: { id: r.id, chave: r.key, tipo: r.type, status: r.status } };
  },

  async 'DELETE /api/chaves'(_, q) {
    if (!q.get('id')) throw badRequest('Informe o id da chave.');
    await asaas('DELETE', '/pix/addressKeys/' + encodeURIComponent(q.get('id')));
    return { ok: true, removida: q.get('id') };
  },

  /* ---- saque: transfere o saldo para uma chave PIX ---- */
  async 'POST /api/saque'(corpo) {
    const valor = Number(String(corpo.valor).replace(',', '.'));
    const chave = String(corpo.chave || '').trim();
    const tipo = String(corpo.tipoChave || '').trim().toUpperCase();
    const tipos = ['CPF', 'CNPJ', 'EMAIL', 'PHONE', 'EVP'];

    if (!(valor > 0)) throw badRequest('Valor do saque inválido.');
    if (valor < 0.01) throw badRequest('O valor mínimo de saque é R$ 0,01.');
    if (!chave) throw badRequest('Informe a chave PIX de destino.');
    if (!tipos.includes(tipo)) throw badRequest('Tipo de chave inválido. Use CPF, CNPJ, EMAIL, PHONE ou EVP.');
    if (MAX_SAQUE > 0 && valor > MAX_SAQUE) throw badRequest('O saque máximo por operação aqui é R$ ' + MAX_SAQUE.toFixed(2) + '.');

    const saldo = await asaas('GET', '/finance/balance');
    const disponivel = Number(saldo.balance) || 0;
    if (valor > disponivel) {
      const e = badRequest('Saldo insuficiente. Disponível: R$ ' + disponivel.toFixed(2).replace('.', ',') + '.');
      e.status = 422; throw e;
    }

    const corpoTransferencia = {
      value: Number(valor.toFixed(2)),
      pixAddressKey: chave,
      pixAddressKeyType: tipo,
      description: (corpo.descricao || 'Saque Free Does').slice(0, 140),
      operationType: 'PIX',
      externalReference: corpo.externalReference || undefined
    };
    const t = await asaas('POST', '/transfers', corpoTransferencia);
    return { ok: true, transferencia: {
      id: t.id, status: t.status, valor: t.value, chave: t.pixAddressKey || chave,
      tipoChave: t.pixAddressKeyType || tipo, data: t.dateCreated || new Date().toISOString(),
      descricao: t.description || ''
    } };
  },

  /* ---- histórico de transferências (saques) ---- */
  async 'GET /api/transferencias'(_, q) {
    const lim = Math.min(100, Number(q.get('limite')) || 20);
    const r = await asaas('GET', '/transfers?limit=' + lim + '&offset=0');
    return { ok: true, transferencias: (r.data || []).map(t => ({
      id: t.id, status: t.status, valor: Number(t.value) || 0, tipo: t.type,
      chave: t.pixAddressKey || null, data: t.dateCreated, descricao: t.description || ''
    })) };
  }
};

function badRequest(mensagem) {
  const e = new Error(mensagem);
  e.status = 400;
  return e;
}

/* --------------------------------------------------------------- servidor */
const servidor = http.createServer(async (req, res) => {
  const origem = req.headers.origin || '';
  let url;
  try { url = new URL(req.url, 'http://' + (req.headers.host || 'localhost')); }
  catch (e) { return responder(res, 400, { ok: false, erro: 'URL inválida' }, origem); }

  if (req.method === 'OPTIONS') {
    res.writeHead(204, cabecalhos(origem));
    return res.end();
  }

  if (url.pathname === '/' || url.pathname === '/saude') {
    return responder(res, 200, {
      ok: true, servico: 'Free Does — proxy Asaas',
      ambiente: ASAAS_URL.includes('sandbox') ? 'sandbox' : 'producao',
      chaveConfigurada: !!ASAAS_KEY, tokenConfigurado: !!ADM_TOKEN,
      limiteSaque: MAX_SAQUE || null,
      rotas: Object.keys(rotas)
    }, origem);
  }

  if (!ASAAS_KEY) return responder(res, 500, { ok: false, erro: 'Servidor sem ASAAS_KEY configurada.' }, origem);
  if (!ADM_TOKEN) return responder(res, 500, { ok: false, erro: 'Servidor sem ADM_TOKEN configurado (obrigatório por segurança).' }, origem);

  const token = req.headers['x-fd-token'] || '';
  if (token !== ADM_TOKEN) return responder(res, 401, { ok: false, erro: 'Token adm inválido.' }, origem);

  const rota = rotas[req.method + ' ' + url.pathname];
  if (!rota) return responder(res, 404, { ok: false, erro: 'Rota não encontrada: ' + req.method + ' ' + url.pathname }, origem);

  try {
    const corpo = (req.method === 'POST') ? await lerCorpo(req) : {};
    const dados = await rota(corpo, url.searchParams);
    responder(res, 200, dados, origem);
  } catch (e) {
    const status = e.status && e.status >= 400 && e.status < 600 ? e.status : 502;
    responder(res, status, {
      ok: false,
      erro: e.asaas ? (e.asaas.errors || e.asaas.message || 'Erro na API do Asaas') : e.message,
      detalhe: e.asaas || null
    }, origem);
  }
});

servidor.listen(PORT, '0.0.0.0', () => {
  console.log('============================================================');
  console.log(' Free Does — proxy Asaas no ar porta ' + PORT);
  console.log(' Ambiente: ' + (ASAAS_URL.includes('sandbox') ? 'SANDBOX (testes)' : 'PRODUÇÃO (dinheiro real)'));
  console.log(' Chave Asaas: ' + (ASAAS_KEY ? 'configurada ✔' : 'FALTANDO ✖'));
  console.log(' Token adm:   ' + (ADM_TOKEN ? 'configurado ✔' : 'FALTANDO ✖'));
  if (MAX_SAQUE > 0) console.log(' Limite por saque: R$ ' + MAX_SAQUE.toFixed(2));
  if (!ORIGENS.length) console.log(' Origens: qualquer site (*) — restrinja com ORIGENS= em produção');
  console.log('============================================================');
});
