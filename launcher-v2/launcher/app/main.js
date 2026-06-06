const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const log = require('electron-log');

const AuthManager = require('./js/authhandler');
const ConfigManager = require('./js/confighandler');
const { launchMinecraftGame } = require('./js/launch');
const { AZURE_CLIENT_ID, MSFT_OPCODE, MSFT_REPLY_TYPE, MSFT_ERROR } = require('./js/ipc');

app.setName('HealingCamp Launcher');

log.transports.file.level = 'info';
log.transports.console.level = 'info';
Object.assign(console, log.functions);

const IPC_CHANNELS = {
    REQUEST_LOGIN_COMPLETE: 'request-login-complete'
};

const WINDOW_CONTROL = {
    SWITCH_TO_MAIN_REQUEST: 'WINDOW_SWITCH_TO_MAIN_REQUEST',
    SWITCH_TO_LOGIN_REQUEST: 'WINDOW_SWITCH_TO_LOGIN_REQUEST',
    CLOSE_REQUEST: 'WINDOW_CONTROL_CLOSE_REQUEST'
};

const REDIRECT_URI_PREFIX = 'https://login.microsoftonline.com/common/oauth2/nativeclient?';

let splashWindow;
let loginWindow;
let mainWindow;
let msftAuthWindow;
let msftAuthSuccess = false;
let msftAuthViewSuccess;
let msftAuthViewOnClose;
let msftLogoutWindow;
let msftLogoutSuccess = false;
let msftLogoutSuccessSent = false;

function createSplashWindow() {
    splashWindow = new BrowserWindow({
        width: 540,
        height: 540,
        transparent: true,
        frame: false,
        alwaysOnTop: true,
        resizable: false,
        maximizable: false,
        show: false,
        icon: path.join(__dirname, 'assets', 'icon.png'),
        webPreferences: {
            preload: path.join(__dirname, 'js', 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false
        }
    });

    splashWindow.loadFile(path.join(__dirname, 'splash.html'));
    splashWindow.once('ready-to-show', () => splashWindow.show());
    splashWindow.on('closed', () => {
        splashWindow = null;
    });
}

async function createLoginWindow() {
    if (loginWindow && !loginWindow.isDestroyed()) {
        return loginWindow;
    }

    loginWindow = new BrowserWindow({
        width: 750,
        height: 450,
        frame: false,
        show: false,
        resizable: false,
        maximizable: false,
        icon: path.join(__dirname, 'assets', 'icon.png'),
        webPreferences: {
            preload: path.join(__dirname, 'js', 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
            devTools: !app.isPackaged
        }
    });

    await loginWindow.loadFile(path.join(__dirname, 'login.html'));
    loginWindow.on('closed', () => {
        loginWindow = null;
    });
    return loginWindow;
}

function showLoginWindow() {
    if (!loginWindow || loginWindow.isDestroyed()) {
        createLoginWindow().then(showLoginWindow).catch(showFatalStartupError);
        return;
    }

    if (splashWindow && !splashWindow.isDestroyed()) {
        splashWindow.close();
    }
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.close();
    }

    loginWindow.show();
    loginWindow.focus();
}

function createMainWindow() {
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.focus();
        return;
    }

    mainWindow = new BrowserWindow({
        width: 1280,
        height: 720,
        transparent: true,
        show: false,
        frame: false,
        resizable: false,
        maximizable: false,
        icon: path.join(__dirname, 'assets', 'icon.png'),
        webPreferences: {
            preload: path.join(__dirname, 'js', 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
            backgroundThrottling: false
        }
    });

    mainWindow.loadFile(path.join(__dirname, 'mainmenu.html'));
    mainWindow.once('ready-to-show', () => {
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.show();
            mainWindow.focus();
        }
    });
    mainWindow.on('closed', () => {
        mainWindow = null;
    });
}

function showFatalStartupError(error) {
    log.error('[Startup] Fatal error:', error);
    dialog.showErrorBox('초기화 오류', error.message || '런처를 초기화하지 못했습니다.');
    app.quit();
}

function closeAllWindows() {
    for (const win of [mainWindow, loginWindow, splashWindow, msftAuthWindow, msftLogoutWindow]) {
        if (win && !win.isDestroyed()) {
            win.close();
        }
    }
}

function registerWindowIpc() {
    ipcMain.on(IPC_CHANNELS.REQUEST_LOGIN_COMPLETE, () => {
        if (loginWindow && !loginWindow.isDestroyed()) {
            loginWindow.close();
        }
        createMainWindow();
    });

    ipcMain.on(WINDOW_CONTROL.SWITCH_TO_MAIN_REQUEST, () => {
        if (loginWindow && !loginWindow.isDestroyed()) {
            loginWindow.close();
        }
        createMainWindow();
    });

    ipcMain.on(WINDOW_CONTROL.SWITCH_TO_LOGIN_REQUEST, () => {
        showLoginWindow();
    });

    ipcMain.on(WINDOW_CONTROL.CLOSE_REQUEST, event => {
        const win = BrowserWindow.fromWebContents(event.sender);
        if (win && !win.isDestroyed()) {
            win.close();
        }
    });

    ipcMain.on('request-app-quit', () => {
        closeAllWindows();
        app.quit();
        setTimeout(() => app.exit(0), 1000);
    });
}

function registerMicrosoftAuthIpc() {
    ipcMain.on(MSFT_OPCODE.OPEN_LOGIN, (ipcEvent, successViewTarget, cancelViewTarget) => {
        if (msftAuthWindow) {
            ipcEvent.reply(MSFT_OPCODE.REPLY_LOGIN, MSFT_REPLY_TYPE.ERROR, MSFT_ERROR.ALREADY_OPEN, cancelViewTarget);
            return;
        }

        msftAuthSuccess = false;
        msftAuthViewSuccess = successViewTarget;
        msftAuthViewOnClose = cancelViewTarget;
        msftAuthWindow = new BrowserWindow({
            title: '마이크로소프트 로그인',
            backgroundColor: '#222222',
            width: 520,
            height: 600,
            frame: true,
            icon: path.join(__dirname, 'assets', 'icon.png')
        });

        msftAuthWindow.on('closed', () => {
            msftAuthWindow = undefined;
        });

        msftAuthWindow.on('close', () => {
            if (!msftAuthSuccess && !ipcEvent.sender.isDestroyed()) {
                ipcEvent.reply(MSFT_OPCODE.REPLY_LOGIN, MSFT_REPLY_TYPE.ERROR, MSFT_ERROR.NOT_FINISHED, msftAuthViewOnClose);
            }
        });

        msftAuthWindow.webContents.on('did-navigate', (_, uri) => {
            if (!uri.startsWith(REDIRECT_URI_PREFIX)) {
                return;
            }

            const queryMap = {};
            const queries = uri.substring(REDIRECT_URI_PREFIX.length).split('#', 1).toString().split('&');
            for (const query of queries) {
                const [name, value] = query.split('=');
                queryMap[name] = decodeURIComponent(value);
            }

            ipcEvent.reply(MSFT_OPCODE.REPLY_LOGIN, MSFT_REPLY_TYPE.SUCCESS, queryMap, msftAuthViewSuccess);
            msftAuthSuccess = true;
            msftAuthWindow.close();
            msftAuthWindow = null;
        });

        msftAuthWindow.removeMenu();
        msftAuthWindow.loadURL(`https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize?prompt=select_account&client_id=${AZURE_CLIENT_ID}&response_type=code&scope=XboxLive.signin%20offline_access&redirect_uri=https://login.microsoftonline.com/common/oauth2/nativeclient`);
    });

    ipcMain.handle(MSFT_OPCODE.PROCESS_AUTH_CODE, async (_event, authCode) => {
        if (!authCode) {
            return { success: false, error: { title: '인증 오류', desc: '인증 코드가 없습니다.' } };
        }

        try {
            const account = await AuthManager.addMicrosoftAccount(authCode);
            ConfigManager.setSelectedAccount(account.uuid);
            await ConfigManager.save();
            return { success: true, value: account };
        } catch (error) {
            log.error('[Auth] Failed to process auth code:', error);
            return {
                success: false,
                error: {
                    title: error.title || '계정 처리 오류',
                    desc: error.desc || error.message || '알 수 없는 오류가 발생했습니다.'
                }
            };
        }
    });

    ipcMain.on(MSFT_OPCODE.OPEN_LOGOUT, async (ipcEvent, uuid) => {
        if (msftLogoutWindow) {
            ipcEvent.reply(MSFT_OPCODE.REPLY_LOGOUT, MSFT_REPLY_TYPE.ERROR, MSFT_ERROR.ALREADY_OPEN);
            return;
        }

        msftLogoutSuccess = false;
        msftLogoutSuccessSent = false;
        msftLogoutWindow = new BrowserWindow({
            title: '마이크로소프트 로그아웃',
            backgroundColor: '#222222',
            width: 520,
            height: 600,
            frame: true,
            icon: path.join(__dirname, 'assets', 'icon.png')
        });

        msftLogoutWindow.on('closed', () => {
            msftLogoutWindow = undefined;
            if (!msftLogoutSuccessSent && !ipcEvent.sender.isDestroyed()) {
                ipcEvent.reply(MSFT_OPCODE.REPLY_LOGOUT, MSFT_REPLY_TYPE.ERROR, MSFT_ERROR.NOT_FINISHED);
            }
        });

        msftLogoutWindow.webContents.on('did-navigate', async (_event, uri) => {
            if (!uri.includes('logoutsession') && !uri.includes('signed_out=1')) {
                return;
            }

            msftLogoutSuccess = true;
            if (msftLogoutSuccessSent) {
                return;
            }

            msftLogoutSuccessSent = true;
            await AuthManager.removeMicrosoftAccount(uuid);
            const selectedAccount = ConfigManager.getSelectedAccount();
            if (selectedAccount && selectedAccount.uuid === uuid) {
                ConfigManager.clearSelectedAccount();
            }
            await ConfigManager.save();

            if (!ipcEvent.sender.isDestroyed()) {
                ipcEvent.reply(MSFT_OPCODE.REPLY_LOGOUT, MSFT_REPLY_TYPE.SUCCESS, uuid);
            }
            if (msftLogoutWindow && !msftLogoutWindow.isDestroyed()) {
                msftLogoutWindow.close();
            }
            showLoginWindow();
        });

        msftLogoutWindow.webContents.on('did-fail-load', (_event, _errorCode, errorDescription) => {
            if (!msftLogoutSuccessSent && !ipcEvent.sender.isDestroyed()) {
                msftLogoutSuccessSent = true;
                ipcEvent.reply(MSFT_OPCODE.REPLY_LOGOUT, MSFT_REPLY_TYPE.ERROR, 'LOAD_FAILED', errorDescription);
            }
            if (msftLogoutWindow && !msftLogoutWindow.isDestroyed()) {
                msftLogoutWindow.close();
            }
        });

        msftLogoutWindow.removeMenu();
        msftLogoutWindow.loadURL('https://login.microsoftonline.com/common/oauth2/v2.0/logout');
    });
}

function registerConfigIpc() {
    ipcMain.handle('config:getSelectedAccount', async () => ConfigManager.getSelectedAccount());

    ipcMain.handle('auth:removeMicrosoftAccount', async (_event, uuid) => {
        try {
            await AuthManager.removeMicrosoftAccount(uuid);
            const selectedAccount = ConfigManager.getSelectedAccount();
            if (selectedAccount && selectedAccount.uuid === uuid) {
                ConfigManager.clearSelectedAccount();
            }
            await ConfigManager.save();
            return { success: true };
        } catch (error) {
            log.error(`[Auth] Failed to remove account ${uuid}:`, error);
            return { success: false, error: error.message || 'Failed to remove account' };
        }
    });

    ipcMain.handle('settings:get-all', async () => {
        if (!ConfigManager.isLoaded()) {
            ConfigManager.initialize();
        }
        const config = ConfigManager.getConfig();
        if (!config?.settings) {
            return null;
        }

        return {
            maxMemoryMB: config.settings.game.maxMemoryMB || 6144,
            minMemoryMB: config.settings.game.minMemoryMB || 2048,
            resWidth: config.settings.game.resWidth || 1920,
            resHeight: config.settings.game.resHeight || 1080,
            fullscreen: typeof config.settings.game.fullscreen === 'boolean' ? config.settings.game.fullscreen : false,
            allowPrerelease: typeof config.settings.launcher.allowPrerelease === 'boolean' ? config.settings.launcher.allowPrerelease : false
        };
    });

    ipcMain.handle('settings:save-all', async (_event, settings) => {
        if (!ConfigManager.isLoaded()) {
            ConfigManager.initialize();
        }
        const config = ConfigManager.getConfig();
        if (!config?.settings?.game || !config?.settings?.launcher) {
            return { success: false, error: 'Failed to access config object for saving.' };
        }

        if (typeof settings.maxMemoryMB === 'number') config.settings.game.maxMemoryMB = settings.maxMemoryMB;
        if (typeof settings.minMemoryMB === 'number') config.settings.game.minMemoryMB = settings.minMemoryMB;
        if (typeof settings.resWidth === 'number') config.settings.game.resWidth = settings.resWidth;
        if (typeof settings.resHeight === 'number') config.settings.game.resHeight = settings.resHeight;
        if (typeof settings.fullscreen === 'boolean') config.settings.game.fullscreen = settings.fullscreen;
        if (typeof settings.allowPrerelease === 'boolean') config.settings.launcher.allowPrerelease = settings.allowPrerelease;
        await ConfigManager.save();
        return { success: true };
    });
}

function registerLaunchIpc() {
    ipcMain.handle('launch-minecraft', async () => {
        if (!mainWindow || mainWindow.isDestroyed()) {
            dialog.showErrorBox('런처 오류', '메인 윈도우가 준비되지 않았거나 닫혔습니다.');
            return { success: false, message: '메인 윈도우 없음' };
        }

        try {
            const result = await launchMinecraftGame(mainWindow);
            if (!result.success) {
                dialog.showErrorBox('게임 실행 오류', result.message);
            }
            return result;
        } catch (error) {
            log.error('[Launch] Critical error launching Minecraft:', error);
            dialog.showErrorBox('게임 실행 중 심각한 오류', error.message || '알 수 없는 오류가 발생했습니다.');
            return { success: false, message: error.message || 'Failed to launch Minecraft.' };
        }
    });
}

function registerIpc() {
    registerWindowIpc();
    registerMicrosoftAuthIpc();
    registerConfigIpc();
    registerLaunchIpc();
}

app.whenReady().then(async () => {
    try {
        ConfigManager.initialize();
        registerIpc();
        createSplashWindow();
        await createLoginWindow();
        setTimeout(showLoginWindow, 1600);
    } catch (error) {
        showFatalStartupError(error);
    }
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
        createSplashWindow();
        createLoginWindow().then(() => setTimeout(showLoginWindow, 1000)).catch(showFatalStartupError);
    }
});
