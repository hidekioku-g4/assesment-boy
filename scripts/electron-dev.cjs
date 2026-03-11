const { spawn, execSync } = require('child_process');
const path = require('path');
const http = require('http');
const dotenv = require('dotenv');

dotenv.config({ path: path.join(__dirname, '..', '.env') });

const isWin = process.platform === 'win32';
const npmCmd = isWin ? 'npm.cmd' : 'npm';
const electronCmd = isWin
  ? npmCmd
  : path.join(__dirname, '..', 'node_modules', '.bin', 'electron');

const VITE_PORT = 5212;
const SERVER_PORT = process.env.PORT || 37212;

/**
 * 指定ポートを使用しているプロセスを強制終了（起動前のクリーンアップ）
 */
function killProcessOnPort(port) {
  try {
    if (isWin) {
      const out = execSync(`netstat -ano | findstr ":${port}" | findstr "LISTEN"`, { encoding: 'utf8' });
      const pids = new Set(out.split('\n').map(l => l.trim().split(/\s+/).pop()).filter(Boolean).filter(p => p !== '0'));
      for (const pid of pids) {
        try {
          execSync(`taskkill /PID ${pid} /T /F`, { stdio: 'ignore' });
          console.log(`[electron-dev] Killed PID ${pid} on port ${port}`);
        } catch { /* already dead */ }
      }
    } else {
      execSync(`lsof -ti:${port} | xargs kill -9 2>/dev/null`, { stdio: 'ignore' });
    }
  } catch { /* no process on port */ }
}

/**
 * プロセスツリーごと強制終了（Windows は kill() だと子プロセスが残る）
 */
function killTree(child) {
  if (!child || child.killed) return;
  try {
    if (isWin && child.pid) {
      execSync(`taskkill /PID ${child.pid} /T /F`, { stdio: 'ignore' });
    } else {
      child.kill('SIGTERM');
    }
  } catch { /* already dead */ }
}

// 起動前に既存プロセスをクリーンアップ
console.log('[electron-dev] Cleaning up existing processes...');
killProcessOnPort(SERVER_PORT);
killProcessOnPort(VITE_PORT);

const env = {
  ...process.env,
  ELECTRON_START_URL: `http://localhost:${VITE_PORT}`,
  ELECTRON_DEVTOOLS: process.env.ELECTRON_DEVTOOLS || '1',
};

const spawnOpts = {
  stdio: 'inherit',
  env,
  shell: isWin,
};

// バックエンドサーバー起動
const server = spawn(npmCmd, ['run', 'dev'], spawnOpts);

// Viteフロントエンド開発サーバー起動
const vite = spawn(npmCmd, ['run', 'client:dev'], spawnOpts);

// Viteサーバーの起動を待つ
const waitForVite = (timeoutMs = 30000) =>
  new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;
    const attempt = () => {
      const req = http.get(`http://localhost:${VITE_PORT}`, (res) => {
        res.resume();
        resolve();
      });
      req.on('error', () => {
        if (Date.now() > deadline) {
          reject(new Error('Vite server start timeout'));
          return;
        }
        setTimeout(attempt, 500);
      });
    };
    attempt();
  });

const startElectron = async () => {
  try {
    console.log('[electron-dev] Waiting for Vite server...');
    await waitForVite();
    console.log('[electron-dev] Vite server ready, starting Electron...');
  } catch (err) {
    console.error('[electron-dev] Failed to start Vite:', err.message);
    cleanup();
    process.exit(1);
  }

  const electronArgs = isWin ? ['run', 'electron'] : ['.'];
  const electron = spawn(electronCmd, electronArgs, spawnOpts);

  const cleanup = () => {
    killTree(server);
    killTree(vite);
    killTree(electron);
  };

  electron.on('exit', (code) => {
    cleanup();
    process.exit(code ?? 0);
  });

  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);
};

startElectron();
