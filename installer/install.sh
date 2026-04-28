#!/usr/bin/env bash
# Instalador one-liner da MaxBank Skill para OpenClaw.
#
# Uso:
#   curl -fsSL https://raw.githubusercontent.com/appmaxbrasil/openclaw-max-banking-skill/main/installer/install.sh | bash
#
# Variáveis opcionais:
#   MAXBANK_ENV      Ambiente do setup: prod (default) | homolog | local
#   MAXBANK_MCP_URL  URL do MCP (obrigatório se MAXBANK_ENV=local)
#   MAXBANK_BRANCH   Branch do repositório (default: main)
#   MAXBANK_REPO     URL do repo (default: repo oficial appmaxbrasil)
#   MAXBANK_CODE     Código de pareamento (pula o prompt interativo)

set -euo pipefail

REPO_URL="${MAXBANK_REPO:-https://github.com/appmaxbrasil/openclaw-max-banking-skill.git}"
BRANCH="${MAXBANK_BRANCH:-main}"
INSTALL_DIR="$HOME/.openclaw/skills/max-banking"
ENV="${MAXBANK_ENV:-prod}"
MCP_URL="${MAXBANK_MCP_URL:-}"

info()  { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
ok()    { printf '\033[1;32m✓\033[0m %s\n' "$*"; }
warn()  { printf '\033[1;33m!\033[0m %s\n' "$*" >&2; }
fail()  { printf '\033[1;31m✗\033[0m %s\n' "$*" >&2; exit 1; }

# ── 1/4 Pré-requisitos ───────────────────────────────────────────────────────

info "1/4 Verificando pré-requisitos..."
command -v git  >/dev/null 2>&1 || fail "git não encontrado. Instale o git e tente novamente."
command -v bash >/dev/null 2>&1 || fail "bash não encontrado."
command -v node >/dev/null 2>&1 || warn "node não encontrado — o setup pode falhar. Instale o Node.js antes de prosseguir."
ok "pré-requisitos OK"

# ── 2/4 Clone / atualização ──────────────────────────────────────────────────

info "2/4 Instalando skill em $INSTALL_DIR..."
mkdir -p "$(dirname "$INSTALL_DIR")"

if [[ -d "$INSTALL_DIR/.git" ]]; then
  info "Repositório já existe — atualizando (branch $BRANCH)..."
  git -C "$INSTALL_DIR" fetch --quiet origin "$BRANCH"
  git -C "$INSTALL_DIR" checkout --quiet "$BRANCH"
  git -C "$INSTALL_DIR" reset --hard --quiet "origin/$BRANCH"
elif [[ -e "$INSTALL_DIR" ]]; then
  BACKUP="${INSTALL_DIR}.bak.$(date +%s)"
  warn "Diretório existe mas não é um repositório git. Movendo para $BACKUP"
  mv "$INSTALL_DIR" "$BACKUP"
  git clone --quiet --branch "$BRANCH" "$REPO_URL" "$INSTALL_DIR"
else
  git clone --quiet --branch "$BRANCH" "$REPO_URL" "$INSTALL_DIR"
fi
ok "skill disponível em $INSTALL_DIR"

# ── 3/4 Pareamento ───────────────────────────────────────────────────────────

info "3/4 Pareamento"

PAIRING_CODE="${MAXBANK_CODE:-}"

if [[ -z "$PAIRING_CODE" ]]; then
  # Ao rodar via `curl ... | bash`, stdin é o pipe — precisa ler do tty.
  if [[ -r /dev/tty ]]; then
    printf '\nInforme o código de pareamento MaxBank: '
    IFS= read -r PAIRING_CODE </dev/tty || true
  else
    fail "Sem tty disponível. Defina MAXBANK_CODE=<codigo> e tente novamente."
  fi
fi

PAIRING_CODE="${PAIRING_CODE//[[:space:]]/}"
[[ -z "$PAIRING_CODE" ]] && fail "Código de pareamento vazio."

info "Executando setup.sh (ambiente: $ENV)..."
if [[ "$ENV" == "local" ]]; then
  [[ -z "$MCP_URL" ]] && fail "MAXBANK_ENV=local exige MAXBANK_MCP_URL."
  bash "$INSTALL_DIR/scripts/setup.sh" "$PAIRING_CODE" "$ENV" "$MCP_URL"
else
  bash "$INSTALL_DIR/scripts/setup.sh" "$PAIRING_CODE" "$ENV"
fi
ok "setup concluído"

# ── 4/4 Reinicialização do gateway ──────────────────────────────────────────

info "4/4 Reiniciando OpenClaw gateway..."
if command -v openclaw >/dev/null 2>&1; then
  if openclaw gateway restart; then
    ok "gateway reiniciado"
  else
    warn "Falha ao reiniciar o gateway — rode manualmente: openclaw gateway restart"
  fi
else
  warn "CLI 'openclaw' não encontrado no PATH — rode manualmente: openclaw gateway restart"
fi

# ── Mensagem final ───────────────────────────────────────────────────────────

cat <<'EOF'

────────────────────────────────────────────────────────────────
  MaxBank Skill instalada com sucesso.

  Para carregar a skill no contexto, rode no OpenClaw:

      /new

  Depois é só pedir, por exemplo:

      "qual meu saldo?"
      "me mostre os dados da minha conta"
────────────────────────────────────────────────────────────────
EOF
