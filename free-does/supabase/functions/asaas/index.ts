/* ============================================================================
 *  FREE DOES — EDGE FUNCTION: proxy do Asaas (Supabase)
 * ----------------------------------------------------------------------------
 *  Use esta opção se você NÃO quiser hospedar um servidor próprio: o Supabase
 *  hospeda a função para você, de graça, e guarda a chave do Asaas em segredo.
 *
 *  PASSO A PASSO
 *  1) Instale a CLI:  npm i -g supabase
 *  2) Entre no projeto:  supabase login  &&  supabase link --project-ref kilpznpvadshohvdybrf
 *  3) Guarde os segredos (nunca no código):
 *       supabase secrets set ASAAS_KEY="$aact_prod_..."
 *       supabase secrets set ADM_TOKEN="um-token-forte-que-so-voce-sabe"
 *       supabase secrets set ASAAS_URL="https://api.asaas.com/v3"        # ou api-sandbox.asaas.com/v3
 *       supabase secrets set MAX_SAQUE="500"                             # opcional
 *       supabase secrets set ASAAS_WEBHOOK_TOKEN="token-do-webhook"      # opcional
 *       supabase secrets set SUPABASE_SERVICE_KEY="service_role-key"     # só para o webhook
 *  4) Publique:  supabase functions deploy asaas --no-verify-jwt
 *  5) No site (painel adm → Financeiro) preencha:
 *       URL do proxy: https://kilpznpvadshohvdybrf.supabase.co/functions/v1
 *       Token adm:    o mesmo ADM_TOKEN
 *  6) (Opcional) No painel do Asaas → Integrações → Webhooks, cadastre:
 *       URL: https://kilpznpvadshohvdybrf.supabase.co/functions/v1/asaas/webhook
 *       Token: o mesmo ASAAS_WEBHOOK_TOKEN
 *     Assim o pedido é marcado como PAGO automaticamente quando o PIX cai,
 *     mesmo se o cliente fechar o site.
 * ============================================================================ */

const ASAAS_KEY  = Deno.env.get('ASAAS_KEY') ?? '';
const ADM_TOKEN  = Deno.env.get('ADM_TOKEN') ?? '';
const ASAAS_URL  = (Deno.env.get('ASAAS_URL') ?? 'https://api.asaas.com/v3').replace(/\/+$/, '');
const MAX_SAQUE  = Number(Deno.env.get('MAX_SAQUE') ?? 0);
const WEBHOOK_TOKEN = Deno.env.get('ASAAS_WEBHOOK_TOKEN') ?? '';
const SB_URL     = Deno.env.get('SUPABASE_URL') ?? 'https://kilpznpvadshohvdybrf.supabase.co';
const SB_SERVICE = Deno.env.get('SUPABASE_SERVICE_KEY') ?? '';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, x-fd-token, asaas-access-token',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS'
};

const json = (dados: unknown, status = 200) =>
  new Response(JSON.stringify(dados), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json; charset=utf-8' }
  });

const soDigitos = (v: unknown) => String(v ?? '').replace(/\D/g, '');

async function asaas(metodo: string, caminho: string, corpo?: unknown) {
  const r = await fetch(ASAAS_URL + caminho, {
    method: metodo,
    headers: { 'access_token': ASAAS_KEY, 'Content-Type': 'application/json', 'User-Agent': 'FreeDoes/1.0' },
    body: corpo ? JSON.stringify(corpo) : undefined
  });
  const txt = await r.text();
  let body: any = null;
  try { body = txt ? JSON.parse(txt) : null; } catch { body = { resposta: txt }; }
  if (!r.ok) {
    const e = new Error('Asaas ' + r.status) as Error & { status: number; asaas: unknown };
    e.status = r.status;
    e.asaas = body;
    throw e;
  }
  return body;
}

const hojeMais = (dias: number) => new Date(Date.now() + dias * 86400000).toISOString().slice(0, 10);

function erro(mensagem: string, status = 400) {
  const e = new Error(mensagem) as Error & { status: number };
  e.status = status;
  return e;
}

/* --------------------------------------------------------------- webhook ---- */
async function webhook(req: Request) {
  const enviado = req.headers.get('asaas-access-token') ?? '';
  if (WEBHOOK_TOKEN && enviado !== WEBHOOK_TOKEN) return json({ ok: false, erro: 'token do webhook inválido' }, 401);

  const corpo: any = await req.json().catch(() => ({}));
  const evento = String(corpo.event ?? '');
  const pag: any = corpo.payment ?? {};
  if (!pag.id) return json({ ok: true, ignorado: true });

  const pago = ['PAYMENT_RECEIVED', 'PAYMENT_CONFIRMED'].includes(evento);
  if (pago && SB_SERVICE) {
    const r = await fetch(
      `${SB_URL}/rest/v1/pedidos?pg_cobranca_id=eq.${encodeURIComponent(pag.id)}`,
      {
        method: 'PATCH',
        headers: {
          apikey: SB_SERVICE,
          Authorization: `Bearer ${SB_SERVICE}`,
          'Content-Type': 'application/json',
          Prefer: 'return=minimal'
        },
        body: JSON.stringify({ status: 'pago', pg_status: pag.status, revisado_em: Date.now() })
      }
    );
    return json({ ok: r.ok, evento, cobranca: pag.id, pedidoAtualizado: r.ok });
  }
  return json({ ok: true, evento, cobranca: pag.id, atualizado: false });
}

/* ------------------------------------------------------------------ rotas ---- */
async function rota(metodo: string, caminho: string, corpo: any, q: URLSearchParams) {

  if (metodo === 'POST' && caminho === '/cobranca-pix') {
    const nome = String(corpo.nome ?? '').trim();
    const cpf = soDigitos(corpo.cpf);
    const valor = Number(String(corpo.valor).replace(',', '.'));
    if (nome.length < 5) throw erro('Informe o nome completo do pagador.');
    if (cpf.length !== 11 && cpf.length !== 14) throw erro('Informe um CPF/CNPJ válido.');
    if (!(valor > 0)) throw erro('Valor da cobrança inválido.');

    let cliente: any = null;
    const busca = await asaas('GET', '/customers?cpfCnpj=' + cpf + '&limit=1');
    if (busca?.data?.length) cliente = busca.data[0];
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
      description: String(corpo.descricao || 'Free Does — frete da doação').slice(0, 200),
      externalReference: corpo.externalReference || undefined
    });

    let qr: any = null;
    try { qr = await asaas('GET', `/payments/${cobranca.id}/pixQrCode`); } catch { qr = null; }

    return {
      ok: true,
      cobrancaId: cobranca.id,
      status: cobranca.status,
      valor: cobranca.value,
      vencimento: cobranca.dueDate,
      fatura: cobranca.invoiceUrl ?? null,
      clienteId: cliente.id,
      qrImagem: qr?.encodedImage ? 'data:image/png;base64,' + qr.encodedImage : null,
      copiaECola: qr?.payload ?? null,
      expiraEm: qr?.expirationDate ?? null
    };
  }

  if (metodo === 'GET' && caminho === '/cobranca') {
    const id = q.get('id');
    if (!id) throw erro('Informe o id da cobrança.');
    const c = await asaas('GET', '/payments/' + encodeURIComponent(id));
    return { ok: true, cobrancaId: c.id, status: c.status, pago: ['RECEIVED', 'CONFIRMED', 'RECEIVED_IN_CASH'].includes(c.status),
             valor: c.value, pagoEm: c.paymentDate ?? c.confirmedDate ?? null, fatura: c.invoiceUrl ?? null };
  }

  if (metodo === 'GET' && caminho === '/cobrancas') {
    const lim = Math.min(100, Number(q.get('limite')) || 20);
    const r = await asaas('GET', `/payments?limit=${lim}&offset=0`);
    return { ok: true, total: r.totalCount, cobrancas: (r.data ?? []).map((c: any) => ({
      id: c.id, status: c.status, valor: c.value, vencimento: c.dueDate, descricao: c.description ?? '',
      cliente: c.customer, referencia: c.externalReference ?? '', fatura: c.invoiceUrl ?? null, tipo: c.billingType
    })) };
  }

  if (metodo === 'GET' && caminho === '/saldo') {
    const s = await asaas('GET', '/finance/balance');
    return { ok: true, saldo: Number(s.balance) || 0 };
  }

  if (metodo === 'GET' && caminho === '/extrato') {
    const lim = Math.min(100, Number(q.get('limite')) || 30);
    const r = await asaas('GET', `/financialTransactions?limit=${lim}&offset=0`);
    return { ok: true, movimentacoes: (r.data ?? []).map((m: any) => ({
      id: m.id, data: m.date, valor: Number(m.value) || 0, saldo: Number(m.balance) || 0,
      tipo: m.type, descricao: m.description ?? '', cobrancaId: m.paymentId ?? null, transferenciaId: m.transferId ?? null
    })) };
  }

  if (metodo === 'GET' && caminho === '/chaves') {
    const r = await asaas('GET', '/pix/addressKeys?limit=50');
    return { ok: true, chaves: (r.data ?? []).map((k: any) => ({ id: k.id, chave: k.key, tipo: k.type, status: k.status, criadaEm: k.createdDate ?? null })) };
  }

  if (metodo === 'POST' && caminho === '/chaves') {
    const r = await asaas('POST', '/pix/addressKeys', { type: 'EVP' });
    return { ok: true, chave: { id: r.id, chave: r.key, tipo: r.type, status: r.status } };
  }

  if (metodo === 'DELETE' && caminho === '/chaves') {
    const id = q.get('id');
    if (!id) throw erro('Informe o id da chave.');
    await asaas('DELETE', '/pix/addressKeys/' + encodeURIComponent(id));
    return { ok: true, removida: id };
  }

  if (metodo === 'POST' && caminho === '/saque') {
    const valor = Number(String(corpo.valor).replace(',', '.'));
    const chave = String(corpo.chave ?? '').trim();
    const tipo = String(corpo.tipoChave ?? '').trim().toUpperCase();
    const tipos = ['CPF', 'CNPJ', 'EMAIL', 'PHONE', 'EVP'];
    if (!(valor > 0)) throw erro('Valor do saque inválido.');
    if (!chave) throw erro('Informe a chave PIX de destino.');
    if (!tipos.includes(tipo)) throw erro('Tipo de chave inválido. Use CPF, CNPJ, EMAIL, PHONE ou EVP.');
    if (MAX_SAQUE > 0 && valor > MAX_SAQUE) throw erro(`O saque máximo por operação é R$ ${MAX_SAQUE.toFixed(2)}.`);

    const saldo = await asaas('GET', '/finance/balance');
    const disponivel = Number(saldo.balance) || 0;
    if (valor > disponivel) throw erro(`Saldo insuficiente. Disponível: R$ ${disponivel.toFixed(2).replace('.', ',')}.`, 422);

    const t = await asaas('POST', '/transfers', {
      value: Number(valor.toFixed(2)),
      pixAddressKey: chave,
      pixAddressKeyType: tipo,
      description: String(corpo.descricao || 'Saque Free Does').slice(0, 140),
      operationType: 'PIX',
      externalReference: corpo.externalReference || undefined
    });
    return { ok: true, transferencia: {
      id: t.id, status: t.status, valor: t.value, chave: t.pixAddressKey ?? chave,
      tipoChave: t.pixAddressKeyType ?? tipo, data: t.dateCreated ?? new Date().toISOString(), descricao: t.description ?? ''
    } };
  }

  if (metodo === 'GET' && caminho === '/transferencias') {
    const lim = Math.min(100, Number(q.get('limite')) || 20);
    const r = await asaas('GET', `/transfers?limit=${lim}&offset=0`);
    return { ok: true, transferencias: (r.data ?? []).map((t: any) => ({
      id: t.id, status: t.status, valor: Number(t.value) || 0, tipo: t.type,
      chave: t.pixAddressKey ?? null, data: t.dateCreated, descricao: t.description ?? ''
    })) };
  }

  throw erro('Rota não encontrada: ' + metodo + ' ' + caminho, 404);
}

/* --------------------------------------------------------------- servidor ---- */
Deno.serve(async (req: Request) => {
  const url = new URL(req.url);
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

  // remove o prefixo da função: /functions/v1/asaas
  const partes = url.pathname.split('/').filter(Boolean);
  const i = partes.lastIndexOf('asaas');
  const caminho = '/' + (i >= 0 ? partes.slice(i + 1).join('/') : partes.join('/'));

  if (caminho.startsWith('/webhook')) {
    try { return await webhook(req); }
    catch (e) { return json({ ok: false, erro: String(e) }, 500); }
  }

  if (caminho === '/saude' || caminho === '/') {
    return json({ ok: true, servico: 'Free Does — proxy Asaas (Supabase)', ambiente: ASAAS_URL.includes('sandbox') ? 'sandbox' : 'producao' });
  }

  if (!ASAAS_KEY) return json({ ok: false, erro: 'Função sem ASAAS_KEY configurada.' }, 500);
  if (!ADM_TOKEN) return json({ ok: false, erro: 'Função sem ADM_TOKEN configurado.' }, 500);
  if ((req.headers.get('x-fd-token') ?? '') !== ADM_TOKEN) return json({ ok: false, erro: 'Token adm inválido.' }, 401);

  try {
    const corpo = req.method === 'POST' ? await req.json().catch(() => ({})) : {};
    return json(await rota(req.method, caminho, corpo, url.searchParams));
  } catch (e) {
    const err = e as Error & { status?: number; asaas?: any };
    const status = err.status && err.status >= 400 && err.status < 600 ? err.status : 502;
    return json({ ok: false, erro: err.asaas ? (err.asaas.errors ?? err.asaas.message ?? 'Erro no Asaas') : err.message, detalhe: err.asaas ?? null }, status);
  }
});
