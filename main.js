// main.js
const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const remoteMain = require('@electron/remote/main')
remoteMain.initialize()

// 모듈 로드
const AuthManager = require('./js/authhandler'); // AuthManager 경로
const ConfigManager = require('./js/confighandler'); // ConfigManager 경로
const autoUpdater = require('electron-updater').autoUpdater
const { launchMinecraftGame } = require('./js/launch');
const log = require('electron-log');
log.transports.file.level = 'info'
log.transports.console.level = 'info';
console.log(`Log file will be written to: ${log.transports.file.getFile().path}`);
Object.assign(console, log.functions);

// --- 개발 중 핫 리로딩 ---
if (process.env.NODE_ENV !== 'production') {
    log.info('Development mode detected. Hot reloading might be active if configured.');
    // require('electron-reload')(__dirname); // 필요시 활성화
}

// --- 상수 및 전역 변수 ---
const IPC_CHANNELS = {
    SPLASH_DONE: 'splash-done',
    REQUEST_LOGIN_COMPLETE: 'request-login-complete', // 일반 로그인 완료 후 메인 창 전환용
};

const WINDOW_CONTROL = {
    SWITCH_TO_MAIN_REQUEST: 'WINDOW_SWITCH_TO_MAIN_REQUEST', // 렌더러 -> 메인: 메인 창으로 전환 요청
    SWITCH_TO_LOGIN_REQUEST: 'WINDOW_SWITCH_TO_LOGIN_REQUEST',
    CLOSE_REQUEST: 'WINDOW_CONTROL_CLOSE_REQUEST',
};

let splashWindow;
let loginWindow;
let mainWindow;

// --- 오토 업데이터 ---
const isDev = !app.isPackaged;

let updaterEventSender = null; // 업데이트 알림을 보낼 렌더러의 event.sender 저장
let initialUpdateCheckActive = false;

function serializeUpdateError(err) {
    if (!err) {
        return { message: '알 수 없는 오류' };
    }
    return {
        message: err.message || String(err),
        stack: err.stack
    };
}

function sendAutoUpdateNotification(status, data = {}) {
    const payload = data instanceof Error ? serializeUpdateError(data) : data;
    const targets = new Set();

    if (updaterEventSender && !updaterEventSender.isDestroyed()) {
        targets.add(updaterEventSender);
    }

    for (const win of [splashWindow, loginWindow, mainWindow]) {
        if (win && !win.isDestroyed()) {
            targets.add(win.webContents);
        }
    }

    for (const target of targets) {
        try {
            if (!target.isDestroyed()) {
                target.send('autoUpdateNotification', status, payload);
            }
        } catch (error) {
            log.warn(`[AutoUpdater] Failed to send ${status} notification:`, error);
        }
    }
}

function scheduleLoginAfterUpdateStatus(delayMs = 750) {
    if (initialUpdateCheckActive) {
        setTimeout(() => proceedToLoginWindow(), delayMs);
    }
}

function registerAutoUpdaterEvents() {
    log.info('[AutoUpdater] Registering global event listeners.');
    // autoUpdater.removeAllListeners(); // 이 줄은 autoUpdater 객체에 해당 메소드가 없다면 에러 유발, 일단 주석 처리

    autoUpdater.on('checking-for-update', () => {
        log.info('[AutoUpdater] Event: checking-for-update');
        sendAutoUpdateNotification('checking-for-update', { currentVersion: app.getVersion() });
    });

    autoUpdater.on('update-available', (info) => {
        log.info('[AutoUpdater] Event: update-available:', info);
        sendAutoUpdateNotification('update-available', {
            ...info,
            currentVersion: app.getVersion()
        });
        sendAutoUpdateNotification('download-started', { currentVersion: app.getVersion() });
    });

    autoUpdater.on('update-not-available', (info) => {
        log.info('[AutoUpdater] Event: update-not-available. Info:', JSON.stringify(info, null, 2));
        sendAutoUpdateNotification('update-not-available', {
            ...info,
            currentVersion: app.getVersion()
        });
        scheduleLoginAfterUpdateStatus();
    });

    autoUpdater.on('error', (err) => {
        log.error('[AutoUpdater] Event: error:', err);
        sendAutoUpdateNotification('realerror', serializeUpdateError(err));
    });

    autoUpdater.on('download-progress', (progressObj) => {
        log.info(`[AutoUpdater] Event: download-progress - ${progressObj.percent}%`);
        sendAutoUpdateNotification('download-progress', progressObj);
    });

    autoUpdater.on('update-downloaded', (info) => {
        log.info('[AutoUpdater] Event: update-downloaded:', info);
        sendAutoUpdateNotification('update-downloaded', {
            ...info,
            currentVersion: app.getVersion()
        });
        scheduleLoginAfterUpdateStatus(900);
    });
}

function configureAutoUpdater(allowPrereleaseSetting) {
    log.info(`[AutoUpdater] Configuring. Allow Prerelease: ${allowPrereleaseSetting}, isDev: ${isDev}`);
    autoUpdater.allowPrerelease = !!allowPrereleaseSetting;

    if (isDev) {
        autoUpdater.autoInstallOnAppQuit = false;
        autoUpdater.updateConfigPath = path.join(__dirname, 'dev-app-update.yml');
        autoUpdater.autoDownload = true; // 업데이트 발견 시 내부적으로 다운로드
        log.info(`[AutoUpdater] Dev mode: autoInstallOnAppQuit=false, autoDownload=true, updateConfigPath=${autoUpdater.updateConfigPath}`);
    } else {
        autoUpdater.autoInstallOnAppQuit = true; // 프로덕션에서는 앱 종료 시 자동 설치
        autoUpdater.autoDownload = true; // 프로덕션에서는 업데이트 발견 시 내부적으로 다운로드
        log.info('[AutoUpdater] Production mode: autoInstallOnAppQuit=true, autoDownload=true');
    }
}

function checkForInitialUpdates() {
    log.info('[AutoUpdater] Starting initial check for updates. isDev:', isDev);
    initialUpdateCheckActive = true;
    sendAutoUpdateNotification('checking-for-update', { currentVersion: app.getVersion() });
    autoUpdater.checkForUpdates()
        .then(updateCheckResult => {
            // <<<--- 이 부분의 로그가 중요! ---
            log.info('[AutoUpdater] Initial checkForUpdates() promise resolved. Result (raw):', updateCheckResult);
            // updateCheckResult가 객체일 수 있으므로, 내부를 자세히 보기 위해 JSON.stringify 사용
            try {
                log.info('[AutoUpdater] Initial checkForUpdates() promise resolved. Result (JSON):', JSON.stringify(updateCheckResult, null, 2));
            } catch (e) {
                log.warn('[AutoUpdater] Could not stringify updateCheckResult:', e.message);
            }
            // --- 여기까지 ---

            let proceed = false;
            const currentAppVersion = app.getVersion();
            log.info(`[AutoUpdater] Current app version: ${currentAppVersion}`);

            if (isDev && !autoUpdater.forceDevUpdateConfig) {
                log.info('[AutoUpdater] Dev check branch entered.');
                if (updateCheckResult && updateCheckResult.cancellationToken && updateCheckResult.cancellationToken.reason && updateCheckResult.cancellationToken.reason.includes('application is not packed')) {
                    log.warn("[AutoUpdater] Dev: Update check skipped (not packed, no force config). Setting proceed = true.");
                    proceed = true;
                } else {
                    log.info('[AutoUpdater] Dev: Condition for "not packed" not met.');
                }
            }
            
            if (!proceed) {
                log.info('[AutoUpdater] Proceed is false, checking for "no update" or "latest version".');
                if (updateCheckResult === null) {
                    log.info('[AutoUpdater] updateCheckResult is null. Setting proceed = true.');
                    proceed = true;
                } else if (updateCheckResult && updateCheckResult.updateInfo && typeof updateCheckResult.updateInfo.version === 'string') { // updateInfo와 version 타입 체크 추가
                    log.info(`[AutoUpdater] Comparing remote version "${updateCheckResult.updateInfo.version}" with current "${currentAppVersion}".`);
                    if (updateCheckResult.updateInfo.version === currentAppVersion) {
                        log.info('[AutoUpdater] Versions are the same. Setting proceed = true.');
                        proceed = true;
                    } else {
                         log.info('[AutoUpdater] Versions are different. Not setting proceed here. Expecting "update-available" event.');
                    }
                } else {
                    log.warn('[AutoUpdater] updateCheckResult is not null, but updateInfo or updateInfo.version is missing/invalid. Treating as "no clear update info".');
                    // 이 경우, proceed를 true로 할지 false로 할지 정책 결정 필요.
                    // 안전하게는 false로 두고 update-available 이벤트를 기다리거나,
                    // 또는 true로 하여 일단 로그인으로 진행시키는 방법도 있음.
                    // 여기서는 일단 false로 유지하고 로그를 통해 상황 파악.
                }
            }

            if (proceed) {
                log.info("[AutoUpdater] Final decision: proceed = true. Showing latest-version status before login.");
                sendAutoUpdateNotification('update-not-available', { currentVersion: currentAppVersion });
                scheduleLoginAfterUpdateStatus();
            } else {
                log.warn("[AutoUpdater] Final decision: proceed = false. Waiting for events like 'update-available'. This might be the stall point if no event comes.");
            }
        })
        .catch(err => {
            log.error('[AutoUpdater] Initial checkForUpdates() promise rejected. Error message:', err.message);
            try {
                log.error('[AutoUpdater] Rejected Error (JSON):', JSON.stringify(err, Object.getOwnPropertyNames(err)));
            } catch (e) {
                log.warn('[AutoUpdater] Could not stringify rejected error:', e.message);
            }
            sendAutoUpdateNotification('realerror', serializeUpdateError(err));
        });
}

ipcMain.on('autoUpdateAction', (event, arg, data) => {
    if (event && event.sender) updaterEventSender = event.sender;
    switch(arg){
        case 'registerUpdateWindow':
            log.info('[IPC] autoUpdateAction: registerUpdateWindow');
            sendAutoUpdateNotification('ready', { currentVersion: app.getVersion() });
            break;
        case 'initAutoUpdater':
            log.info('[IPC] autoUpdateAction: initAutoUpdater (configure)');
            configureAutoUpdater(data);
            sendAutoUpdateNotification('ready', { currentVersion: app.getVersion() });
            break;
        case 'checkForUpdate':
            log.info('[IPC] autoUpdateAction: checkForUpdate');
            autoUpdater.checkForUpdates().catch(err => {
                log.error('[AutoUpdater] IPC checkForUpdates promise rejected:', err);
                sendAutoUpdateNotification('realerror', serializeUpdateError(err));
            });
            break;
        case 'retryUpdate':
            log.info('[IPC] autoUpdateAction: retryUpdate');
            checkForInitialUpdates();
            break;
        case 'downloadUpdate':
            log.info('[IPC] autoUpdateAction: downloadUpdate');
            sendAutoUpdateNotification('download-started', { currentVersion: app.getVersion() });
            autoUpdater.downloadUpdate().catch(err => {
                log.error('[AutoUpdater] downloadUpdate promise rejected:', err);
                sendAutoUpdateNotification('realerror', serializeUpdateError(err));
            });
            break;
        case 'continueToLogin':
            log.info('[IPC] autoUpdateAction: continueToLogin');
            proceedToLoginWindow();
            break;
        case 'quitApp':
            log.info('[IPC] autoUpdateAction: quitApp');
            app.quit();
            break;
        case 'allowPrereleaseChange':
            log.info(`[IPC] autoUpdateAction: allowPrereleaseChange to ${data}`);
            autoUpdater.allowPrerelease = !!data;
            break;
        case 'installUpdateNow':
            log.info('[IPC] autoUpdateAction: installUpdateNow is deprecated. Continuing to login.');
            proceedToLoginWindow();
            break;
        default:
            log.warn('[IPC] autoUpdateAction: Unknown argument', arg);
            break;
    }
});

// --- 창 생성 함수들 ---
function createSplashWindow() {
    log.info('[WindowManager] Creating splash window...');
    splashWindow = new BrowserWindow({
        width: 540, height: 540, transparent: true, frame: false, alwaysOnTop: true,
        resizable: false, maximizable: false,
        webPreferences: { preload: path.join(__dirname, './js/preload.js') },
        icon: path.join(__dirname, 'assets', 'icon.png'),
    });
    updaterEventSender = splashWindow.webContents;
    splashWindow.loadFile(path.join(__dirname, 'splash.html'));
    splashWindow.on('closed', () => {
        log.info('[WindowManager] Splash window closed.');
        splashWindow = null;
    });
}

async function createLoginWindow() {
    if (loginWindow && !loginWindow.isDestroyed()) {
        log.info('[WindowManager] Login window already exists, focusing.');
        try {
            loginWindow.focus();
        } catch (focusError) {
            log.error('[WindowManager] Error focusing existing login window:', focusError);
        }
        return loginWindow;
    }
    log.info('[WindowManager] Attempting to create new login window...');
    try {
        loginWindow = new BrowserWindow({
            width: 750, height: 450, frame: false,
            show: false,
            resizable: false, maximizable: false,
            icon: path.join(__dirname, 'assets', 'icon.png'), // 아이콘 경로 추가 (이전 요청 반영)
            webPreferences: {
                preload: path.join(__dirname, 'js', 'preload.js'), // 경로에 슬래시 대신 path.join 사용 권장
                contextIsolation: true, nodeIntegration: false,
                devTools: isDev // 개발 중에만 개발자 도구 활성화 (선택적)
            }
        });
        log.info('[WindowManager] BrowserWindow for login created.');

        try {
            remoteMain.enable(loginWindow.webContents);
            log.info('[WindowManager] remoteMain enabled for login window.');
        } catch (remoteEnableError) {
            log.error('[WindowManager] Error enabling remoteMain for login window:', remoteEnableError);
            // 이 오류가 치명적일 수 있음
        }

        const loginHtmlPath = path.join(__dirname, 'login.html');
        log.info(`[WindowManager] Attempting to load login.html from: ${loginHtmlPath}`);
        await loginWindow.loadFile(loginHtmlPath);
        log.info('[WindowManager] login.html loaded successfully.');

        loginWindow.once('ready-to-show', () => {
            log.info('[WindowManager] Login window is ready to show.');
            // showTheLoginWindow() 호출은 proceedToLoginWindow 또는 업데이트 확인 후 결정
        });

        loginWindow.on('closed', () => {
            log.info('[WindowManager] Login window closed event.');
            loginWindow = null;
        });

        return loginWindow;

    } catch (creationError) {
        log.error('[WindowManager] CRITICAL ERROR creating login window:', creationError);
        // 여기서 오류를 다시 throw 하거나, 앱 종료 로직으로 연결
        throw creationError; // SPLASH_DONE 핸들러의 catch에서 잡도록
    }
}

// proceedToLoginWindow 함수 수정: 창을 보여주는 로직 분리
function showTheLoginWindow() {
    if (loginWindow && !loginWindow.isDestroyed() && !loginWindow.isVisible()) {
        loginWindow.show();
        loginWindow.focus();
        log.info('[WindowManager] Login window is now shown and focused.');
    } else if (loginWindow && loginWindow.isVisible()) {
        loginWindow.focus();
        log.info('[WindowManager] Login window was already visible, focused.');
    } else {
        log.warn('[WindowManager] showTheLoginWindow called but loginWindow is not valid or already shown.');
    }
}

// 로그인 창으로 진행하는 함수
function proceedToLoginWindow() {
    log.info('[WindowManager] Attempting to proceed to login window (logic part).');
    initialUpdateCheckActive = false;
    if (splashWindow && !splashWindow.isDestroyed()) {
        log.info('[WindowManager] Closing splash window before proceeding to login.');
        splashWindow.close();
    }
    if (mainWindow && !mainWindow.isDestroyed()) {
        log.info('[WindowManager] Closing main window before proceeding to login.');
        mainWindow.close();
    }

    // 로그인 창이 이미 생성되었다면 보여주기만 함
    if (loginWindow && !loginWindow.isDestroyed()) {
        showTheLoginWindow();
    } else {
        // 이 경우는 SPLASH_DONE에서 createLoginWindow가 먼저 호출되므로 거의 발생 안 함
        log.warn('[WindowManager] proceedToLoginWindow: Login window not created yet, creating and showing.');
        createLoginWindow().then(() => { // createLoginWindow가 Promise를 반환하도록 수정 필요
            showTheLoginWindow();
        });
    }
}

function createMainWindow() {
    if (mainWindow && !mainWindow.isDestroyed()) {
        log.info('[WindowManager] Main window already exists, focusing.');
        mainWindow.focus();
        return;
    }
    log.info('[WindowManager] Creating main window...');
    mainWindow = new BrowserWindow({
        width: 1280,
        height: 720,
        transparent: true,
        show: false,
        frame: false,
        resizable: false,      // <<--- 추가: 크기 조절 불가
        maximizable: false,    // <<--- 추가: 최대화 불가
        // alwaysOnTop 속성은 이전 요청에 따라 제거됨
        icon: path.join(__dirname, 'assets', 'icon.png'),
        webPreferences: {
            preload: path.join(__dirname, 'js', 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
            backgroundThrottling: false // <<--- 이 옵션을 추가합니다!
        }
    });
    remoteMain.enable(mainWindow.webContents);
    mainWindow.loadFile(path.join(__dirname, 'mainmenu.html'));

    mainWindow.once('ready-to-show', () => {
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.show();
            mainWindow.focus();
            log.info('[WindowManager] Main window shown and focused.');
        }
    });

    mainWindow.on('closed', () => {
        log.info('[WindowManager] Main window closed.');
        mainWindow = null;
    });
}

// --- 마이크로소프트 로그인
const REDIRECT_URI_PREFIX = 'https://login.microsoftonline.com/common/oauth2/nativeclient?'
const { AZURE_CLIENT_ID, MSFT_OPCODE, MSFT_REPLY_TYPE, MSFT_ERROR, SHELL_OPCODE } = require('./js/ipc')

let msftAuthWindow
let msftAuthSuccess
let msftAuthViewSuccess
let msftAuthViewOnClose

ipcMain.on(MSFT_OPCODE.OPEN_LOGIN, (ipcEvent, successViewTarget, cancelViewTarget) => {
    if (msftAuthWindow) {
        ipcEvent.reply(MSFT_OPCODE.REPLY_LOGIN, MSFT_REPLY_TYPE.ERROR, MSFT_ERROR.ALREADY_OPEN, msftAuthViewOnClose)
        return
    }
    msftAuthSuccess = false
    msftAuthViewSuccess = successViewTarget;
    msftAuthViewOnClose = cancelViewTarget;
    msftAuthWindow = new BrowserWindow({
        title: '마이크로소프트 로그인',
        backgroundColor: '#222222',
        width: 520,
        height: 600,
        frame: true,
        icon: './assets/icon.png'
    })

    msftAuthWindow.on('closed', () => {
        msftAuthWindow = undefined
    })

    msftAuthWindow.on('close', () => {
        if(!msftAuthSuccess) {
            ipcEvent.reply(MSFT_OPCODE.REPLY_LOGIN, MSFT_REPLY_TYPE.ERROR, MSFT_ERROR.NOT_FINISHED, msftAuthViewOnClose)
        }
    })

    msftAuthWindow.webContents.on('did-navigate', (_, uri) => {
        if (uri.startsWith(REDIRECT_URI_PREFIX)) {
            let queries = uri.substring(REDIRECT_URI_PREFIX.length).split('#', 1).toString().split('&')
            let queryMap = {}

            queries.forEach(query => {
                const [name, value] = query.split('=')
                queryMap[name] = decodeURI(value)
            })

            ipcEvent.reply(MSFT_OPCODE.REPLY_LOGIN, MSFT_REPLY_TYPE.SUCCESS, queryMap, msftAuthViewSuccess)

            msftAuthSuccess = true
            msftAuthWindow.close()
            msftAuthWindow = null
        }
    })

    msftAuthWindow.removeMenu()
    msftAuthWindow.loadURL(`https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize?prompt=select_account&client_id=${AZURE_CLIENT_ID}&response_type=code&scope=XboxLive.signin%20offline_access&redirect_uri=https://login.microsoftonline.com/common/oauth2/nativeclient`)
})

ipcMain.handle(MSFT_OPCODE.PROCESS_AUTH_CODE, async (event, authCode) => {
    console.log(`[Main] Received ${MSFT_OPCODE.PROCESS_AUTH_CODE} with authCode:`, authCode);
    if (!authCode) {
        // AuthManager에서 직접 에러를 throw하도록 하고, 여기서는 호출만 할 수도 있습니다.
        // 또는 여기서 기본적인 유효성 검사 후 에러 객체를 반환할 수 있습니다.
        return { success: false, error: { title: '인증 오류', desc: '인증 코드가 없습니다.' } };
    }
    try {
        const account = await AuthManager.addMicrosoftAccount(authCode);
        console.log('[Main] Account processed successfully by AuthManager:', account);

        // 1. 방금 로그인한 계정을 "선택된 계정"으로 설정합니다.
        ConfigManager.setSelectedAccount(account.uuid);
        console.log(`[Main] Set selected account to: ${account.uuid}`);

        // 2. 변경된 설정을 파일에 즉시 저장합니다.
        await ConfigManager.save();
        console.log('[Main] Config saved successfully after setting selected account.');

        return { success: true, value: account };
    } catch (error) {
        console.error('[Main] Error processing auth code with AuthManager:', error);
        // AuthManager에서 throw한 에러가 사용자에게 표시 가능한 형태(isDisplayableError 등)인지 확인
        const displayableError = (error && error.isDisplayableError) ? error : {
            title: error.title || '계정 처리 오류',
            desc: error.desc || (error instanceof Error ? error.message : '알 수 없는 오류가 발생했습니다.')
        };
        return { success: false, error: displayableError };
    }
});

// --- 마이크로소프트 로그아웃
let msftLogoutWindow
let msftLogoutSuccess
let msftLogoutSuccessSent

ipcMain.on(MSFT_OPCODE.OPEN_LOGOUT, async (ipcEvent, uuid) => {
    log.info(`[IPC MSFT_OPCODE.OPEN_LOGOUT] Received for UUID: ${uuid}`);
    if (msftLogoutWindow) {
        log.warn('[IPC MSFT_OPCODE.OPEN_LOGOUT] Logout window already open.');
        ipcEvent.reply(MSFT_OPCODE.REPLY_LOGOUT, MSFT_REPLY_TYPE.ERROR, MSFT_ERROR.ALREADY_OPEN);
        return;
    }

    msftLogoutSuccess = false;
    msftLogoutSuccessSent = false; // 응답 중복 전송 방지 플래그

    msftLogoutWindow = new BrowserWindow({
        title: '마이크로소프트 로그아웃',
        backgroundColor: '#222222',
        width: 520,
        height: 600,
        frame: true,
        icon: './assets/icon.png'
    })

    msftLogoutWindow.on('closed', () => {
        log.info('[MSFT Logout Window] Closed.');
        msftLogoutWindow = undefined;
        // 여기서 응답을 보내는 것은 사용자가 창을 닫았을 때 (성공/실패 판단 후)
        if (!msftLogoutSuccessSent) { // 성공 응답이 이미 보내지지 않았다면
             log.info('[MSFT Logout Window] Sending NOT_FINISHED reply as window closed before success confirmed.');
            if (!ipcEvent.sender.isDestroyed()){
                ipcEvent.reply(MSFT_OPCODE.REPLY_LOGOUT, MSFT_REPLY_TYPE.ERROR, MSFT_ERROR.NOT_FINISHED);
            }
        }
    });

    msftLogoutWindow.webContents.on('did-navigate', async (event, uri) => { // async 추가
        log.info('[MSFT Logout Window] Navigated to:', uri);
        if (uri.startsWith('https://login.microsoftonline.com/common/oauth2/v2.0/logoutsession') ||
            uri.includes('logoutsession') ||
            uri.includes('signed_out=1')) {

            log.info('[MSFT Logout Window] Logout success condition met via navigation.');
            msftLogoutSuccess = true;

            if (!msftLogoutSuccessSent) {
                msftLogoutSuccessSent = true;
                log.info('[MSFT Logout Window] Sending SUCCESS reply to renderer.');
                if (!ipcEvent.sender.isDestroyed()) {
                    // isLastAccount 파라미터 없이 성공 메시지 전송
                    ipcEvent.reply(MSFT_OPCODE.REPLY_LOGOUT, MSFT_REPLY_TYPE.SUCCESS, uuid);
                }

                // <<<--- 계정 제거 및 화면 전환 로직 ---
                try {
                    log.info(`[MSFT Logout Window] Attempting to remove account ${uuid} from AuthManager.`);
                    await AuthManager.removeMicrosoftAccount(uuid);
                    log.info(`[AuthManager] Account ${uuid} removed after MS logout.`);

                    const currentSelectedAccount = ConfigManager.getSelectedAccount();
                    if (currentSelectedAccount && currentSelectedAccount.uuid === uuid) {
                        ConfigManager.clearSelectedAccount();
                        log.info(`[ConfigManager] Cleared selected account: ${uuid}`);
                    }
                    await ConfigManager.save();
                    log.info(`[ConfigManager] Config saved after account removal.`);

                    log.info('[MSFT Logout Window] Logout successful for account. Proceeding to login window unconditionally.');
                    if (msftLogoutWindow && !msftLogoutWindow.isDestroyed()) {
                        log.info('[MSFT Logout Window] Closing logout window before switching to login.');
                        msftLogoutWindow.close();
                        msftLogoutWindow = null;
                    }
                    proceedToLoginWindow(); // 무조건 로그인 창으로 전환

                } catch (error) {
                    log.error('[MSFT Logout Window] Error removing account or switching window after logout:', error);
                    if (msftLogoutWindow && !msftLogoutWindow.isDestroyed()) msftLogoutWindow.close();
                    // 오류 발생 시에도 로그인 창으로 가는 것을 고려할 수 있음 (선택적)
                    // proceedToLoginWindow();
                }
                // --- 계정 제거 및 화면 전환 로직 끝 ---
            } else {
                if (msftLogoutWindow && !msftLogoutWindow.isDestroyed()) {
                    log.info('[MSFT Logout Window] SUCCESS reply already sent or different logic path. Closing logout window.');
                    msftLogoutWindow.close();
                    msftLogoutWindow = null;
                }
            }
        }
    });

    msftLogoutWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL) => {
        log.error(`[MSFT Logout Window] Failed to load URL: ${validatedURL}. Error: ${errorCode}, ${errorDescription}`);
        // 로드 실패 시 에러 처리 (예: 네트워크 문제)
        if (!msftLogoutSuccessSent) {
            msftLogoutSuccessSent = true; // 실패 응답도 한 번만
             log.info('[MSFT Logout Window] Sending ERROR reply due to load failure.');
            if (!ipcEvent.sender.isDestroyed()){
                ipcEvent.reply(MSFT_OPCODE.REPLY_LOGOUT, MSFT_REPLY_TYPE.ERROR, 'LOAD_FAILED', errorDescription);
            }
        }
        if (msftLogoutWindow && !msftLogoutWindow.isDestroyed()) msftLogoutWindow.close();
    });

    msftLogoutWindow.removeMenu()
    msftLogoutWindow.loadURL('https://login.microsoftonline.com/common/oauth2/v2.0/logout')
});


// 게임 시작 요청 IPC 핸들러
ipcMain.handle('launch-minecraft', async (event) => { // event 인자 추가
    log.info('[IPC] Received request to launch Minecraft.');

    if (!mainWindow) {
        log.error('[IPC] mainWindow variable is NULL or UNDEFINED.');
    } else if (mainWindow.isDestroyed()) {
        log.error('[IPC] mainWindow IS DESTROYED.');
    } else {
        log.info(`[IPC] mainWindow is VALID. ID: ${mainWindow.id}, isVisible: ${mainWindow.isVisible()}, isFocused: ${mainWindow.isFocused()}`);
    }

    // 이전 유효성 검사 유지
    if (!mainWindow || mainWindow.isDestroyed()) {
        log.error('[IPC] Cannot launch game, mainWindow is not available or destroyed.');
        dialog.showErrorBox('런처 오류', '메인 윈도우가 준비되지 않았거나 닫혔습니다. 앱을 재시작해주세요.');
        return { success: false, message: '메인 윈도우 없음' };
    }
    try {
        const launchResult = await launchMinecraftGame(mainWindow);
        if (launchResult.success) {
            log.info(`[IPC] ${launchResult.message}`);
            // app.quit(); // <<--- 제거!
            return { success: true, message: launchResult.message, launchedPID: launchResult.launchedPID }; // 성공 메시지와 PID 반환
        } else {
            log.error('[IPC] Failed to launch Minecraft:', launchResult.message);
            dialog.showErrorBox('게임 실행 오류', launchResult.message);
            return { success: false, message: launchResult.message };
        }
    } catch (error) {
        log.error('[IPC] Critical error launching Minecraft:', error);
        dialog.showErrorBox('게임 실행 중 심각한 오류', error.message || '알 수 없는 오류가 발생했습니다.');
        return { success: false, message: error.message || 'Failed to launch Minecraft due to an unexpected error.' };
    }
});

// 렌더러로부터 앱 종료 요청을 받는 핸들러 추가
ipcMain.on('request-app-quit', () => {
    log.info('[IPC] Received request-app-quit from renderer.');

    // 모든 창 닫기
    if (mainWindow && !mainWindow.isDestroyed()) {
        log.info('[IPC] Closing main window before quitting.');
        mainWindow.close();
    }
    if (loginWindow && !loginWindow.isDestroyed()) {
        log.info('[IPC] Closing login window before quitting.');
        loginWindow.close();
    }
    if (splashWindow && !splashWindow.isDestroyed()) {
        log.info('[IPC] Closing splash window before quitting.');
        splashWindow.close();
    }
    if (msftAuthWindow && !msftAuthWindow.isDestroyed()) {
        log.info('[IPC] Closing Microsoft auth window before quitting.');
        msftAuthWindow.close();
    }
    if (msftLogoutWindow && !msftLogoutWindow.isDestroyed()) {
        log.info('[IPC] Closing Microsoft logout window before quitting.');
        msftLogoutWindow.close();
    }

    const remainingWindows = BrowserWindow.getAllWindows();
    if (remainingWindows.length > 0) {
        log.warn('[IPC] Some windows are still open:', remainingWindows.map(win => win.id));
    } else {
        log.info('[IPC] All windows are closed.');
    }

    log.info('[IPC] Attempting to quit app with app.quit().');
    app.quit();

    // app.quit()이 실패할 경우를 대비해 1초 후 강제 종료
    setTimeout(() => {
        if (!app.isQuitting()) {
            log.warn('[IPC] App did not quit after app.quit(). Forcing exit with app.exit().');
            app.exit(0);
        }
    }, 1000);
});

ipcMain.handle('settings:get-all', async () => {
    if (!ConfigManager.isLoaded()) { // 로드되었는지 확인
        try {
            ConfigManager.initialize(); // 로드 안됐으면 초기화 시도
        } catch (e) {
            log.error('Failed to initialize ConfigManager in settings:get-all:', e);
            return null; // 또는 오류 객체 반환
        }
    }
    const currentConfig = ConfigManager.getConfig();
    if (currentConfig && currentConfig.settings) {
        return { // 필요한 설정만 골라서 반환하는 것이 더 좋음
            maxMemoryMB: currentConfig.settings.game.maxMemoryMB || 6144,
            minMemoryMB: currentConfig.settings.game.minMemoryMB || 2048, // minMemoryMB도 추가
            resWidth: currentConfig.settings.game.resWidth || 1920,
            resHeight: currentConfig.settings.game.resHeight || 1080,
            fullscreen: typeof currentConfig.settings.game.fullscreen === 'boolean' ? currentConfig.settings.game.fullscreen : false,
            allowPrerelease: typeof currentConfig.settings.launcher.allowPrerelease === 'boolean' ? currentConfig.settings.launcher.allowPrerelease : false,
        };
    }
    return null; // 또는 기본 설정 객체 반환
});

ipcMain.handle('settings:save-all', async (event, settings) => {
    if (!ConfigManager.isLoaded()) { /* ... 로드 확인 및 초기화 ... */ }
    const cfg = ConfigManager.getConfig();
    if (cfg && cfg.settings && cfg.settings.game && cfg.settings.launcher) {
        if (typeof settings.maxMemoryMB === 'number') cfg.settings.game.maxMemoryMB = settings.maxMemoryMB;
        if (typeof settings.minMemoryMB === 'number') cfg.settings.game.minMemoryMB = settings.minMemoryMB; // minMemoryMB 저장
        if (typeof settings.resWidth === 'number') cfg.settings.game.resWidth = settings.resWidth;
        if (typeof settings.resHeight === 'number') cfg.settings.game.resHeight = settings.resHeight;
        if (typeof settings.fullscreen === 'boolean') cfg.settings.game.fullscreen = settings.fullscreen;
        if (typeof settings.allowPrerelease === 'boolean') cfg.settings.launcher.allowPrerelease = settings.allowPrerelease;
        await ConfigManager.save();
        // 변경된 설정을 autoUpdater에도 반영 (allowPrerelease)
        if (typeof settings.allowPrerelease === 'boolean') {
            configureAutoUpdater(settings.allowPrerelease); // autoUpdater 재설정
            log.info(`[AutoUpdater] Reconfigured with allowPrerelease: ${settings.allowPrerelease}`);
        }
        return { success: true };
    }
    return { success: false, error: 'Failed to access config object for saving.' };
});

// --- 앱 수명주기 이벤트 ---
app.whenReady().then(async () => {
    log.info('App is ready.');

    // <<<--- ConfigManager 초기화 및 로드 시점 변경 ---
    try {
        ConfigManager.initialize(); // 경로 초기화 및 필요한 경우 load 호출
        log.info('[ConfigManager] Initialized successfully in app.whenReady()');
    } catch (configError) {
        log.error('[ConfigManager] Failed to initialize ConfigManager:', configError);
        // 심각한 오류이므로 앱을 종료하거나 사용자에게 알림 후 종료
        dialog.showErrorBox("설정 오류", `설정 파일을 초기화하는 중 심각한 오류가 발생했습니다: ${configError.message}\n앱을 종료합니다.`);
        app.quit();
        return; // 추가 실행 방지
    }
    // --- ---

    registerAutoUpdaterEvents(); // 이벤트 리스너는 한 번만 등록
    const initialAllowPrerelease = ConfigManager.getAllowPrerelease ? ConfigManager.getAllowPrerelease() : false;
    configureAutoUpdater(initialAllowPrerelease); // 초기 설정 적용

    createSplashWindow();

    ipcMain.on(IPC_CHANNELS.SPLASH_DONE, async () => {
        log.info("Splash done. Keeping splash window open for update status.");
        if (splashWindow && !splashWindow.isDestroyed()) {
            updaterEventSender = splashWindow.webContents;
        }

        log.info("Creating login window (initially hidden) before checking for updates."); // <<<--- 이 로그는 찍힘
        try {
            await createLoginWindow(); // <<<--- 이 호출 직후 또는 내부에서 멈춤
            log.info("Login window created (or already existed). Now checking for updates."); // 이 로그가 안 찍힘
            checkForInitialUpdates();
        } catch (error) {
            log.error("Error creating login window before update check:", error);
            dialog.showErrorBox("초기화 오류", "로그인 창을 준비하는 중 오류가 발생했습니다.");
            app.quit();
        }
    });

     ipcMain.on(IPC_CHANNELS.REQUEST_LOGIN_COMPLETE, () => {
        log.info("Login complete signal received, closing login and opening main.");
        if (loginWindow && !loginWindow.isDestroyed()) loginWindow.close();
        if (!mainWindow) createMainWindow();
        else if (mainWindow.isDestroyed()) createMainWindow(); // 만약 파괴되었다면 다시 생성
        else mainWindow.focus(); // 이미 있다면 포커스
    });

    ipcMain.on(WINDOW_CONTROL.SWITCH_TO_MAIN_REQUEST, () => {
        log.info('Switch to main window requested.');
        if (loginWindow && !loginWindow.isDestroyed()) loginWindow.close();
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.show();
            mainWindow.focus();
        } else {
            createMainWindow();
        }
    });

    ipcMain.on(WINDOW_CONTROL.SWITCH_TO_LOGIN_REQUEST, () => {
        log.info('[IPC] Received request to switch to login window.');
        proceedToLoginWindow(); // 메인 창 닫고 로그인 창 생성/표시
    });

    ipcMain.on(WINDOW_CONTROL.CLOSE_REQUEST, (event) => {
        const webContents = event.sender;
        const win = BrowserWindow.fromWebContents(webContents);

        if (win && !win.isDestroyed()) {
            log.info(`[IPC] Received ${WINDOW_CONTROL.CLOSE_REQUEST} from window ID ${win.id}. Closing it.`);
            win.close(); // 요청을 보낸 창을 닫음
        } else {
            log.warn(`[IPC] Received ${WINDOW_CONTROL.CLOSE_REQUEST}, but could not find associated window or it was already destroyed.`);
        }
    });

    ipcMain.handle('auth:removeMicrosoftAccount', async (event, uuid) => {
        log.info(`[IPC auth:removeMicrosoftAccount] Received for UUID: ${uuid}`);
        try {
            await AuthManager.removeMicrosoftAccount(uuid);
            log.info(`[AuthManager] Account ${uuid} removed successfully.`);

            // 선택된 계정 정보 업데이트 (만약 제거된 계정이 선택된 계정이었다면)
            const currentSelectedAccount = ConfigManager.getSelectedAccount();
            if (currentSelectedAccount && currentSelectedAccount.uuid === uuid) {
                ConfigManager.clearSelectedAccount(); // 선택된 계정 정보 제거
                log.info(`[ConfigManager] Cleared selected account as it was removed: ${uuid}`);
                // 다른 계정이 있다면 첫 번째 계정을 선택하거나, 선택 없음을 유지
                const remainingAccounts = AuthManager.getAccounts();
                if (remainingAccounts.length > 0) {
                    ConfigManager.setSelectedAccount(remainingAccounts[0].uuid);
                    log.info(`[ConfigManager] Automatically selected new account: ${remainingAccounts[0].uuid}`);
                }
            }
            await ConfigManager.save(); // 변경사항 저장

            return { success: true };
        } catch (error) {
            log.error(`[AuthManager] Error removing account ${uuid}:`, error);
            return { success: false, error: error.message || 'Failed to remove account' };
        }
    });
    
    ipcMain.handle('config:getSelectedAccount', async () => {
        log.info('[IPC] Handling config:getSelectedAccount');
        try {
            // ConfigManager.load(); // 필요하다면 로드 보장
            const account = ConfigManager.getSelectedAccount(); // ConfigManager에서 함수 호출
            return account;
        } catch (error) {
            log.error('[IPC] Error in config:getSelectedAccount:', error);
            return null; // 오류 발생 시 null 반환 또는 에러 객체 반환
        }
    }
);
    

    // --- macOS 활성화 처리 ---
    app.on('activate', function () {
        log.info('App activated (macOS)');
        if (BrowserWindow.getAllWindows().length === 0) {
            log.info('No windows open, creating splash window.');
            createSplashWindow();
        } else {
            if (mainWindow && !mainWindow.isDestroyed()) mainWindow.show();
            else if (loginWindow && !loginWindow.isDestroyed()) loginWindow.show();
            else if (splashWindow && !splashWindow.isDestroyed()) splashWindow.show();
        }
    });
});

// --- 앱 종료 처리 ---
app.on('window-all-closed', function () {
    log.info('All windows closed.');
    if (process.platform !== 'darwin') {
        log.info('Quitting app (not macOS).');
        app.quit();
    } else {
        log.info('Not quitting app (macOS behavior).');
    }
});

app.on('will-quit', () => {
    log.info('App is about to quit.');
    // ConfigManager.save().catch(err => log.error('Error saving config on quit:', err));
});
// --- Local Launcher API for Website Integration ---
const nodeHttp = require('node:http');
const LAUNCHER_API_HOST = '127.0.0.1';
const LAUNCHER_API_PORT = 17888;
let launcherLocalApiServer = null;

function launcherApiWriteJson(res, statusCode, payload) {
    res.writeHead(statusCode, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Content-Type': 'application/json; charset=utf-8'
    });
    res.end(JSON.stringify(payload));
}

async function launcherApiReadJson(req) {
    return new Promise((resolve, reject) => {
        let body = '';
        req.on('data', (chunk) => {
            body += chunk;
            if (body.length > 1024 * 1024) {
                reject(new Error('payload_too_large'));
            }
        });
        req.on('end', () => {
            if (!body) {
                resolve({});
                return;
            }
            try {
                resolve(JSON.parse(body));
            } catch {
                reject(new Error('invalid_json'));
            }
        });
        req.on('error', reject);
    });
}

function launcherApiGetSelectedMicrosoftAccount() {
    const selectedAccount = ConfigManager.getSelectedAccount();
    if (!selectedAccount || selectedAccount.type !== 'microsoft') {
        return null;
    }
    return {
        uuid: selectedAccount.uuid || null,
        username: selectedAccount.username || selectedAccount.displayName || null,
        type: selectedAccount.type
    };
}

function ensureMicrosoftLoginPopupFromApi() {
    if (msftAuthWindow && !msftAuthWindow.isDestroyed()) {
        return { opened: false, alreadyOpen: true };
    }

    msftAuthSuccess = false;
    msftAuthWindow = new BrowserWindow({
        title: 'Microsoft 로그인',
        backgroundColor: '#222222',
        width: 520,
        height: 600,
        frame: true,
        icon: './assets/icon.png'
    });

    msftAuthWindow.on('closed', () => {
        if (!msftAuthSuccess) {
            log.info('[LauncherAPI] Microsoft login window closed before completion.');
        }
        msftAuthWindow = undefined;
    });

    msftAuthWindow.webContents.on('did-navigate', async (_, uri) => {
        if (!uri.startsWith(REDIRECT_URI_PREFIX)) {
            return;
        }

        try {
            const parsed = new URL(uri);
            let authCode = parsed.searchParams.get('code');
            let authError = parsed.searchParams.get('error');

            if ((!authCode || !authError) && parsed.hash) {
                const hashParams = new URLSearchParams(parsed.hash.replace(/^#/, ''));
                authCode = authCode || hashParams.get('code');
                authError = authError || hashParams.get('error');
            }

            if (authError || !authCode) {
                log.warn('[LauncherAPI] Microsoft login ended without valid auth code.', { authError });
            } else {
                const account = await AuthManager.addMicrosoftAccount(authCode);
                ConfigManager.setSelectedAccount(account.uuid);
                await ConfigManager.save();
                msftAuthSuccess = true;
                log.info(`[LauncherAPI] Microsoft login completed: ${account.username || account.displayName || account.uuid}`);
            }
        } catch (error) {
            log.error('[LauncherAPI] Failed to process Microsoft auth callback:', error);
        } finally {
            if (msftAuthWindow && !msftAuthWindow.isDestroyed()) {
                msftAuthWindow.close();
            }
            msftAuthWindow = null;
        }
    });

    msftAuthWindow.removeMenu();
    msftAuthWindow.loadURL(
        `https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize?prompt=select_account&client_id=${AZURE_CLIENT_ID}&response_type=code&scope=XboxLive.signin%20offline_access&redirect_uri=https://login.microsoftonline.com/common/oauth2/nativeclient`
    );

    return { opened: true, alreadyOpen: false };
}

async function launcherApiHandleRequest(req, res) {
    if (!req.url || !req.method) {
        launcherApiWriteJson(res, 400, { ok: false, error: 'invalid_request' });
        return;
    }

    if (req.method === 'OPTIONS') {
        res.writeHead(204, {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type'
        });
        res.end();
        return;
    }

    const reqUrl = new URL(req.url, `http://${LAUNCHER_API_HOST}:${LAUNCHER_API_PORT}`);

    if (req.method === 'GET' && reqUrl.pathname === '/health') {
        const account = launcherApiGetSelectedMicrosoftAccount();
        launcherApiWriteJson(res, 200, {
            ok: true,
            service: 'healingcamp-launcher',
            now: new Date().toISOString(),
            auth: {
                authenticated: !!account,
                account
            }
        });
        return;
    }

    if (req.method === 'GET' && reqUrl.pathname === '/auth/status') {
        const account = launcherApiGetSelectedMicrosoftAccount();
        launcherApiWriteJson(res, 200, {
            ok: true,
            authenticated: !!account,
            account
        });
        return;
    }

    if (req.method === 'POST' && reqUrl.pathname === '/auth/login') {
        const popup = ensureMicrosoftLoginPopupFromApi();
        launcherApiWriteJson(res, 200, {
            ok: true,
            popupOpened: popup.opened,
            alreadyOpen: popup.alreadyOpen
        });
        return;
    }

    if (req.method === 'POST' && reqUrl.pathname === '/launch') {
        try {
            const payload = await launcherApiReadJson(req);
            const mapFileUrl = payload?.map?.fileUrl || null;

            if (!mapFileUrl) {
                launcherApiWriteJson(res, 422, {
                    ok: false,
                    error: 'missing_map_file_url',
                    message: 'map.fileUrl is required.'
                });
                return;
            }

            const account = launcherApiGetSelectedMicrosoftAccount();
            if (!account) {
                const popup = ensureMicrosoftLoginPopupFromApi();
                launcherApiWriteJson(res, 401, {
                    ok: false,
                    error: 'microsoft_login_required',
                    message: popup.opened
                        ? 'Microsoft login popup opened. Complete login and click Play again.'
                        : 'Microsoft login popup is already open. Complete login and click Play again.',
                    popupOpened: popup.opened
                });
                return;
            }

            const targetWindow = (mainWindow && !mainWindow.isDestroyed())
                ? mainWindow
                : ((loginWindow && !loginWindow.isDestroyed()) ? loginWindow : null);

            if (!targetWindow) {
                launcherApiWriteJson(res, 503, {
                    ok: false,
                    error: 'launcher_window_unavailable',
                    message: 'No available launcher window to start game flow.'
                });
                return;
            }

            const launchResult = await launchMinecraftGame(targetWindow);
            if (!launchResult.success) {
                launcherApiWriteJson(res, 500, {
                    ok: false,
                    error: 'launch_failed',
                    message: launchResult.message || 'Failed to launch Minecraft.'
                });
                return;
            }

            launcherApiWriteJson(res, 200, {
                ok: true,
                message: launchResult.message || 'Launch started',
                launchedPID: launchResult.launchedPID || null,
                account,
                requestedMap: {
                    id: payload?.map?.id || null,
                    title: payload?.map?.title || null,
                    fileUrl: mapFileUrl
                }
            });
        } catch (error) {
            launcherApiWriteJson(res, 400, {
                ok: false,
                error: error instanceof Error ? error.message : 'unknown_error'
            });
        }
        return;
    }

    launcherApiWriteJson(res, 404, { ok: false, error: 'not_found' });
}

function startLauncherLocalApiServer() {
    if (launcherLocalApiServer) {
        return;
    }

    launcherLocalApiServer = nodeHttp.createServer((req, res) => {
        launcherApiHandleRequest(req, res).catch((error) => {
            log.error('[LauncherAPI] Unhandled request error:', error);
            launcherApiWriteJson(res, 500, { ok: false, error: 'internal_error' });
        });
    });

    launcherLocalApiServer.on('error', (error) => {
        log.error('[LauncherAPI] Server error:', error);
    });

    launcherLocalApiServer.listen(LAUNCHER_API_PORT, LAUNCHER_API_HOST, () => {
        log.info(`[LauncherAPI] Listening on http://${LAUNCHER_API_HOST}:${LAUNCHER_API_PORT}`);
    });
}

function stopLauncherLocalApiServer() {
    if (!launcherLocalApiServer) {
        return;
    }

    try {
        launcherLocalApiServer.close();
    } catch (error) {
        log.error('[LauncherAPI] Failed to close server:', error);
    } finally {
        launcherLocalApiServer = null;
    }
}

app.whenReady().then(() => {
    startLauncherLocalApiServer();
});

app.on('before-quit', () => {
    stopLauncherLocalApiServer();
});

// --- End Local Launcher API ---
