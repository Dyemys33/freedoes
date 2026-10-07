-- ============================================================================
--  FREE DOES — BANCO DE DADOS (SUPABASE)
--  Projeto: https://kilpznpvadshohvdybrf.supabase.co
--
--  COMO USAR:
--    1. Abra o painel do Supabase → menu "SQL Editor" → "New query"
--    2. Cole TODO este arquivo e clique em "Run"
--    3. Vá em "Settings → API" e copie a chave "anon public"
--    4. No site, abra o painel adm (9 toques no logo) → aba "Dados"
--       e cole a chave no campo "Chave anon do Supabase" → Salvar
-- ============================================================================

-- Extensão usada para gerar IDs e para o trigger de atualização
create extension if not exists pgcrypto;


-- ============================================================================
--  1) ITENS DA VITRINE  (as doações já publicadas e visíveis no site)
-- ============================================================================
create table if not exists public.itens (
  id                text primary key,
  criado_em         bigint       not null default 0,
  atualizado_em     timestamptz  not null default now(),
  nome              text         not null,
  descricao         text         default '',
  imagem            text         default '',
  link              text         default '',
  frete             numeric(10,2),
  valor_referencia  numeric(10,2),
  categoria         text         default '',
  verificado        boolean      not null default false,
  ativo             boolean      not null default true
);

comment on table  public.itens is 'Itens doados que aparecem na vitrine. O produto é grátis: o campo frete é o único valor cobrado.';
comment on column public.itens.frete            is 'Valor do frete em reais — único valor pago por quem recebe.';
comment on column public.itens.valor_referencia is 'Valor de mercado do item, só para mostrar riscado (não é cobrado).';
comment on column public.itens.verificado       is 'Selo de doador verificado (conta aprovada com documento).';


-- ============================================================================
--  2) DOAÇÕES ENVIADAS  (fila de moderação da aba "Quero Doar")
-- ============================================================================
create table if not exists public.doacoes (
  id            text primary key,
  criado_em     bigint       not null default 0,
  atualizado_em timestamptz  not null default now(),
  doador        text         not null,
  whatsapp      text         default '',
  item          text         not null,
  link          text         default '',
  frete         numeric(10,2),
  categoria     text         default '',
  descricao     text         default '',
  imagem        text         default '',
  email_doador  text         default '',
  verificado    boolean      not null default false,
  status        text         not null default 'pendente'
                check (status in ('pendente','aprovado','recusado')),
  revisado_em   bigint
);

comment on table public.doacoes is 'Doações enviadas pelo formulário público, aguardando aprovação do adm.';


-- ============================================================================
--  3) CONTAS  (cadastro + verificação de e-mail, facial e de identidade)
-- ============================================================================
create table if not exists public.contas (
  id               text primary key,          -- protocolo: FD-XXXXXX
  criado_em        bigint       not null default 0,
  atualizado_em    timestamptz  not null default now(),
  nome             text         not null,
  email            text         not null unique,
  senha_hash       text         not null,
  whatsapp         text         default '',
  email_verificado boolean      not null default false,
  selfie           text,                      -- foto da verificação facial (base64)
  liveness_ok      boolean      not null default false,
  rosto_detectado  boolean      not null default false,
  selfie_quando    bigint,
  selfie_via       text         default 'camera',
  doc_tipo         text         default 'RG',
  doc_frente       text,                      -- documento (frente)
  doc_verso        text,                      -- documento (verso)
  doc_selfie       text,                      -- titular segurando o documento
  observacao       text         default '',
  status           text         not null default 'pendente'
                   check (status in ('pendente','aprovado','recusado')),
  motivo           text         default '',
  revisado_em      bigint
);

comment on table public.contas is 'Contas com verificação de identidade. ATENÇÃO: contém dados pessoais e imagens — trate conforme a LGPD.';


-- ============================================================================
--  4) PEDIDOS  (doações confirmadas: frete pago + endereço de entrega)
-- ============================================================================
create table if not exists public.pedidos (
  id                     text primary key,    -- protocolo: PD-XXXXXX
  criado_em              bigint       not null default 0,
  atualizado_em          timestamptz  not null default now(),

  -- item doado
  item_nome              text         not null,
  item_tipo              text         default 'doação',
  item_link              text         default '',
  item_imagem            text         default '',
  item_preco             text         default '',
  item_frete             text         default '',
  item_valor_referencia  text         default '',

  -- quem recebe
  comprador_nome         text         not null,
  comprador_cpf          text         default '',
  comprador_nasc         text         default '',
  comprador_idade        integer,
  comprador_email        text         default '',
  comprador_tel          text         default '',

  -- endereço de entrega
  end_cep                text         default '',
  end_rua                text         default '',
  end_numero             text         default '',
  end_comp               text         default '',
  end_bairro             text         default '',
  end_cidade             text         default '',
  end_uf                 text         default '',

  -- pagamento (NUNCA guardamos o número completo do cartão nem o CVV)
  pg_metodo              text         default 'Cartão de crédito',
  pg_bandeira            text         default '',
  pg_ultimos4            text         default '',
  pg_titular             text         default '',
  pg_validade            text         default '',
  pg_parcelas            integer      default 1,
  pg_valor_parcela       numeric(10,2),
  pg_total               numeric(10,2),
  pg_numero_guardado     boolean      not null default false,

  status                 text         not null default 'aguardando'
                         check (status in ('aguardando','pago','cancelado')),
  conta_email            text         default '',
  revisado_em            bigint
);

comment on table  public.pedidos is 'Pedidos de doação confirmados: frete pago, dados de quem recebe e endereço de entrega.';
comment on column public.pedidos.pg_ultimos4        is 'Apenas os 4 últimos dígitos do cartão, para identificar o pedido.';
comment on column public.pedidos.pg_numero_guardado is 'Sempre false: número completo e CVV nunca são armazenados (PCI-DSS).';


-- ============================================================================
--  4.1) COLUNAS DO PAGAMENTO PIX (Asaas) — roda mesmo se a tabela já existir
-- ============================================================================
alter table public.pedidos add column if not exists pg_cobranca_id  text;
alter table public.pedidos add column if not exists pg_status       text default '';
alter table public.pedidos add column if not exists pg_pix_payload  text default '';
alter table public.pedidos add column if not exists pg_pix_expiracao timestamptz;

create index if not exists pedidos_cobranca_idx on public.pedidos (pg_cobranca_id);

comment on column public.pedidos.pg_cobranca_id is 'ID da cobrança no Asaas (usado pelo webhook para marcar o pedido como pago).';
comment on column public.pedidos.pg_status      is 'Último status conhecido da cobrança no Asaas (PENDING, RECEIVED...).';


-- ============================================================================
--  5) ÍNDICES
-- ============================================================================
create index if not exists itens_criado_idx    on public.itens    (criado_em desc);
create index if not exists itens_ativo_idx     on public.itens    (ativo, criado_em desc);
create index if not exists doacoes_status_idx  on public.doacoes  (status, criado_em desc);
create index if not exists contas_status_idx   on public.contas   (status, criado_em desc);
create index if not exists contas_email_idx    on public.contas   (email);
create index if not exists pedidos_status_idx  on public.pedidos  (status, criado_em desc);
create index if not exists pedidos_email_idx   on public.pedidos  (comprador_email);


-- ============================================================================
--  6) TRIGGER — mantém "atualizado_em" sempre correto
-- ============================================================================
create or replace function public.tocar_atualizado_em()
returns trigger
language plpgsql
as $$
begin
  new.atualizado_em = now();
  return new;
end;
$$;

do $$
declare
  t text;
begin
  foreach t in array array['itens','doacoes','contas','pedidos'] loop
    execute format('drop trigger if exists trg_atualizado_em on public.%I', t);
    execute format(
      'create trigger trg_atualizado_em before update on public.%I
       for each row execute function public.tocar_atualizado_em()', t);
  end loop;
end $$;


-- ============================================================================
--  7) SEGURANÇA (RLS)
--
--  ATENÇÃO — LEIA ANTES:
--  O site fala com o banco usando a chave "anon", que fica visível no navegador.
--  As políticas abaixo são de MODO DEMONSTRAÇÃO: permitem que o site leia e
--  grave tudo (necessário porque o painel adm ainda não tem login de verdade).
--  Isso significa que QUALQUER PESSOA com a chave anon consegue ler as contas
--  e os pedidos — inclusive fotos de documento e dados pessoais.
--
--  Para produção, escolha UMA das opções:
--   (a) Ligar o Supabase Auth e trocar as políticas por "por usuário"
--       (auth.uid()), deixando as fotos de documento em um bucket privado;
--   (b) Tirar esses dados do navegador e passar tudo por uma API/Edge Function
--       com a chave service_role (que nunca vai para o cliente).
--  As políticas de produção estão comentadas no fim deste arquivo.
-- ============================================================================
alter table public.itens    enable row level security;
alter table public.doacoes  enable row level security;
alter table public.contas   enable row level security;
alter table public.pedidos  enable row level security;

-- permissões base para os papéis do Supabase
grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on public.itens, public.doacoes, public.contas, public.pedidos
  to anon, authenticated;

-- ITENS
drop policy if exists itens_leitura       on public.itens;
drop policy if exists itens_insercao      on public.itens;
drop policy if exists itens_atualizacao   on public.itens;
drop policy if exists itens_exclusao      on public.itens;
create policy itens_leitura     on public.itens for select to anon, authenticated using (true);
create policy itens_insercao    on public.itens for insert to anon, authenticated with check (true);
create policy itens_atualizacao on public.itens for update to anon, authenticated using (true) with check (true);
create policy itens_exclusao    on public.itens for delete to anon, authenticated using (true);

-- DOAÇÕES
drop policy if exists doacoes_leitura     on public.doacoes;
drop policy if exists doacoes_insercao    on public.doacoes;
drop policy if exists doacoes_atualizacao on public.doacoes;
drop policy if exists doacoes_exclusao    on public.doacoes;
create policy doacoes_leitura     on public.doacoes for select to anon, authenticated using (true);
create policy doacoes_insercao    on public.doacoes for insert to anon, authenticated with check (true);
create policy doacoes_atualizacao on public.doacoes for update to anon, authenticated using (true) with check (true);
create policy doacoes_exclusao    on public.doacoes for delete to anon, authenticated using (true);

-- CONTAS
drop policy if exists contas_leitura     on public.contas;
drop policy if exists contas_insercao    on public.contas;
drop policy if exists contas_atualizacao on public.contas;
drop policy if exists contas_exclusao    on public.contas;
create policy contas_leitura     on public.contas for select to anon, authenticated using (true);
create policy contas_insercao    on public.contas for insert to anon, authenticated with check (true);
create policy contas_atualizacao on public.contas for update to anon, authenticated using (true) with check (true);
create policy contas_exclusao    on public.contas for delete to anon, authenticated using (true);

-- PEDIDOS
drop policy if exists pedidos_leitura     on public.pedidos;
drop policy if exists pedidos_insercao    on public.pedidos;
drop policy if exists pedidos_atualizacao on public.pedidos;
drop policy if exists pedidos_exclusao    on public.pedidos;
create policy pedidos_leitura     on public.pedidos for select to anon, authenticated using (true);
create policy pedidos_insercao    on public.pedidos for insert to anon, authenticated with check (true);
create policy pedidos_atualizacao on public.pedidos for update to anon, authenticated using (true) with check (true);
create policy pedidos_exclusao    on public.pedidos for delete to anon, authenticated using (true);


-- ============================================================================
--  8) EXEMPLO DE ITEM (opcional — descomente para testar a vitrine)
-- ============================================================================
-- insert into public.itens (id, criado_em, nome, descricao, imagem, link, frete, valor_referencia, categoria, verificado)
-- values (
--   'exemplo-1', (extract(epoch from now())*1000)::bigint,
--   'Fone Bluetooth Pro Max', 'Item doado, funcionando perfeitamente. Você paga só o frete.',
--   '', 'https://exemplo.com/item', 24.90, 299.90, 'DOAÇÃO', true
-- );


-- ============================================================================
--  8.5) WEBHOOK DO ASAAS (opcional, recomendado)
--     No painel do Asaas → Integrações → Webhooks, cadastre a URL:
--       https://kilpznpvadshohvdybrf.supabase.co/functions/v1/asaas/webhook
--     Eventos: PAYMENT_RECEIVED e PAYMENT_CONFIRMED
--     O token do webhook é conferido pela Edge Function (segredo ASAAS_WEBHOOK_TOKEN).
--     Ela atualiza o pedido sozinha:  status = 'pago'
--     O vínculo é feito por pg_cobranca_id = pagamento.id.
-- ============================================================================


-- ============================================================================
--  9) POLÍTICAS DE PRODUÇÃO (descomente quando ligar o Supabase Auth)
--     Apague as políticas de demonstração da seção 7 antes de usar estas.
-- ============================================================================
-- -- vitrine: leitura pública apenas de itens ativos
-- create policy itens_leitura_publica on public.itens
--   for select to anon using (ativo = true);
--
-- -- adm: somente usuários autenticados com a flag de administrador
-- create policy adm_total on public.itens
--   for all to authenticated
--   using (exists (select 1 from public.admins a where a.id = auth.uid()))
--   with check (exists (select 1 from public.admins a where a.id = auth.uid()));
--
-- -- contenção de dados sensíveis: contas e pedidos nunca expostos ao anon
-- revoke select on public.contas, public.pedidos from anon;
--
-- -- tabela de administradores
-- -- create table public.admins (id uuid primary key references auth.users(id), nome text);
