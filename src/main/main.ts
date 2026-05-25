import { app, BrowserWindow, nativeImage } from 'electron';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSettingsStore } from './store.js';
import { registerIpcHandlers } from './ipc.js';
import type { AppRecordingIndicatorState } from '../shared/types.js';

let mainWindow: BrowserWindow | null = null;
let ipcRegistered = false;
let settingsStore = null as ReturnType<typeof createSettingsStore> | null;
const currentDir = dirname(fileURLToPath(import.meta.url));
const windowsAppUserModelId = 'uz.xoshiya.app';
const appWindowTitle = 'Xoshiya App';
const overlayIconCache = new Map<Exclude<AppRecordingIndicatorState, 'idle'>, Electron.NativeImage>();
let lastRecordingIndicatorState: AppRecordingIndicatorState = 'idle';

function resolveRendererUrl() {
  const devServerUrl = process.env.VITE_DEV_SERVER_URL;
  if (devServerUrl) {
    return { url: devServerUrl, file: null };
  }

  return {
    url: null,
    file: join(currentDir, '..', 'renderer', 'index.html'),
  };
}

function resolvePreloadPath() {
  return join(currentDir, '..', 'preload', 'preload.cjs');
}

function resolveAppIconPath() {
  return join(currentDir, '..', '..', 'build', 'icon.ico');
}

function createOverlayIcon(state: Exclude<AppRecordingIndicatorState, 'idle'>): Electron.NativeImage {
  const cached = overlayIconCache.get(state);
  if (cached) {
    return cached;
  }

  const fill = state === 'recording' ? '#ef4444' : state === 'stopping' ? '#fb923c' : '#facc15';
  const shape = state === 'stopping'
    ? `<rect x="4" y="4" width="8" height="8" rx="1.5" fill="${fill}" stroke="#f8fafc" stroke-width="1.5" />`
    : `<circle cx="8" cy="8" r="6" fill="${fill}" stroke="#f8fafc" stroke-width="1.5" />`;
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16">
      ${shape}
    </svg>
  `.trim();
  const icon = nativeImage.createFromDataURL(`data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`);
  overlayIconCache.set(state, icon);
  return icon;
}

function applyRecordingIndicator(state: AppRecordingIndicatorState, targetWindow: BrowserWindow | null): void {
  lastRecordingIndicatorState = state;

  if (process.platform !== 'win32' || !targetWindow || targetWindow.isDestroyed()) {
    return;
  }

  if (state === 'idle') {
    targetWindow.setOverlayIcon(null, '');
    targetWindow.setProgressBar(-1, { mode: 'none' });
    targetWindow.setTitle(appWindowTitle);
    return;
  }

  const description = state === 'recording'
    ? 'Recording in progress'
    : state === 'stopping'
      ? 'Stopping capture'
      : 'Recording paused';
  targetWindow.setOverlayIcon(createOverlayIcon(state), description);

  if (state === 'recording') {
    targetWindow.setProgressBar(2, { mode: 'indeterminate' });
    targetWindow.setTitle(`Recording - ${appWindowTitle}`);
    return;
  }

  if (state === 'stopping') {
    targetWindow.setProgressBar(1, { mode: 'error' });
    targetWindow.setTitle(`Stopping - ${appWindowTitle}`);
    return;
  }

  targetWindow.setProgressBar(1, { mode: 'paused' });
  targetWindow.setTitle(`Paused - ${appWindowTitle}`);
}

async function createWindow() {
  const window = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 980,
    minHeight: 700,
    backgroundColor: '#050816',
    title: appWindowTitle,
    icon: resolveAppIconPath(),
    autoHideMenuBar: true,
    webPreferences: {
      preload: resolvePreloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
    },
  });

  mainWindow = window;
  applyRecordingIndicator(lastRecordingIndicatorState, window);

  const target = resolveRendererUrl();
  if (target.url) {
    await window.loadURL(target.url);
  } else if (target.file) {
    await window.loadFile(target.file);
  }

  window.on('closed', () => {
    mainWindow = null;
  });
}

if (process.platform === 'win32') {
  app.setAppUserModelId(windowsAppUserModelId);
}

app.whenReady().then(async () => {
  if (!settingsStore) {
    settingsStore = createSettingsStore();
  }

  if (!ipcRegistered && settingsStore) {
    registerIpcHandlers(settingsStore, {
      setRecordingIndicatorState: (state) => applyRecordingIndicator(state, mainWindow),
    });
    ipcRegistered = true;
  }

  await createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      void createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

void mainWindow;
