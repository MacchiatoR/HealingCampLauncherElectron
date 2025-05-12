// main.js
const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const log = {
    info: (message, ...args) => console.log(`[INFO] ${new Date().toISOString()} [WindowManager] ${message}`, ...args),
    error: (message, ...args) => console.error(`[ERROR] ${new Date().toISOString()} [WindowManager] ${message}`, ...args),
    warn: (message, ...args) => console.warn(`[WARN] ${new Date().toISOString()} [WindowManager] ${message}`, ...args), 
};
const remoteMain = require('@electron/remote/main')
remoteMain.initialize()

// 모듈 로드
const AuthManager = require('./js/authhandler'); // AuthManager 경로
const ConfigManager = require('./js/confighandler'); // ConfigManager 경로
const autoUpdater = require('electron-updater').autoUpdater
const semver = require('semver')

// ConfigManager 로드 (앱 시작 시 한 번)
if (!ConfigManager.isLoaded()) {
    ConfigManager.load();
}

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

function registerAutoUpdaterEvents() {
    log.info('[AutoUpdater] Registering global event listeners.');
    // autoUpdater.removeAllListeners(); // 이 줄은 autoUpdater 객체에 해당 메소드가 없다면 에러 유발, 일단 주석 처리

    autoUpdater.on('checking-for-update', () => {
        log.info('[AutoUpdater] Event: checking-for-update');
        if (updaterEventSender && !updaterEventSender.isDestroyed()) {
            updaterEventSender.send('autoUpdateNotification', 'checking-for-update');
        }
    });

    autoUpdater.on('update-available', (info) => {
        log.info('[AutoUpdater] Event: update-available:', info);
        if (updaterEventSender && !updaterEventSender.isDestroyed()) {
            updaterEventSender.send('autoUpdateNotification', 'update-available', info);
        }

        if (splashWindow && !splashWindow.isDestroyed()) {
            log.info('[AutoUpdater] Hiding splash window to show error dialog.');
            splashWindow.hide(); // Hide the splash window
        }

        // autoDownload가 false로 설정되었으므로, 항상 사용자에게 다운로드 여부를 묻습니다.
        dialog.showMessageBox({
            type: 'info',
            title: '업데이트 알림',
            message: `새로운 버전 ${info.version}을(를) 다운로드할 수 있습니다.`,
            detail: '지금 다운로드하고 설치 준비를 하시겠습니까? 앱은 다운로드 후 다시 시작해야 업데이트됩니다.',
            buttons: ['지금 다운로드', '나중에'],
            defaultId: 0,
            cancelId: 1
        }).then(result => {
            if (result.response === 0) {
                log.info('[AutoUpdater] User chose to download the update.');
                autoUpdater.downloadUpdate();
            } else {
                log.info('[AutoUpdater] User chose to download later. Proceeding to login.');
                proceedToLoginWindow();
            }
        }).catch(err => {
            log.error('[AutoUpdater] Error showing update-available dialog:', err);
            proceedToLoginWindow();
        });
    });

    autoUpdater.on('update-not-available', (info) => {
        log.info('[AutoUpdater] Event: update-not-available.', info);
        if (updaterEventSender && !updaterEventSender.isDestroyed()) {
            updaterEventSender.send('autoUpdateNotification', 'update-not-available', info);
        }
        proceedToLoginWindow(); // 업데이트 없으면 로그인 창으로 진행
    });

    autoUpdater.on('error', (err) => {
        log.error('[AutoUpdater] Event: error:', err);
        if (updaterEventSender && !updaterEventSender.isDestroyed()) {
            updaterEventSender.send('autoUpdateNotification', 'realerror', err);
        }
        dialog.showMessageBox({
            type: 'error',
            title: '업데이트 오류',
            message: '업데이트 중 오류가 발생했습니다.',
            detail: `오류 내용: ${err.message}\n\n애플리케이션을 계속 사용하시겠습니까?`,
            buttons: ['계속 사용 (로그인 화면으로)', '앱 종료'],
            defaultId: 0,
            cancelId: 1
        }).then(result => {
            if (result.response === 0) {
                proceedToLoginWindow();
            } else {
                app.quit();
            }
        }).catch(dialogErr => {
            log.error('[AutoUpdater] Error showing error dialog:', dialogErr);
            proceedToLoginWindow();
        });
    });

    autoUpdater.on('download-progress', (progressObj) => {
        log.info(`[AutoUpdater] Event: download-progress - ${progressObj.percent}%`);
        const targetWindow = loginWindow || mainWindow;
        if (targetWindow && !targetWindow.isDestroyed()) {
             targetWindow.webContents.send('autoUpdateNotification', 'download-progress', progressObj);
        }
    });

    autoUpdater.on('update-downloaded', (info) => {
        log.info('[AutoUpdater] Event: update-downloaded:', info);
        if (updaterEventSender && !updaterEventSender.isDestroyed()) {
            updaterEventSender.send('autoUpdateNotification', 'update-downloaded', info);
        }
        dialog.showMessageBox({
            type: 'info',
            title: '업데이트 다운로드 완료',
            message: `버전 ${info.version} 다운로드가 완료되었습니다.`,
            detail: '지금 설치하고 앱을 다시 시작하시겠습니까?',
            buttons: ['지금 설치 및 재시작', '나중에 (앱 종료 시 설치)'],
            defaultId: 0,
            cancelId: 1
        }).then(result => {
            if (result.response === 0) {
                autoUpdater.quitAndInstall();
            } else {
                // "나중에 설치" 선택 시, autoInstallOnAppQuit=true면 앱 종료 시 자동 설치됨.
                // 사용자가 업데이트를 연기했으므로 로그인 창으로 진행.
                log.info('[AutoUpdater] User chose to install on quit. Proceeding to login for now.');
                proceedToLoginWindow();
            }
        }).catch(err => {
            log.error('[AutoUpdater] Error showing update-downloaded dialog:', err);
            proceedToLoginWindow();
        });
    });
}

function configureAutoUpdater(allowPrereleaseSetting) {
    log.info(`[AutoUpdater] Configuring. Allow Prerelease: ${allowPrereleaseSetting}, isDev: ${isDev}`);
    autoUpdater.allowPrerelease = !!allowPrereleaseSetting;

    if (isDev) {
        autoUpdater.autoInstallOnAppQuit = false;
        autoUpdater.updateConfigPath = path.join(__dirname, 'dev-app-update.yml');
        autoUpdater.autoDownload = false; // 개발 중에는 항상 다운로드 여부 확인
        log.info(`[AutoUpdater] Dev mode: autoInstallOnAppQuit=false, autoDownload=false, updateConfigPath=${autoUpdater.updateConfigPath}`);
    } else {
        autoUpdater.autoInstallOnAppQuit = true; // 프로덕션에서는 앱 종료 시 자동 설치
        autoUpdater.autoDownload = false; // 프로덕션에서도 사용자에게 다운로드 여부 확인
        log.info('[AutoUpdater] Production mode: autoInstallOnAppQuit=true, autoDownload=false');
    }
    // macOS는 autoDownload = false가 기본적으로 권장됨 (위 설정으로 커버됨)
}

function checkForInitialUpdates() {
     log.info('[AutoUpdater] Starting initial check for updates.');
    autoUpdater.checkForUpdates()
        .then(updateCheckResult => {
            log.info('[AutoUpdater] Initial checkForUpdates() promise resolved. Result:', updateCheckResult);

            let proceed = false;
            if (isDev && !autoUpdater.forceDevUpdateConfig) { // 방법 1의 forceDevUpdateConfig가 설정되지 않았거나 효과 없을 때
                // 개발 환경이고, dev-app-update.yml 강제 사용 설정이 안 되어 있다면
                // "Skip checkForUpdates..." 메시지와 함께 이벤트가 발생 안 할 수 있음.
                // 이 경우 updateCheckResult가 특정 값을 가질 수 있음 (예: null 또는 업데이트 확인 건너뜀 정보)
                // 명시적으로 로그를 확인하고 해당 조건에 맞춰 로그인으로 진행.
                // 예시: 만약 'Skip checkForUpdates...' 메시지가 항상 updateCheckResult.cancellationToken을 반환한다면
                if (updateCheckResult && updateCheckResult.cancellationToken && updateCheckResult.cancellationToken.reason && updateCheckResult.cancellationToken.reason.includes('application is not packed')) {
                    log.warn("[AutoUpdater] Update check skipped in dev (not packed, no force config). Proceeding to login.");
                    proceed = true;
                }
            }
            
            // 일반적인 "업데이트 없음" 시나리오 (프로덕션 또는 forceDevUpdateConfig=true인 dev)
            if (!proceed && (updateCheckResult === null ||
                (updateCheckResult.updateInfo && updateCheckResult.updateInfo.version === app.getVersion()))) {
                log.info("No new update found from checkForUpdates() direct result. Proceeding to login.");
                proceed = true;
            }

            if (proceed) {
                // 'update-not-available' 이벤트가 발생할 수도 있으므로,
                // 바로 proceedToLoginWindow()를 호출하기보다, 해당 이벤트 핸들러에 맡기는 것이
                // 로직 중복을 피하는 방법일 수 있습니다.
                // 하지만 이벤트가 확실히 발생하지 않는다면 여기서 직접 호출해야 합니다.
                // 안전하게는, 약간의 딜레이 후 loginWindow가 여전히 없다면 호출.
                proceedToLoginWindow();
            }
            // 'update-available' 이벤트는 해당 핸들러에서 처리됨.
        })
        .catch(err => {
            log.error('[AutoUpdater] Initial checkForUpdates() promise rejected:', err);
            dialog.showMessageBox({ /* ... */ }).then(() => {
                proceedToLoginWindow();
            });
        });
}

ipcMain.on('autoUpdateAction', (event, arg, data) => {
    if (event && event.sender) updaterEventSender = event.sender;
    switch(arg){
        case 'initAutoUpdater':
            log.info('[IPC] autoUpdateAction: initAutoUpdater (configure)');
            configureAutoUpdater(data);
            if(updaterEventSender && !updaterEventSender.isDestroyed()) {
                updaterEventSender.send('autoUpdateNotification', 'ready');
            }
            break;
        case 'checkForUpdate':
            log.info('[IPC] autoUpdateAction: checkForUpdate');
            autoUpdater.checkForUpdates().catch(err => {
                log.error('[AutoUpdater] IPC checkForUpdates promise rejected:', err);
                if (updaterEventSender && !updaterEventSender.isDestroyed()) {
                    updaterEventSender.send('autoUpdateNotification', 'realerror', err);
                }
            });
            break;
        case 'allowPrereleaseChange':
            log.info(`[IPC] autoUpdateAction: allowPrereleaseChange to ${data}`);
            autoUpdater.allowPrerelease = !!data;
            break;
        case 'installUpdateNow':
            log.info('[IPC] autoUpdateAction: installUpdateNow');
            autoUpdater.quitAndInstall();
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
        width: 400, height: 400, transparent: true, frame: false, alwaysOnTop: true,
        webPreferences: { preload: path.join(__dirname, './js/preload.js') }
    });
    splashWindow.loadFile(path.join(__dirname, 'splash.html'));
    splashWindow.on('closed', () => {
        log.info('[WindowManager] Splash window closed.');
        splashWindow = null;
    });
}

function createLoginWindow() {
    if (loginWindow && !loginWindow.isDestroyed()) {
        log.info('[WindowManager] Login window already exists, focusing.');
        loginWindow.focus();
        return;
    }
    log.info('[WindowManager] Creating login window...');
    loginWindow = new BrowserWindow({
        width: 750, height: 450, frame: false, show: false, resizable: false,
        webPreferences: {
            preload: path.join(__dirname, '/js/preload.js'),
            contextIsolation: true, nodeIntegration: false,
        }
    });
    remoteMain.enable(loginWindow.webContents); // loginWindow에서도 remote 사용 가능하도록
    loginWindow.loadFile(path.join(__dirname, 'login.html'));
    loginWindow.once('ready-to-show', () => {
        if (loginWindow && !loginWindow.isDestroyed()) {
            loginWindow.show();
            log.info('[WindowManager] Login window shown.');
            // updaterEventSender = loginWindow.webContents; // 필요시 주석 해제
        }
    });
    loginWindow.on('closed', () => {
        log.info('[WindowManager] Login window closed.');
        loginWindow = null;
    });
}

function createMainWindow() {
    if (mainWindow && !mainWindow.isDestroyed()) {
        log.info('[WindowManager] Main window already exists, focusing.');
        mainWindow.focus();
        return;
    }
    log.info('[WindowManager] Creating main window...');
    mainWindow = new BrowserWindow({
        width: 1280, height: 720, show: false, frame: false,
        webPreferences: {
            preload: path.join(__dirname, 'js', 'preload.js'),
            contextIsolation: true, nodeIntegration: false,
        }
    });
    remoteMain.enable(mainWindow.webContents); // mainWindow에서도 remote 사용 가능하도록
    mainWindow.loadFile(path.join(__dirname, 'mainmenu.html'));
    mainWindow.once('ready-to-show', () => {
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.show();
            log.info('[WindowManager] Main window shown.');
            // updaterEventSender = mainWindow.webContents; // 필요시 주석 해제
        }
    });
    mainWindow.on('closed', () => {
        log.info('[WindowManager] Main window closed.');
        mainWindow = null;
        // macOS가 아닌 경우, 메인 창이 닫히면 앱 종료 (기본 동작)
        // if (process.platform !== 'darwin') {
        //     app.quit();
        // }
    });
}

// 로그인 창으로 진행하는 함수
function proceedToLoginWindow() {
    log.info('[WindowManager] Attempting to proceed to login window...');
    if (splashWindow && !splashWindow.isDestroyed()) {
        log.info('[WindowManager] Closing splash window before proceeding to login.');
        splashWindow.close(); // splashWindow = null; 은 'closed' 이벤트에서 처리
    }

    // 메인 창이 열려있다면 닫아야 로그인 창으로 "돌아갈" 수 있음
    if (mainWindow && !mainWindow.isDestroyed()) {
        log.info('[WindowManager] Closing main window before proceeding to login.');
        mainWindow.close(); // mainWindow = null; 은 'closed' 이벤트에서 처리
    }

    if (loginWindow && !loginWindow.isDestroyed()) {
        log.warn('[WindowManager] Login window might already exist. Focusing login.');
        loginWindow.focus();
        return;
    }
    createLoginWindow();
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

// --- 앱 수명주기 이벤트 ---
app.whenReady().then(async () => {
    log.info('App is ready.');

    registerAutoUpdaterEvents(); // 이벤트 리스너는 한 번만 등록
    const initialAllowPrerelease = ConfigManager.getAllowPrerelease ? ConfigManager.getAllowPrerelease() : false;
    configureAutoUpdater(initialAllowPrerelease); // 초기 설정 적용

    createSplashWindow();

    ipcMain.on(IPC_CHANNELS.SPLASH_DONE, () => {
        log.info("Splash done. Closing splash and then checking for updates...");
        if (splashWindow && !splashWindow.isDestroyed()) {
            splashWindow.once('closed', () => {
                log.info("Splash window officially closed. Now checking for updates.");
                checkForInitialUpdates();
            });
            splashWindow.close();
        } else {
            log.info("No splash window found or already closed. Checking for updates directly.");
            checkForInitialUpdates();
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