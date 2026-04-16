# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

MaxBank Skill for OpenClaw — a skill that connects OpenClaw (LLM assistant) to MaxBank's banking API via MCP (Model Context Protocol). Enables balance queries, PIX transfers, and boleto payments. All communication flows through `mcporter` as an MCP client with auth headers injected automatically.

**Language:** Portuguese (Brazilian) — all user-facing text, SKILL.md instructions, and script comments are in pt-BR.

## Architecture

```
User → OpenClaw (LLM) → exec maxbank.sh → mcporter → Hosted MCP Server → Banking API
                                            ↑
                              Authorization: Bearer <agent_key>
                              (injected via mcporter config header)
```

- **`SKILL.md`** — LLM-facing instructions with workflows, rules, and conversation patterns. This is the core "brain" of the skill — it defines how the LLM should behave, collect data, and respond.
- **`scripts/maxbank.sh`** — Unified CLI entry point. Dispatches actions (saldo, conta, setup, pix, pix-validate-qr, billet, status) and handles argument parsing/normalization before calling `mcporter`.
- **`scripts/setup.sh`** — Setup orchestrator: installs mcporter + zbar, copies skill files, configures `openclaw.json`, runs pairing via `connect-mcp.js`, then configures mcporter with auth header.
- **`scripts/connect-mcp.js`** — Node.js script that performs MCP JSON-RPC pairing (`tools/call` → `pairing_exchange`). Saves `agent_key` and `session.json` to `~/.openclaw/secrets/maxbank/`.
- **`clawhub.json`** — Package manifest for ClaHub registry.

## Key Design Decisions

- **Fixed skill path:** SKILL.md references scripts via `$HOME/.openclaw/workspace/skills/max-banking/scripts/maxbank.sh`. OpenClaw's exec tool runs with `workdir=cwd` (not the skill directory), so relative paths and `{baseDir}` don't work — the full path with `$HOME` is required. The skill must be installed at `~/.openclaw/workspace/skills/max-banking/`.
- **No local proxy:** Auth is injected via mcporter's `--header` config, not through a local proxy server.
- **Single-argument billet:** The `banking_billet` MCP tool accepts only `code=<digitavel>`. Extra params (amount, description) cause 422 errors. The shell script enforces this with `BILLET_TOO_MANY_ARGS` validation.
- **QR validation before PIX creation:** QR PIX (`00020...` payloads) must be validated first via `pix-validate-qr` to check if amount is embedded. This is a two-step flow, not optional.
- **Payments are immediate:** `pix` and `billet` commands create real payments on execution. There is no draft/preview/confirmation step in the backend. SKILL.md enforces post-execution language rules to prevent duplicate payments. QR PIX with embedded amount requires user confirmation BEFORE execution.
- **Positional args only for PIX:** SKILL.md instructs the LLM to always use positional format (`pix KEY AMOUNT`) and never mix with named format (`code=... amount:...`) to avoid parsing failures in maxbank.sh.
- **Smart skill install detection:** `setup.sh` checks multiple known directories before copying the skill, avoiding duplicates across `workspace/skills/`, `~/.openclaw/skills/`, etc.

## Environments

| Env      | MCP URL |
|----------|---------|
| prod     | `https://maxbank-mcp.max.com.br/mcp` |
| homolog  | `https://mcp-homologacao.maxbank.ai/mcp` |
| local    | User-provided ngrok URL |

## Storage

Secrets stored in `~/.openclaw/secrets/maxbank/` with `600` permissions:
- `agent_key` — long-lived API key from pairing
- `session.json` — environment, phone, account_id, MCP URL, paired_at

## Testing / Running

No test suite exists. To test manually:

```bash
# Run any action
bash scripts/maxbank.sh saldo
bash scripts/maxbank.sh conta
bash scripts/maxbank.sh status
bash scripts/maxbank.sh setup <CODE> <ENV> [URL]
bash scripts/maxbank.sh pix <KEY> <AMOUNT>
bash scripts/maxbank.sh pix-validate-qr '<QR_CODE>'
bash scripts/maxbank.sh billet <LINHA_DIGITAVEL>
```

Requires `mcporter` (npm) and `node` installed. Setup also installs `zbar` for QR/barcode image reading.
