// Smoke tests para scripts/maxbank.sh — testa a parte de parsing de argumentos
// e detecção de erros sem precisar de mcporter real. Usa node:test (built-in)
// e invoca o shell via spawn (black-box).
//
// Executar localmente:
//   node --test tests/maxbank.test.js

'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SCRIPT = path.join(__dirname, '..', 'scripts', 'maxbank.sh');

// Cria um ambiente isolado: HOME temporário + stub de mcporter no PATH.
// O stub satisfaz check_mcporter_config() para que os testes de parsing
// de argumentos cheguem no branch correspondente do case.
function setupMockEnv({ withSession = true } = {}) {
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'maxbank-sh-home-'));
  const tmpBin = fs.mkdtempSync(path.join(os.tmpdir(), 'maxbank-sh-bin-'));

  // Stub de mcporter: retorna "banking:" para config list e JSON para call
  const mcporterPath = path.join(tmpBin, 'mcporter');
  fs.writeFileSync(
    mcporterPath,
    `#!/bin/sh
case "$1" in
  config)
    case "$2" in
      list) echo "banking:"; exit 0 ;;
    esac
    ;;
  call)
    # Resposta dummy pra qualquer tool call — os testes não dependem do conteúdo
    echo '{"ok": true}'
    exit 0
    ;;
esac
exit 0
`,
    { mode: 0o755 }
  );

  if (withSession) {
    const secretsDir = path.join(tmpHome, '.openclaw', 'secrets', 'maxbank');
    fs.mkdirSync(secretsDir, { recursive: true, mode: 0o700 });
    fs.writeFileSync(path.join(secretsDir, 'agent_key'), 'fake_key\n', { mode: 0o600 });
    fs.writeFileSync(
      path.join(secretsDir, 'session.json'),
      JSON.stringify({
        environment: 'local',
        phone_number: '+5511999999999',
        mcp_base_url: 'http://127.0.0.1:0/mcp',
        paired_at: '2026-04-20T00:00:00Z',
      }),
      { mode: 0o600 }
    );
  }

  return {
    env: {
      HOME: tmpHome,
      PATH: `${tmpBin}:${process.env.PATH}`,
    },
    cleanup: () => {
      fs.rmSync(tmpHome, { recursive: true, force: true });
      fs.rmSync(tmpBin, { recursive: true, force: true });
    },
  };
}

function runScript(args, { env = {}, timeoutMs = 5_000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn('bash', [SCRIPT, ...args], {
      env: { ...process.env, ...env },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (c) => (stdout += c.toString()));
    child.stderr.on('data', (c) => (stderr += c.toString()));
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`timeout\nstdout: ${stdout}\nstderr: ${stderr}`));
    }, timeoutMs);
    child.on('close', (status) => {
      clearTimeout(timer);
      resolve({ status, stdout, stderr, combined: stdout + stderr });
    });
    child.on('error', reject);
  });
}

test('sem argumentos imprime usage e falha', async () => {
  const r = await runScript([]);
  assert.notStrictEqual(r.status, 0);
  assert.match(r.stderr, /Uso: bash maxbank\.sh/);
});

test('ação desconhecida reporta erro', async () => {
  const mock = setupMockEnv();
  try {
    const r = await runScript(['acao-inexistente'], { env: mock.env });
    assert.notStrictEqual(r.status, 0);
    assert.match(r.combined, /Ação desconhecida/);
  } finally {
    mock.cleanup();
  }
});

test('conta sem sessão falha com "Nenhuma conta configurada"', async () => {
  const mock = setupMockEnv({ withSession: false });
  try {
    const r = await runScript(['conta'], { env: mock.env });
    assert.notStrictEqual(r.status, 0);
    assert.match(r.stderr, /Nenhuma conta configurada/);
  } finally {
    mock.cleanup();
  }
});

test('conta com sessão retorna ACCOUNT_OK e campos', async () => {
  const mock = setupMockEnv();
  try {
    const r = await runScript(['conta'], { env: mock.env });
    assert.strictEqual(r.status, 0, `stderr: ${r.stderr}`);
    assert.match(r.stdout, /ACCOUNT_OK/);
    assert.match(r.stdout, /PHONE=\+5511999999999/);
    assert.match(r.stdout, /ENV=local/);
  } finally {
    mock.cleanup();
  }
});

test('pix sem chave nem valor retorna PIX_INVALID_ARGS', async () => {
  const mock = setupMockEnv();
  try {
    const r = await runScript(['pix'], { env: mock.env });
    assert.notStrictEqual(r.status, 0);
    assert.match(r.combined, /PIX_INVALID_ARGS/);
  } finally {
    mock.cleanup();
  }
});

test('pix com chave e-mail mas sem valor retorna PIX_INVALID_ARGS', async () => {
  const mock = setupMockEnv();
  try {
    const r = await runScript(['pix', 'email@example.com'], { env: mock.env });
    assert.notStrictEqual(r.status, 0);
    assert.match(r.combined, /PIX_INVALID_ARGS/);
  } finally {
    mock.cleanup();
  }
});

test('pix-validate-qr sem argumento rejeita', async () => {
  const mock = setupMockEnv();
  try {
    const r = await runScript(['pix-validate-qr'], { env: mock.env });
    assert.notStrictEqual(r.status, 0);
    assert.match(r.combined, /PIX_VALIDATE_QR_INVALID_ARGS/);
  } finally {
    mock.cleanup();
  }
});

test('pix-validate-qr com texto que não começa com 00020 rejeita', async () => {
  const mock = setupMockEnv();
  try {
    const r = await runScript(['pix-validate-qr', 'nao-e-qr-code'], { env: mock.env });
    assert.notStrictEqual(r.status, 0);
    assert.match(r.combined, /PIX_VALIDATE_QR_INVALID_ARGS/);
    assert.match(r.combined, /00020/);
  } finally {
    mock.cleanup();
  }
});

test('billet sem linha digitável retorna BILLET_INVALID_ARGS', async () => {
  const mock = setupMockEnv();
  try {
    const r = await runScript(['billet'], { env: mock.env });
    assert.notStrictEqual(r.status, 0);
    assert.match(r.combined, /BILLET_INVALID_ARGS/);
  } finally {
    mock.cleanup();
  }
});

test('billet com code= e amount= extra rejeita (anti-hallucination)', async () => {
  const mock = setupMockEnv();
  try {
    const r = await runScript(['billet', 'code=1234567890', 'amount=50'], { env: mock.env });
    assert.notStrictEqual(r.status, 0);
    assert.match(r.combined, /BILLET_TOO_MANY_ARGS/);
  } finally {
    mock.cleanup();
  }
});

test('billet com code= duplicado rejeita', async () => {
  const mock = setupMockEnv();
  try {
    const r = await runScript(['billet', 'code=111', 'code=222'], { env: mock.env });
    assert.notStrictEqual(r.status, 0);
    assert.match(r.combined, /BILLET_TOO_MANY_ARGS/);
  } finally {
    mock.cleanup();
  }
});

test('aliases de setup não disparam check_mcporter_config', async () => {
  // setup delega para setup.sh. Vamos apenas verificar que o script aceita
  // o alias "conectar" sem exigir mcporter configurado antes.
  // Passamos sem HOME/PATH customizado — se aceitasse aliases errados, falharia
  // com "Ação desconhecida". Esperamos que chegue no setup.sh e falhe por
  // outro motivo (args insuficientes pro setup, não ação desconhecida).
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'maxbank-setup-'));
  try {
    const r = await runScript(['conectar'], { env: { HOME: tmpHome } });
    // setup.sh vai falhar por faltar pairing_code, mas NÃO por ação desconhecida
    assert.notStrictEqual(r.status, 0);
    assert.doesNotMatch(r.combined, /Ação desconhecida/);
  } finally {
    fs.rmSync(tmpHome, { recursive: true, force: true });
  }
});
