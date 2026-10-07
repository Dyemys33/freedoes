#!/usr/bin/env bash
# Free Does — roda todos os testes do site (nada aqui chama a API real do Asaas).
set -u
cd "$(dirname "$0")"
NODE="$(command -v node || true)"
[ -z "$NODE" ] && { echo "Precisa do Node 18+ instalado."; exit 1; }

# O jsdom costuma ficar instalado fora da pasta do projeto (ex.: /tmp/node_modules).
export NODE_PATH="${NODE_PATH:-/tmp/node_modules}:$PWD/node_modules"

falhas=0
roda () {
  echo
  echo "════════ $1 ════════"
  local saida
  saida=$("$NODE" "$2" 2>&1)
  echo "$saida" | tail -3
  if echo "$saida" | grep -qE "FALHA|[0-9]+ falharam" && ! echo "$saida" | grep -qE "RESULTADO: [0-9]+ passaram, 0 falharam"; then
    echo "$saida" | grep -E "FALHA|falharam"
    falhas=$((falhas+1))
  fi
}

roda "lógica do site (teste.js)"          teste.js
roda "fluxo completo no navegador falso"  e2e.js
roda "conversa com o Supabase"            e2e-supabase.js
roda "contas, registro e vitrine"         e2e-contas.js
roda "auditoria de interface"             auditoria.js

echo
if [ "$falhas" -eq 0 ]; then echo "✅ Tudo verde."; else echo "❌ $falhas suíte(s) com falha."; fi
exit "$falhas"
