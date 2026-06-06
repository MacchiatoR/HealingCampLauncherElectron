const { app, BrowserWindow } = require('electron');
const path = require('path');

let splashWindow;

function createSplashWindow() {
  splashWindow = new BrowserWindow({
    width: 540,
    height: 540,
    resizable: false,
    maximizable: false,
    frame: false,
    show: false,
    backgroundColor: '#16181b',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  splashWindow.loadFile(path.join(__dirname, 'splash.html'));
  splashWindow.once('ready-to-show', () => splashWindow.show());

  setTimeout(() => {
    if (!splashWindow || splashWindow.isDestroyed()) {
      return;
    }
    splashWindow.setSize(900, 580);
    splashWindow.center();
    splashWindow.setResizable(true);
    splashWindow.setMaximizable(true);
    splashWindow.setMenuBarVisibility(false);
    splashWindow.loadFile(path.join(__dirname, 'login.html'));
  }, 1800);
}

app.whenReady().then(createSplashWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createSplashWindow();
  }
});
