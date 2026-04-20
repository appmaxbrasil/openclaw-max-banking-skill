// Smoke tests para scripts/connect-mcp.js usando node:test (built-in).
// Não requer package.json nem dependências externas.
//
// Executar localmente:
//   node --test tests/connect-mcp.test.js

'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { spawn } = require('node:child_process');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SCRIPT = path.join(__dirname, '..', 'scripts', 'connect-mcp.js');

// Cria um HOME isolado por teste para que o script escreva secrets
// em um tmpdir e não toque no $HOME real do desenvolvedor/CI.
function mkTempHome() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'maxbank-test-'));
  return dir;
}

function rmTempHome(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

// Versão async de spawn para não bloquear o event loop — essencial quando
// o teste sobe um mock HTTP server que precisa responder ao subprocess.
function runScript(args, { env = {}, timeoutMs = 10_000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn('node', [SCRIPT, ...args], {
      env: { ...process.env, ...env },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (c) => (stdout += c.toString()));
    child.stderr.on('data', (c) => (stderr += c.toString()));
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`timeout após ${timeoutMs}ms\nstdout: ${stdout}\nstderr: ${stderr}`));
    }, timeoutMs);
    child.on('close', (status) => {
      clearTimeout(timer);
      resolve({ status, stdout, stderr });
    });
    child.on('error', reject);
  });
}

// Cria um servidor MCP fake que responde JSON-RPC tools/call.
function startMockMcp(responder) {
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const rpcReq = JSON.parse(body);
      const response = responder(rpcReq);
      res.writeHead(response.status || 200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(response.body));
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({ server, url: `http://127.0.0.1:${port}/mcp` });
    });
  });
}

test('falha sem pairing_code', async () => {
  const r = await runScript([]);
  assert.strictEqual(r.status, 1);
  assert.match(r.stderr, /pairing_code obrigatório/);
});

test('falha sem MCP_URL', async () => {
  const r = await runScript(['ABCD-EF12']);
  assert.strictEqual(r.status, 1);
  assert.match(r.stderr, /MCP_URL obrigatório/);
});

test('falha quando MCP retorna isError com mensagem estruturada', async () => {
  const tmpHome = mkTempHome();
  const { server, url } = await startMockMcp(() => ({
    status: 200,
    body: {
      jsonrpc: '2.0',
      id: 1,
      result: {
        isError: true,
        content: [{ type: 'text', text: JSON.stringify({ message: 'PAIRING_CODE_INVALID' }) }],
      },
    },
  }));

  try {
    const r = await runScript(['WRONG-CODE', url, 'local'], { env: { HOME: tmpHome } });
    assert.strictEqual(r.status, 1);
    assert.match(r.stderr, /PAIRING_CODE_INVALID/);
  } finally {
    server.close();
    rmTempHome(tmpHome);
  }
});

test('sucesso grava agent_key e session.json com permissões corretas', async () => {
  const tmpHome = mkTempHome();
  const { server, url } = await startMockMcp(() => ({
    status: 200,
    body: {
      jsonrpc: '2.0',
      id: 1,
      result: {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              agent_key: 'max_live_test_abc123',
              account_id: 'acc_999',
              phone_number: '+5511999999999',
              scopes: ['balance:read', 'pix:write'],
              operator_id: 'op_1',
              agent_id: 'ag_1',
              config: { mcp_base_url: url },
            }),
          },
        ],
      },
    },
  }));

  try {
    const r = await runScript(['ABCD-EF12', url, 'local'], { env: { HOME: tmpHome } });
    assert.strictEqual(r.status, 0, `stderr: ${r.stderr}`);
    assert.match(r.stdout, /SETUP_OK/);
    assert.match(r.stdout, /PHONE=\+5511999999999/);
    assert.match(r.stdout, /ENV=local/);

    const secretsDir = path.join(tmpHome, '.openclaw', 'secrets', 'maxbank');
    const agentKeyPath = path.join(secretsDir, 'agent_key');
    const sessionPath = path.join(secretsDir, 'session.json');

    assert.ok(fs.existsSync(agentKeyPath), 'agent_key deve existir');
    assert.ok(fs.existsSync(sessionPath), 'session.json deve existir');

    const agentKey = fs.readFileSync(agentKeyPath, 'utf8').trim();
    assert.strictEqual(agentKey, 'max_live_test_abc123');

    const session = JSON.parse(fs.readFileSync(sessionPath, 'utf8'));
    assert.strictEqual(session.account_id, 'acc_999');
    assert.strictEqual(session.phone_number, '+5511999999999');
    assert.strictEqual(session.environment, 'local');
    assert.ok(Array.isArray(session.scopes));
    assert.ok(session.paired_at, 'paired_at deve ser gravado');

    // Permissões 0600 (só owner pode ler/escrever)
    const agentKeyMode = fs.statSync(agentKeyPath).mode & 0o777;
    const sessionMode = fs.statSync(sessionPath).mode & 0o777;
    assert.strictEqual(agentKeyMode, 0o600, `agent_key mode deve ser 0600, foi ${agentKeyMode.toString(8)}`);
    assert.strictEqual(sessionMode, 0o600, `session.json mode deve ser 0600, foi ${sessionMode.toString(8)}`);
  } finally {
    server.close();
    rmTempHome(tmpHome);
  }
});
