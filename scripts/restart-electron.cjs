/**
 * おはようアセス君のElectron/サーバープロセスだけをポート番号で特定して終了し、再起動する。
 * 他プロジェクトのElectronアプリには影響しない。
 *
 * 使い方: node scripts/restart-electron.cjs [--kill-only] [--devtools]
 */
const { execSync, spawn } = require('child_process');
const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.join(__dirname, '..', '.env') });
const PORT = Number(process.env.PORT || 37212);
const args = process.argv.slice(2);
const killOnly = args.includes('--kill-only');
const devtools = args.includes('--devtools');

function findPidsByPort(port) {
  try {
    const output = execSync(`netstat -ano`, { encoding: 'utf8' });
    const pids = new Set();
    for (const line of output.split('\n')) {
      if (line.includes(`:${port}`) && line.includes('LISTENING')) {
        const parts = line.trim().split(/\s+/);
        const pid = Number(parts[parts.length - 1]);
        if (pid > 0) pids.add(pid);
      }
    }
    return [...pids];
  } catch {
    return [];
  }
}

function findParentPid(pid) {
  try {
    const output = execSync(`wmic process where "ProcessId=${pid}" get ParentProcessId /format:value`, { encoding: 'utf8' });
    const match = output.match(/ParentProcessId=(\d+)/);
    return match ? Number(match[1]) : null;
  } catch {
    return null;
  }
}

function getProcessName(pid) {
  try {
    const output = execSync(`wmic process where "ProcessId=${pid}" get Name /format:value`, { encoding: 'utf8' });
    const match = output.match(/Name=(.+)/);
    return match ? match[1].trim() : null;
  } catch {
    return null;
  }
}

function killTree(pid) {
  try {
    execSync(`taskkill /PID ${pid} /T /F`, { encoding: 'utf8', stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

function killProjectProcesses() {
  const serverPids = findPidsByPort(PORT);
  if (serverPids.length === 0) {
    console.log(`[restart] ポート ${PORT} にプロセスなし`);
    return;
  }

  const killed = new Set();
  for (const serverPid of serverPids) {
    const parentPid = findParentPid(serverPid);
    const parentName = parentPid ? getProcessName(parentPid) : null;

    if (parentPid && parentName && parentName.toLowerCase().includes('electron')) {
      console.log(`[restart] Electron (PID ${parentPid}) のツリーを終了`);
      killTree(parentPid);
      killed.add(parentPid);
    } else {
      console.log(`[restart] サーバー (PID ${serverPid}) を終了`);
      killTree(serverPid);
      killed.add(serverPid);
    }
  }

  if (killed.size === 0) {
    console.log('[restart] 終了対象なし');
  } else {
    console.log(`[restart] ${killed.size} プロセスツリーを終了`);
  }
}

console.log(`[restart] おはようアセス君 (port ${PORT}) のプロセスを検索...`);
killProjectProcesses();

if (killOnly) {
  console.log('[restart] --kill-only: 終了のみ');
  process.exit(0);
}

console.log('[restart] 2秒後に再起動...');
setTimeout(() => {
  const electronArgs = ['.'];
  if (devtools) electronArgs.push('--devtools');

  console.log(`[restart] npx electron ${electronArgs.join(' ')}`);
  const child = spawn('npx', ['electron', ...electronArgs], {
    cwd: path.join(__dirname, '..'),
    stdio: 'inherit',
    shell: true,
    detached: true,
  });
  child.unref();

  setTimeout(() => process.exit(0), 3000);
}, 2000);
