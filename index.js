const {
  app,
  BrowserWindow,
  ipcMain,
  Tray,
  Menu,
  screen,
  nativeImage,
} = require('electron');
const path = require('path');
const fs = require('fs');

const DEFAULT_ALARMS = [
  { id: 1, hour: 9, minute: 0, windowMinutes: 5, text: '午前のチェックイン' },
  { id: 2, hour: 11, minute: 50, windowMinutes: 5, text: 'ランチ前の確認' },
  { id: 3, hour: 15, minute: 0, windowMinutes: 5, text: '午後のチェックイン' },
  { id: 4, hour: 17, minute: 45, windowMinutes: 5, text: '業務終了の確認' },
];

let overlayWindow = null;
let settingsWindow = null;
let tray = null;
let scheduledTriggers = [];
let checkInterval = null;

function getConfigPath() {
  return path.join(app.getPath('userData'), 'alarms.json');
}

function loadAlarms() {
  const configPath = getConfigPath();
  if (!fs.existsSync(configPath)) {
    fs.writeFileSync(
      configPath,
      JSON.stringify(DEFAULT_ALARMS, null, 2),
      'utf8'
    );
  }
  try {
    return JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch {
    return DEFAULT_ALARMS;
  }
}

function saveAlarms(alarms) {
  fs.writeFileSync(getConfigPath(), JSON.stringify(alarms, null, 2), 'utf8');
}

// 毎日のアラームトリガー時刻をランダムオフセットで事前計算する
function scheduleForToday() {
  const alarms = loadAlarms();
  const now = new Date();
  const currentTotalMinutes = now.getHours() * 60 + now.getMinutes();

  scheduledTriggers = alarms
    .map((alarm) => {
      const offset =
        Math.floor(Math.random() * (alarm.windowMinutes * 2 + 1)) -
        alarm.windowMinutes;
      let totalMinutes = alarm.hour * 60 + alarm.minute + offset;
      totalMinutes = Math.max(0, Math.min(23 * 60 + 59, totalMinutes));
      return {
        alarmId: alarm.id,
        triggerHour: Math.floor(totalMinutes / 60),
        triggerMinute: totalMinutes % 60,
        alarm,
        fired: false,
      };
    })
    .filter((s) => {
      // 既に過ぎた時刻はスキップ
      return s.triggerHour * 60 + s.triggerMinute > currentTotalMinutes;
    });

  console.log(
    '[Scheduler] 今日のアラーム:',
    scheduledTriggers.map(
      (s) =>
        `${String(s.triggerHour).padStart(2, '0')}:${String(s.triggerMinute).padStart(2, '0')} "${s.alarm.text}"`
    )
  );
}

function checkAlarms() {
  const now = new Date();
  const currentHour = now.getHours();
  const currentMinute = now.getMinutes();

  // 深夜0時に翌日分を再スケジュール
  if (currentHour === 0 && currentMinute === 0) {
    scheduleForToday();
    return;
  }

  // オーバーレイが既に表示中なら新たに表示しない
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    return;
  }

  for (const scheduled of scheduledTriggers) {
    if (
      !scheduled.fired &&
      scheduled.triggerHour === currentHour &&
      scheduled.triggerMinute === currentMinute
    ) {
      scheduled.fired = true;
      showOverlay(scheduled.alarm);
      break;
    }
  }
}

function showOverlay(alarm) {
  const primaryDisplay = screen.getPrimaryDisplay();
  const { bounds } = primaryDisplay;

  overlayWindow = new BrowserWindow({
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    focusable: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  // screen-saver レベルで最前面に表示（フルスクリーンアプリより上）
  overlayWindow.setAlwaysOnTop(true, 'screen-saver');
  overlayWindow.loadFile('overlay.html');

  overlayWindow.webContents.once('did-finish-load', () => {
    overlayWindow.webContents.send('show-text', alarm.text);
  });

  overlayWindow.on('closed', () => {
    overlayWindow = null;
  });
}

function createSettingsWindow() {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.focus();
    return;
  }

  settingsWindow = new BrowserWindow({
    width: 720,
    height: 520,
    title: 'アラーム設定',
    resizable: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload-settings.js'),
    },
  });

  settingsWindow.loadFile('settings.html');

  settingsWindow.on('closed', () => {
    settingsWindow = null;
    // 設定変更後に今日のスケジュールを再計算
    scheduleForToday();
  });
}

function createTray() {
  // macOS ではテンプレートイメージで絵文字タイトルを使用
  const icon = nativeImage.createEmpty();
  tray = new Tray(icon);
  tray.setTitle('⏰');
  tray.setToolTip('時刻アラーム');

  const contextMenu = Menu.buildFromTemplate([
    { label: '設定を開く', click: createSettingsWindow },
    { type: 'separator' },
    {
      label: 'テスト表示',
      click: () => {
        if (!overlayWindow || overlayWindow.isDestroyed()) {
          showOverlay({ id: 0, text: 'テスト通知\nアラームが動作しています' });
        }
      },
    },
    { type: 'separator' },
    { label: '終了', click: () => app.quit() },
  ]);

  tray.setContextMenu(contextMenu);
}

app.whenReady().then(() => {
  // macOS: Dockアイコンを非表示にしてトレイアプリとして動作させる
  if (process.platform === 'darwin') {
    app.dock.hide();
  }

  // パッケージ済みアプリの場合のみログイン項目に登録する
  if (app.isPackaged) {
    app.setLoginItemSettings({
      openAtLogin: true,
      openAsHidden: true,
    });
  }

  createTray();
  scheduleForToday();

  // 30秒ごとにチェック（1分以内に確実に検知できる）
  checkInterval = setInterval(checkAlarms, 30 * 1000);
  checkAlarms();
});

ipcMain.on('overlay-dismiss', () => {
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.close();
  }
});

ipcMain.handle('get-alarms', () => loadAlarms());

ipcMain.handle('save-alarms', (_, alarms) => {
  saveAlarms(alarms);
  scheduleForToday();
  return true;
});

// 全ウィンドウが閉じられても終了しない（トレイアプリ）
app.on('window-all-closed', () => {});

app.on('before-quit', () => {
  if (checkInterval) clearInterval(checkInterval);
});
