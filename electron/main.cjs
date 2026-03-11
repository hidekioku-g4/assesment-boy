const { app, BrowserWindow, ipcMain, desktopCapturer, dialog } = require('electron');
const { spawn } = require('child_process');
const fs = require('fs');
const http = require('http');
const path = require('path');
const dotenv = require('dotenv');

let acquireTokenInteractive;
let accountToPayload;
let clearAccount;
let getCachedAccounts;

const isPackaged = app.isPackaged;
const appRoot = app.getAppPath();
const resourcesRoot = process.resourcesPath;

const fileEnv = {};

const parseEnvFile = (filePath) => {
  try {
    let raw = fs.readFileSync(filePath, 'utf8');
    if (raw && raw.charCodeAt(0) === 0xfeff) {
      raw = raw.slice(1);
    }
    return dotenv.parse(raw);
  } catch {
    return {};
  }
};

const loadEnvFiles = (paths) => {
  paths.forEach((filePath) => {
    if (!filePath || !fs.existsSync(filePath)) return;
    const parsed = parseEnvFile(filePath);
    Object.assign(fileEnv, parsed);
    dotenv.config({ path: filePath, override: true });
  });
};

const envFilePaths = isPackaged
  ? [path.join(resourcesRoot, 'app.env'), path.join(resourcesRoot, 'client.env')]
  : [path.join(appRoot, '.env'), path.join(appRoot, 'client', '.env')];

loadEnvFiles(envFilePaths);

({ acquireTokenInteractive, accountToPayload, clearAccount, getCachedAccounts } = require('./auth.cjs'));

let activeAccount = null;
let mainWindow = null;
let serverProcess = null;
let appLogStream = null;
let serverLogStream = null;
let wifCredentialsPath = null;

const ensureDir = (dir) => {
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch (error) {
    console.error('[fs] mkdir failed', error);
  }
};

const setupFileLogging = () => {
  if (!isPackaged) return;
  try {
    const logDir = path.join(app.getPath('userData'), 'logs');
    ensureDir(logDir);

    const appLogPath = path.join(logDir, 'app.log');
    const originalConsole = {
      log: console.log.bind(console),
      warn: console.warn.bind(console),
      error: console.error.bind(console),
    };

    appLogStream = fs.createWriteStream(appLogPath, { flags: 'a' });

    const formatArg = (value) => {
      if (value instanceof Error) return value.stack || value.message;
      if (typeof value === 'string') return value;
      try {
        return JSON.stringify(value);
      } catch {
        return String(value);
      }
    };

    const writeLine = (level, args) => {
      const line = `[${new Date().toISOString()}] [${level}] ${args
        .map(formatArg)
        .join(' ')}\n`;
      try {
        appLogStream?.write(line);
      } catch {
        // ignore log write errors
      }
    };

    console.log = (...args) => {
      writeLine('INFO', args);
      originalConsole.log(...args);
    };
    console.warn = (...args) => {
      writeLine('WARN', args);
      originalConsole.warn(...args);
    };
    console.error = (...args) => {
      writeLine('ERROR', args);
      originalConsole.error(...args);
    };

    const serverLogPath = path.join(logDir, 'server.log');
    serverLogStream = fs.createWriteStream(serverLogPath, { flags: 'a' });
  } catch (error) {
    console.error('[log] failed to setup file logging', error);
  }
};

function prepareWifCredentials() {
  const userDataDir = app.getPath('userData');
  const configDir = path.join(userDataDir, 'config');
  ensureDir(configDir);

  const sourceCred = isPackaged
    ? path.join(resourcesRoot, 'config', 'gcp-wif-credentials.json')
    : path.join(appRoot, 'config', 'gcp-wif-credentials.json');
  if (!fs.existsSync(sourceCred)) return null;

  const destCred = path.join(configDir, 'gcp-wif-credentials.json');
  const tokenPath = path.join(configDir, 'ms-id-token.txt');

  try {
    const raw = fs.readFileSync(sourceCred, 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') {
      if (parsed.credential_source && typeof parsed.credential_source === 'object') {
        parsed.credential_source.file = tokenPath;
      }
    }
    fs.writeFileSync(destCred, JSON.stringify(parsed, null, 2), 'utf8');
    wifCredentialsPath = destCred;
    return destCred;
  } catch (error) {
    try {
      fs.copyFileSync(sourceCred, destCred);
      wifCredentialsPath = destCred;
      return destCred;
    } catch {
      return null;
    }
  }
}

function ensureWifCredentials() {
  if (wifCredentialsPath) return wifCredentialsPath;
  return prepareWifCredentials();
}

const ensureUserDataFiles = () => {
  // 開発時はプロジェクトフォルダ、本番exeはuserDataを使う
  const baseDir = isPackaged ? app.getPath('userData') : appRoot;
  const configDir = path.join(baseDir, 'config');
  const dataDir = path.join(baseDir, 'data');
  ensureDir(configDir);
  ensureDir(dataDir);

  process.env.APP_DATA_DIR = baseDir;

  const tokenPath = path.join(baseDir, 'config', 'ms-id-token.txt');
  process.env.GCP_WIF_SUBJECT_TOKEN_FILE = tokenPath;
  process.env.WIF_SUBJECT_TOKEN_FILE = tokenPath;

  if (isPackaged) {
    const preparedWifCreds = prepareWifCredentials();
    if (preparedWifCreds && fs.existsSync(preparedWifCreds)) {
      process.env.GCP_WIF_CREDENTIALS = preparedWifCreds;
      process.env.GOOGLE_APPLICATION_CREDENTIALS = preparedWifCreds;
    }
  } else {
    // 開発時はプロジェクト内のcredentialsを使う
    const devCreds = path.join(appRoot, 'config', 'gcp-wif-credentials.json');
    if (fs.existsSync(devCreds)) {
      process.env.GCP_WIF_CREDENTIALS = devCreds;
      process.env.GOOGLE_APPLICATION_CREDENTIALS = devCreds;
    }
  }

  // support-record.jsonのコピー（本番時のみ）
  if (isPackaged) {
    const destConfig = path.join(configDir, 'support-record.json');
    if (!fs.existsSync(destConfig)) {
      const sourceConfig = path.join(resourcesRoot, 'config', 'support-record.json');
      if (fs.existsSync(sourceConfig)) {
        fs.copyFileSync(sourceConfig, destConfig);
      }
    }
  }
};

const buildServerEnv = () => {
  // 開発時はプロジェクトフォルダ、本番exeはuserDataを使う
  const baseDir = isPackaged ? app.getPath('userData') : appRoot;
  const env = { ...process.env, ...fileEnv };

  env.APP_DATA_DIR = baseDir;

  const tokenPath = path.join(baseDir, 'config', 'ms-id-token.txt');
  env.GCP_WIF_SUBJECT_TOKEN_FILE = tokenPath;
  env.WIF_SUBJECT_TOKEN_FILE = tokenPath;

  if (isPackaged) {
    const userCred = ensureWifCredentials();
    if (userCred && fs.existsSync(userCred)) {
      env.GCP_WIF_CREDENTIALS = userCred;
      env.GOOGLE_APPLICATION_CREDENTIALS = userCred;
    } else {
      const resourceCred = path.join(resourcesRoot, 'config', 'gcp-wif-credentials.json');
      if (fs.existsSync(resourceCred)) {
        env.GCP_WIF_CREDENTIALS = resourceCred;
        env.GOOGLE_APPLICATION_CREDENTIALS = resourceCred;
      }
    }
  } else {
    // 開発時はプロジェクト内のcredentialsを使う
    const devCreds = path.join(appRoot, 'config', 'gcp-wif-credentials.json');
    if (fs.existsSync(devCreds)) {
      env.GCP_WIF_CREDENTIALS = devCreds;
      env.GOOGLE_APPLICATION_CREDENTIALS = devCreds;
    }
  }

  return env;
};

const waitForServer = (url, timeoutMs = 20000, intervalMs = 300) =>
  new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;
    const attempt = () => {
      const req = http.get(url, (res) => {
        res.resume();
        resolve();
      });
      req.on('error', () => {
        if (Date.now() > deadline) {
          reject(new Error('server_start_timeout'));
          return;
        }
        setTimeout(attempt, intervalMs);
      });
    };
    attempt();
  });

const startServer = async (startUrl) => {
  const serverEntry = path.join(appRoot, 'server', 'server.js');
  const env = buildServerEnv();
  env.ELECTRON_RUN_AS_NODE = '1';

  const stdio = serverLogStream ? ['ignore', 'pipe', 'pipe'] : 'inherit';

  serverProcess = spawn(process.execPath, [serverEntry], {
    env,
    stdio,
    cwd: isPackaged ? path.dirname(appRoot) : appRoot,
    windowsHide: true,
  });

  if (serverLogStream) {
    serverProcess.stdout?.on('data', (chunk) => {
      try {
        serverLogStream.write(chunk);
      } catch {}
    });
    serverProcess.stderr?.on('data', (chunk) => {
      try {
        serverLogStream.write(chunk);
      } catch {}
    });
  }

  serverProcess.on('exit', (code) => {
    console.warn('[server] exited', code);
  });

  serverProcess.on('error', (error) => {
    console.error('[server] failed to start', error);
  });

  await waitForServer(startUrl);
};

const stopServer = () => {
  if (serverProcess && !serverProcess.killed) {
    serverProcess.kill();
    serverProcess = null;
  }
};

const requireDesktopLocation = () => {
  if (!isPackaged) return false;
  const portableDir = process.env.PORTABLE_EXECUTABLE_DIR;
  if (!portableDir) return false;
  const desktopDir = app.getPath('desktop');
  if (path.resolve(portableDir) === path.resolve(desktopDir)) return false;

  dialog.showMessageBoxSync({
    type: 'warning',
    buttons: ['終了'],
    defaultId: 0,
    message: 'このアプリはデスクトップに置いて起動してください。',
    detail: `現在の場所: ${portableDir}`,
  });
  app.quit();
  return true;
};

const resolveStartTarget = () => {
  const port = Number(process.env.PORT || 37212);
  const envUrl = process.env.ELECTRON_START_URL;
  if (envUrl) {
    return { type: 'url', target: envUrl };
  }
  // 常にURLモードでサーバー経由で接続（file://だとAPIが使えない）
  return { type: 'url', target: `http://127.0.0.1:${port}` };
};

const createWindow = async (startTarget) => {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    backgroundColor: '#ffffff',
    resizable: true,
    maximizable: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      preload: path.join(__dirname, 'preload.cjs'),
    },
  });

  // 開発時はキャッシュをクリアして最新のコードを読み込む
  if (!isPackaged || process.env.ELECTRON_START_URL) {
    try {
      await win.webContents.session.clearCache();
      console.log('[electron] Cache cleared for development');
    } catch (err) {
      console.warn('[electron] Failed to clear cache:', err.message);
    }
  }

  if (startTarget.type === 'url') {
    win.loadURL(startTarget.target);
  } else {
    win.loadFile(startTarget.target);
  }

  try {
    win.webContents.setZoomLevel(-2.5);
  } catch {
    // ignore zoom errors
  }

  try {
    win.maximize();
  } catch {
    // ignore maximize errors
  }

  if (process.env.ELECTRON_DEVTOOLS === '1') {
    win.webContents.openDevTools({ mode: 'detach' });
  }

  mainWindow = win;
};

const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });

  app.whenReady().then(async () => {
    if (requireDesktopLocation()) return;

    setupFileLogging();
    ensureUserDataFiles();
    const startTarget = resolveStartTarget();

    // 常にサーバーを起動（ELECTRON_START_URLが指定されている場合は外部サーバーを使用）
    if (startTarget.type === 'url' && !process.env.ELECTRON_START_URL) {
      try {
        await startServer(startTarget.target);
      } catch (error) {
        console.error('[server] startup failed', error);
        dialog.showMessageBoxSync({
          type: 'error',
          buttons: ['終了'],
          defaultId: 0,
          message: '起動に失敗しました。',
          detail: 'ローカルサーバの起動に失敗しました。もう一度起動してください。',
        });
        app.quit();
        return;
      }
    }

    await createWindow(startTarget);

    app.on('activate', async () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        await createWindow(startTarget);
      }
    });
  });

  app.on('before-quit', () => {
    stopServer();
  });

  app.on('window-all-closed', () => {
    stopServer();
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });
}

ipcMain.handle('auth:login', async () => {
  const scopes = ['openid', 'profile', 'email'];
  const response = await acquireTokenInteractive(scopes);
  activeAccount = response?.account ?? null;
  return { account: accountToPayload(activeAccount) };
});

ipcMain.handle('auth:logout', async () => {
  const account = activeAccount ?? (await getCachedAccounts())[0] ?? null;
  await clearAccount(account);
  activeAccount = null;
  return { ok: true };
});

ipcMain.handle('auth:getAccount', async () => {
  const account = activeAccount ?? (await getCachedAccounts())[0] ?? null;
  activeAccount = account;
  return { account: accountToPayload(account) };
});

ipcMain.handle('zoom:in', () => {
  if (!mainWindow) return { ok: false };
  const current = mainWindow.webContents.getZoomLevel();
  mainWindow.webContents.setZoomLevel(current + 0.5);
  return { ok: true };
});

ipcMain.handle('zoom:out', () => {
  if (!mainWindow) return { ok: false };
  const current = mainWindow.webContents.getZoomLevel();
  mainWindow.webContents.setZoomLevel(current - 0.5);
  return { ok: true };
});

ipcMain.handle('zoom:reset', () => {
  if (!mainWindow) return { ok: false };
  mainWindow.webContents.setZoomLevel(-2.5);
  return { ok: true };
});

ipcMain.handle('desktop:getSources', async () => {
  const sources = await desktopCapturer.getSources({
    types: ['screen', 'window'],
    thumbnailSize: { width: 320, height: 180 },
    fetchWindowIcons: true,
  });
  return sources.map((source) => ({
    id: source.id,
    name: source.name,
    thumbnail: source.thumbnail?.toDataURL?.() ?? '',
    appIcon: source.appIcon?.toDataURL?.() ?? '',
  }));
});



