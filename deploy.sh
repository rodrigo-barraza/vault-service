#!/bin/bash
# ============================================================
# Vault — Build & Deploy to Synology NAS
#
# Thin wrapper — all logic lives in ../deploy-kit/lib.sh
# Hooks: validates vault.key, syncs master .env + vault.key
#
# Usage:
#   npm run deploy              # full deploy
#   npm run deploy -- --dry-run # validate without deploying
#   npm run deploy -- --skip-pull
#   npm run deploy -- --no-cache
# ============================================================

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
IMAGE_NAME="vault-service"
DISPLAY_NAME="🔐 Vault Service"
SKIP_ENV_DEPLOY="true"   # Vault uses master .env, not .env.deploy

# ── Vault-specific validation ─────────────────────────────────
EXTRA_VALIDATE() {
  local master_env="${SCRIPT_DIR}/.env"
  local vault_key="${SCRIPT_DIR}/vault.key"

  if [ ! -f "$master_env" ]; then
    fail "Master .env not found at ${master_env}"
  fi
  ok "Master .env found ($(wc -l < "$master_env") lines)"

  if [ ! -f "$vault_key" ]; then
    fail "vault.key not found at ${vault_key} — run: npm run generate-key > vault.key"
  fi
  ok "vault.key found"
}

# ── Vault-specific SSH sync (master .env + vault.key) ─────────
EXTRA_SSH_SYNC() {
  ssh "$DEPLOY_SSH_HOST" "mkdir -p '${DEPLOY_COMPOSE_DIR}/env' 2>/dev/null || sudo mkdir -p '${DEPLOY_COMPOSE_DIR}/env'"

  info "Syncing master .env..."
  cat "${SCRIPT_DIR}/.env" | ssh "$DEPLOY_SSH_HOST" "cat > '${DEPLOY_COMPOSE_DIR}/env/.env'"
  ok "Master .env synced"

  info "Syncing vault.key..."
  cat "${SCRIPT_DIR}/vault.key" | ssh "$DEPLOY_SSH_HOST" "cat > '${DEPLOY_COMPOSE_DIR}/env/vault.key'"
  ok "vault.key synced"
}

# ── Vault-specific SMB fallback sync ──────────────────────────
EXTRA_SMB_SYNC() {
  mkdir -p "${DEPLOY_SMB_DIR}/env"
  cp "${SCRIPT_DIR}/.env" "${DEPLOY_SMB_DIR}/env/.env"
  cp "${SCRIPT_DIR}/vault.key" "${DEPLOY_SMB_DIR}/env/vault.key"
}

source "${SCRIPT_DIR}/../deploy-kit/lib.sh"
