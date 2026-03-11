/**
 * ビルド後検証スクリプト
 * dist/ 内のパッケージが正しく構成されているか確認する。
 *
 * 使い方: npm run verify-build
 */
const fs = require('fs');
const path = require('path');

const DIST_UNPACKED = path.join(__dirname, '..', 'dist', 'win-unpacked');
const RESOURCES = path.join(DIST_UNPACKED, 'resources');

let errors = 0;
let warnings = 0;

function check(label, filePath) {
  if (fs.existsSync(filePath)) {
    console.log(`  ✅ ${label}`);
  } else {
    console.log(`  ❌ ${label} — 見つかりません: ${filePath}`);
    errors++;
  }
}

function warn(label, filePath) {
  if (fs.existsSync(filePath)) {
    console.log(`  ✅ ${label}`);
  } else {
    console.log(`  ⚠️  ${label} — 見つかりません（任意）: ${filePath}`);
    warnings++;
  }
}

function checkEnvKey(label, filePath, key) {
  if (!fs.existsSync(filePath)) {
    console.log(`  ❌ ${label} — ファイルなし`);
    errors++;
    return;
  }
  const content = fs.readFileSync(filePath, 'utf8');
  if (content.includes(`${key}=`) && !content.includes(`${key}=\n`) && !content.includes(`${key}=\r`)) {
    console.log(`  ✅ ${label}`);
  } else {
    console.log(`  ❌ ${label} — ${key} が未設定`);
    errors++;
  }
}

console.log('\n🔍 ビルド検証: おはようアセス君\n');

if (!fs.existsSync(DIST_UNPACKED)) {
  console.log('❌ dist/win-unpacked が存在しません。先に npm run dist を実行してください。');
  process.exit(1);
}

console.log('📦 extraResources:');
check('app.env（サーバー環境変数）', path.join(RESOURCES, 'app.env'));
check('client.env（クライアント環境変数）', path.join(RESOURCES, 'client.env'));
check('GCP WIF認証情報', path.join(RESOURCES, 'config', 'gcp-wif-credentials.json'));

console.log('\n🔑 環境変数:');
const appEnv = path.join(RESOURCES, 'app.env');
checkEnvKey('PORT が設定済み', appEnv, 'PORT');
checkEnvKey('AZURE_CLIENT_ID が設定済み', appEnv, 'AZURE_CLIENT_ID');

const clientEnv = path.join(RESOURCES, 'client.env');
checkEnvKey('VITE_AZURE_CLIENT_ID が設定済み', clientEnv, 'VITE_AZURE_CLIENT_ID');
checkEnvKey('ELECTRON_AUTH_PORT が設定済み', clientEnv, 'ELECTRON_AUTH_PORT');

console.log('\n📁 アプリファイル:');
const appAsar = path.join(RESOURCES, 'app.asar');
const appDir = path.join(RESOURCES, 'app');
if (fs.existsSync(appAsar)) {
  console.log('  ✅ app.asar（パッケージ済み）');
} else if (fs.existsSync(appDir)) {
  check('electron/main.cjs', path.join(appDir, 'electron', 'main.cjs'));
  check('server/server.js', path.join(appDir, 'server', 'server.js'));
  check('public/index.html', path.join(appDir, 'public', 'index.html'));
} else {
  console.log('  ❌ app.asar も app/ も見つかりません');
  errors++;
}

console.log('\n🖥️  実行ファイル:');
const distDir = path.join(__dirname, '..', 'dist');
const exeFiles = fs.readdirSync(distDir).filter(f => f.endsWith('.exe'));
if (exeFiles.length > 0) {
  for (const exe of exeFiles) {
    const size = fs.statSync(path.join(distDir, exe)).size;
    const sizeMB = (size / 1024 / 1024).toFixed(1);
    console.log(`  ✅ ${exe} (${sizeMB} MB)`);
  }
} else {
  console.log('  ❌ .exe ファイルが見つかりません');
  errors++;
}

console.log('\n' + '─'.repeat(50));
if (errors === 0) {
  console.log(`✅ 検証完了: エラーなし${warnings > 0 ? `（警告 ${warnings} 件）` : ''}`);
} else {
  console.log(`❌ 検証失敗: ${errors} 件のエラー${warnings > 0 ? `、${warnings} 件の警告` : ''}`);
  process.exit(1);
}
