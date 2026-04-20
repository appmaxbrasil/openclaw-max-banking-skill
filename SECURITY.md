# Security Policy

## Versões suportadas

Esta skill é atualizada continuamente na branch `main`. Somente a versão mais recente recebe correções de segurança.

| Versão | Suportada |
|--------|-----------|
| main (latest) | ✅ |
| Tags anteriores | ❌ |

## Reportando uma vulnerabilidade

**Não abra issues públicas para vulnerabilidades de segurança.**

Use um dos canais privados abaixo:

1. **GitHub Security Advisories (preferencial)** — abra um relato em:
   https://github.com/appmaxbrasil/openclaw-max-banking-skill/security/advisories/new

2. **E-mail** — `security@maxbank.ai`

Ao reportar, inclua quando possível:

- Descrição da vulnerabilidade e impacto esperado
- Passos para reproduzir (prova de conceito)
- Versão/commit afetado
- Componentes envolvidos (SKILL.md, scripts, workflows, etc.)

## Prazo de resposta

- **Confirmação de recebimento:** até 3 dias úteis
- **Avaliação inicial + plano de mitigação:** até 10 dias úteis
- **Correção pública:** divulgação coordenada após patch disponível

## Escopo

Esta política cobre:

- Código desta skill (`SKILL.md`, `scripts/`, workflows)
- Configurações de autenticação com o MCP MaxBank
- Manipulação de `agent_key` e `session.json` em `~/.openclaw/secrets/maxbank/`

Fora do escopo:

- Vulnerabilidades no `mcporter`, OpenClaw, Node.js ou dependências de terceiros — reporte no projeto correspondente
- Problemas de configuração específicos da VM/ambiente do usuário
