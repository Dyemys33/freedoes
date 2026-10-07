# Free Does — pagamento por PIX (Asaas), saldo e saque

Tudo que o site precisa: o **checkout só aceita PIX** (não existe mais campo de cartão em lugar nenhum),
o **saldo da conta Asaas aparece no painel** e o admin **saca para uma chave PIX**.

---

## 1. O que já está pronto

| Onde | O que faz |
|---|---|
| Checkout (3º passo) | Gera a cobrança PIX no Asaas, mostra **QR Code** + **PIX copia e cola**, fica verificando o pagamento a cada 6 segundos |
| Painel → 💰 Financeiro | Liga/desliga a API, testa a conexão, mostra **saldo**, **extrato**, **chaves PIX**, **cobranças** geradas e **saques feitos** |
| Chip 💰 Saldo (topo do painel) | Mostra o saldo atualizado (consulta a cada 60 s enquanto o painel está aberto) |
| Saque | Manda o dinheiro de verdade para uma chave PIX (CPF, CNPJ, e-mail, telefone ou aleatória), respeitando o saldo |
| servidor/asaas-proxy.js | Servidor pronto (Node 18+, zero dependências) que conversa com o Asaas |
| supabase/functions/asaas/ | Mesma coisa em Edge Function do Supabase + recebe o **webhook** e marca o pedido como pago sozinho |

Testado de ponta a ponta contra um Asaas falso: rotas, segurança do token, QR Code, validações de CPF/valor e saque.

---

## 2. Ligar o pagamento (2 minutos)

O jeito mais rápido — servidor próprio:

```bash
cd free-does/servidor
ASAAS_KEY="cole_a_sua_chave_aqui"  ADM_TOKEN="invente_um_token_forte"  node asaas-proxy.js
```

Sai algo como `http://localhost:8787`. Ele usa a produção do Asaas por padrão.

Variáveis disponíveis:

| Variável | Para que serve | Padrão |
|---|---|---|
| `ASAAS_KEY` | Sua chave de API do Asaas (obrigatória) | — |
| `ADM_TOKEN` | Senha que o painel do site precisa mandar (obrigatória) | — |
| `ASAAS_URL` | Trocar o ambiente — sandbox: `https://api-sandbox.asaas.com/v3` | `https://api.asaas.com/v3` |
| `PORT` | Porta do servidor | `8787` |
| `MAX_SAQUE` | Teto de cada saque em R$ (ex.: `500`). `0` = sem teto | sem teto |
| `ORIGENS` | Domínios liberados para chamar o servidor, separados por vírgula | qualquer um |

> ⚠️ **No preview daqui do sandbox**, `localhost` é o computador do servidor, não o seu navegador.
> Para testar clicando, use um servidor com endereço público (Render, Railway, VPS ou a Edge Function do Supabase)
> e cole essa URL https no painel. O site foi feito para o painel apontar para qualquer URL.

Alternativa sem servidor próprio — **Edge Function do Supabase**:
publique a função em `supabase/functions/asaas/` e configure nela as variáveis:
`ASAAS_KEY`, `ADM_TOKEN` e `SUPABASE_SERVICE_KEY`. A URL fica
`https://kilpznpvadshohvdybrf.supabase.co/functions/v1/asaas` — cole ela no painel (o site já acrescenta `/api`).

---

## 3. Ligando dentro do painel

1. Abra o painel: **9 toques no logo “Free Does”** no celular (no computador, **9× a tecla espaço**) → senha **`adm`**.
2. Vá na aba **💰 Financeiro**.
3. Cole a **URL do servidor** (ex.: `https://seu-proxy.onrender.com`) e o **token** que você usou em `ADM_TOKEN`.
4. **Salvar** → **Testar conexão**. Deve aparecer *Conectado*.
5. Escolha se você quer produção ou sandbox no seletor ao lado.

A partir daí, cada checkout gera uma cobrança PIX real e o chip **💰 Saldo** passa a mostrar o dinheiro que entrou.

---

## 4. Chave PIX e saque

Na mesma aba, seção de chaves:

- **Nova chave (aleatória)**: cria uma chave `EVP` na sua conta Asaas (o Asaas só cria chaves aleatórias por API — para usar CPF, e-mail ou telefone, cadastre pelo site/app do Asaas e depois só informe na hora do saque).
- **Saque**: escolha o valor, o tipo de chave, informe a chave e digite **SAQUE** para liberar o botão.
  O servidor confere o saldo disponível no Asaas antes de enviar — saque maior que o saldo é recusado.
- Se você definir `MAX_SAQUE`, qualquer saque acima do teto também é recusado.
- Todo saque enviado fica listado em *Saques feitos*, com o id da transferência.

⚠️ A conta Asaas precisa estar com **cadastro 100% aprovado e a verificação de “selfie/liveness” feita** para o PIX e o saque funcionarem.

---

## 5. Deixar o pedido “pago” sozinho (webhook)

Sem webhook, o site já confere o pagamento a cada 6 segundos enquanto o cliente está na tela.
Com o webhook, o pedido vira **pago** mesmo que o cliente feche a página:

- URL: `https://kilpznpvadshohvdybrf.supabase.co/functions/v1/asaas/webhook`
- Eventos: `PAYMENT_RECEIVED` e `PAYMENT_CONFIRMED`
- Token enviado pelo Asaas: configure o mesmo valor da variável `ADM_TOKEN` / `asaas-access-token` na função
- Na criação da cobrança o site salva `pg_cobranca_id` no pedido — é por ele que o webhook encontra o pedido e marca `pg_status` = `RECEIVED`/`CONFIRMED`.

(Os detalhes estão na seção 8.5 do `supabase.sql`.)

---

## 6. Segurança — leia isto

- **Troque a chave.** A chave de produção foi colada no chat, então considere que ela pode ter vazado:
  gere uma nova no painel do Asaas e use a nova no servidor. Nada com `aact_` fica no site (0 ocorrências) nem no código do servidor.
- A chave **só** vive no servidor (variável de ambiente). O navegador nunca vê a chave.
- O `ADM_TOKEN` é a única porta do proxy: sem ele, tudo responde **401**. Não use token curto.
- Use `ORIGENS=https://seudominio.com` em produção para o servidor só aceitar o seu site.
- O site **nunca** guarda número de cartão nem CVV — e agora nem pede: só PIX.
- Teste sem gastar dinheiro: `ASAAS_URL="https://api-sandbox.asaas.com/v3"` (sandbox não move dinheiro de verdade).

---

## 7. Rodar os testes

```bash
cd free-does && ./testes.sh
```

Roda as 4 suítes (lógica do site, fluxo completo no navegador falso, Supabase e contas/vitrine).
Nenhuma delas chama a API real do Asaas — o Asaas é sempre simulado.
