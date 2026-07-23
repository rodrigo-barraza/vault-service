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
  local vault_key="${SCRIPT_DIR}/vault.key"

  if [ ! -f "$vault_key" ]; then
    fail "vault.key not found at ${vault_key} — run: npm run generate-key > vault.key"
  fi
  ok "vault.key found"

  info "Regenerating dependencies.generated.json from code..."
  if node "${SCRIPT_DIR}/scripts/generate-dependencies.js" > /dev/null; then
    ok "dependencies.generated.json up to date"
  else
    fail "dependency generation failed — see scripts/generate-dependencies.js"
  fi
}

# ── Vault-specific SSH sync (master .env + vault.key) ─────────
EXTRA_SSH_SYNC() {
  ssh "$DEPLOY_SSH_HOST" "mkdir -p '${DEPLOY_COMPOSE_DIR}/env' 2>/dev/null || sudo mkdir -p '${DEPLOY_COMPOSE_DIR}/env'"

  info "Syncing vault.key..."
  cat "${SCRIPT_DIR}/vault.key" | ssh "$DEPLOY_SSH_HOST" "cat > '${DEPLOY_COMPOSE_DIR}/env/vault.key'"
  ok "vault.key synced"

  info "Syncing projects.json..."
  cat "${SCRIPT_DIR}/projects.json" | ssh "$DEPLOY_SSH_HOST" "cat > '${DEPLOY_COMPOSE_DIR}/projects.json'"
  ok "projects.json synced"

  info "Syncing dependencies.generated.json..."
  cat "${SCRIPT_DIR}/dependencies.generated.json" | ssh "$DEPLOY_SSH_HOST" "cat > '${DEPLOY_COMPOSE_DIR}/dependencies.generated.json'"
  ok "dependencies.generated.json synced"
}

# ── Vault-specific SMB fallback sync ──────────────────────────
EXTRA_SMB_SYNC() {
  mkdir -p "${DEPLOY_SMB_DIR}/env"
  cp "${SCRIPT_DIR}/vault.key" "${DEPLOY_SMB_DIR}/env/vault.key"
  cp "${SCRIPT_DIR}/projects.json" "${DEPLOY_SMB_DIR}/projects.json"
  cp "${SCRIPT_DIR}/dependencies.generated.json" "${DEPLOY_SMB_DIR}/dependencies.generated.json"
}

source "${SCRIPT_DIR}/../deploy-kit/lib.sh"
