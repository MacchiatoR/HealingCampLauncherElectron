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

// --- 상수 및 설정 ---
const IPC_CHANNELS = {
    SPLASH_DONE: 'splash-done',
    REQUEST_LOGIN_COMPLETE: 'request-login-complete', // 일반 로그인 완료 후 메인 창 전환용
};

const WINDOW_CONTROL = {
    SWITCH_TO_MAIN_REQUEST: 'WINDOW_SWITCH_TO_MAIN_REQUEST' // 렌더러 -> 메인: 메인 창으로 전환 요청
};

// --- 전역 변수 ---
let splashWindow;
let loginWindow;
let mainWindow;

// --- 오토 업데이터 ---
const isDev = !app.isPackaged;

let updaterEventSender = null; // 업데이트 알림을 보낼 렌더러의 event.sender 저장

function registerAutoUpdaterEvents() {
    log.info('[AutoUpdater] Registering global event listeners.');

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
        if (!isDev && (process.platform === 'darwin' || !autoUpdater.autoDownload)) {
            dialog.showMessageBox({  type: 'info',
            title: '업데이트 알림',
            message: `새로운 버전 ${info.version}이 있습니다.`,
            detail: '지금 다운로드하고 설치 준비를 하시겠습니까?\n(앱은 다운로드 후 다시 시작해야 업데이트됩니다.)',
            buttons: ['지금 다운로드', '나중에 알림'],
            defaultId: 0, // 기본 선택 버튼
            cancelId: 1   // 취소 버튼 (ESC 등) 
            }).then(result => {
                if (result.response === 0) autoUpdater.downloadUpdate();
            });
        }
    });

    autoUpdater.on('update-not-available', (info) => {
        log.info('[AutoUpdater] Event: update-not-available.', info);
        if (updaterEventSender && !updaterEventSender.isDestroyed()) {
            updaterEventSender.send('autoUpdateNotification', 'update-not-available', info);
        }
        // 이 이벤트는 업데이트 확인 후 로그인 창으로 진행하는 트리거로 사용될 수 있음
        // (단, checkForUpdates() 호출 후의 로직에서 처리)
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
            buttons: ['계속 사용', '앱 종료'],
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
            proceedToLoginWindow(); // 다이얼로그 오류 시에도 로그인 창으로 진행 (안전장치)
        });
        // 이 이벤트도 로그인 창 진행 또는 앱 종료 결정 트리거로 사용될 수 있음
    });

    autoUpdater.on('download-progress', (progressObj) => {
        log.info(`[AutoUpdater] Event: download-progress - ${progressObj.percent}%`);
        // 현재 활성화된 주요 창(loginWindow 또는 mainWindow)으로 진행률 전송
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
            message: `새로운 버전 ${info.version}의 다운로드가 완료되었습니다.`,
            detail: '지금 설치하고 앱을 다시 시작하시겠습니까?',
            buttons: ['지금 설치 및 재시작', '나중에 (앱 종료 시 자동 설치)'],
            defaultId: 0,
            cancelId: 1
        }).then(result => {
            if (result.response === 0) autoUpdater.quitAndInstall();
        });
    });
}

function configureAutoUpdater(allowPrereleaseSetting) {
    log.info(`[AutoUpdater] Configuring. Allow Prerelease: ${allowPrereleaseSetting}, isDev: ${isDev}`);

    autoUpdater.allowPrerelease = !!allowPrereleaseSetting;

    if (isDev) {
        autoUpdater.autoInstallOnAppQuit = false;
        autoUpdater.updateConfigPath = path.join(__dirname, 'dev-app-update.yml');
        log.info(`[AutoUpdater] Dev mode: autoInstallOnAppQuit=false, updateConfigPath=${autoUpdater.updateConfigPath}`);
    } else {
        autoUpdater.autoInstallOnAppQuit = true;
        log.info('[AutoUpdater] Production mode: autoInstallOnAppQuit=true');
    }

    if (process.platform === 'darwin') {
        autoUpdater.autoDownload = false;
        log.info('[AutoUpdater] macOS: autoDownload=false');
    } else {
        autoUpdater.autoDownload = true;
        log.info('[AutoUpdater] Other OS: autoDownload=true');
    }
}

// --- 창 생성 함수들 ---
function createSplashWindow() {
    splashWindow = new BrowserWindow({
        width: 400,
        height: 400,
        transparent: true,
        frame: false,
        alwaysOnTop: true,
        webPreferences: {
            preload: path.join(__dirname, './js/preload.js')
        }
    });
    splashWindow.loadFile(path.join(__dirname, 'splash.html'));
    splashWindow.on('closed', () => { splashWindow = null; });
}

function createLoginWindow() {
    if (loginWindow && !loginWindow.isDestroyed()) {
        loginWindow.focus();
        return;
    }
    loginWindow = new BrowserWindow({
        width: 750,
        height: 450, // 또는 login.html 디자인에 맞는 크기
        frame: false,
        show: false,
        resizable: false,
        webPreferences: {
            preload: path.join(__dirname, '/js/preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
        }
    });

    loginWindow.loadFile(path.join(__dirname, 'login.html'));
    loginWindow.once('ready-to-show', () => { if (loginWindow) loginWindow.show(); });
    loginWindow.on('closed', () => { loginWindow = null; });
}

function createMainWindow() {
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.focus();
        return;
    }
    mainWindow = new BrowserWindow({
        width: 1280, // 요청하신 크기
        height: 720, // 요청하신 크기
        show: false, // <<--- 초기에는 숨김
        frame: false, // 기본 프레임 사용 (또는 false로 하고 커스텀 타이틀바)
        webPreferences: {
            preload: path.join(__dirname, 'js', 'preload.js'), // 메인 창에도 preload가 필요하면 설정
            contextIsolation: true,
            nodeIntegration: false,
        }
    });

    mainWindow.loadFile(path.join(__dirname, 'mainmenu.html')); // mainmenu.html 로드
    // mainWindow.once('ready-to-show', () => { if (mainWindow) mainWindow.show(); }); // 여기서 바로 show 하지 않음
    mainWindow.on('closed', () => {
        mainWindow = null;
        if (process.platform !== 'darwin') {
            app.quit();
        }
    });
    // remoteMain.enable(mainWindow.webContents); // 메인 창에서 @electron/remote 사용 시
}

// 로그인 창으로 진행하는 함수
function proceedToLoginWindow() {
    log.info('Proceeding to login window.');
    if (splashWindow && !splashWindow.isDestroyed()) {
        splashWindow.close();
    }
    if (!loginWindow && !mainWindow) { // mainWindow 조건은 사실상 불필요 (로그인 전이므로)
        createLoginWindow();
    } else if (loginWindow && !loginWindow.isDestroyed()) {
        loginWindow.focus(); // 이미 있다면 포커스
    }
}

// --- 마이크로소프트 로그인
const REDIRECT_URI_PREFIX = 'https://login.microsoftonline.com/common/oauth2/nativeclient?'
const { AZURE_CLIENT_ID, MSFT_OPCODE, MSFT_REPLY_TYPE, MSFT_ERROR, SHELL_OPCODE } = require('./js/ipc')

let msftAuthWindow
let msftAuthSuccess
let msftAuthViewSuccess
let msftAuthViewOnClose

ipcMain.on('autoUpdateAction', (event, arg, data) => {
    // updaterEventSender를 현재 요청을 보낸 창으로 업데이트 (중요)
    if (event && event.sender) {
        updaterEventSender = event.sender;
    }
    switch(arg){
        case 'initAutoUpdater': // 렌더러에서 설정값(data=allowPrerelease)을 보내 초기화/재설정
            log.info('[IPC] autoUpdateAction: initAutoUpdater (configure)');
            configureAutoUpdater(data); // 설정만 변경
            if(updaterEventSender && !updaterEventSender.isDestroyed()) {
                updaterEventSender.send('autoUpdateNotification', 'ready'); // 설정 완료 알림
            }
            break;
         case 'checkForUpdate':
            log.info('[IPC] autoUpdateAction: checkForUpdate');
            autoUpdater.checkForUpdates()
                .then(updateCheckResult => {
                    // updateCheckResult를 사용하여 추가 작업 가능 (예: 업데이트 정보 로깅)
                    // update-available 또는 update-not-available 이벤트가 발생함
                    log.info('[AutoUpdater] checkForUpdates promise resolved:', updateCheckResult);
                })
                .catch(err => {
                    log.error('[AutoUpdater] checkForUpdates promise rejected:', err);
                    if (updaterEventSender && !updaterEventSender.isDestroyed()) {
                        updaterEventSender.send('autoUpdateNotification', 'realerror', err);
                    }
                    // 로그인 창으로 진행하는 로직 추가 고려 (초기 실행이 아닐 경우)
                });
            break;
        case 'allowPrereleaseChange':
            log.info(`[IPC] autoUpdateAction: allowPrereleaseChange to ${data}`);
            autoUpdater.allowPrerelease = !!data; // 직접 설정 변경
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

ipcMain.on(MSFT_OPCODE.OPEN_LOGIN, (ipcEvent, ...arguments_) => {
    if (msftAuthWindow) {
        ipcEvent.reply(MSFT_OPCODE.REPLY_LOGIN, MSFT_REPLY_TYPE.ERROR, MSFT_ERROR.ALREADY_OPEN, msftAuthViewOnClose)
        return
    }
    msftAuthSuccess = false
    msftAuthViewSuccess = arguments_[0]
    msftAuthViewOnClose = arguments_[1]
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

// --- 앱 수명주기 이벤트 ---
app.whenReady().then(async () => {
    // 자동 업데이트 이벤트 핸들러 전역 등록 (앱 시작 시 한 번만)
    registerAutoUpdaterEvents();
    const initialAllowPrerelease = ConfigManager.getAllowPrerelease ? ConfigManager.getAllowPrerelease() : false;
    configureAutoUpdater(initialAllowPrerelease); // 초기 설정 적용

    // --- 초기 창 생성 ---
    createSplashWindow();

    // --- 일반 창 전환 IPC 핸들러 ---
    ipcMain.on(IPC_CHANNELS.SPLASH_DONE, () => {
        log.info("Splash done. Checking for updates...");

        // updaterEventSender 설정: 스플래시 창이 닫히기 전에 알림을 받을 수 있도록.
        // 하지만 스플래시 창은 곧 닫히므로, 로그인 창이나 메인 창으로 알림 대상을 변경하는 것이 좋음.
        // 여기서는 초기 확인에 대한 직접적인 UI 피드백은 dialog를 사용.
        if (splashWindow && !splashWindow.isDestroyed()) {
            updaterEventSender = splashWindow.webContents; // 임시로 설정
        }

        autoUpdater.checkForUpdates()
            .then(updateCheckResult => {
                log.info('[AutoUpdater] Initial checkForUpdates promise resolved. Result:', updateCheckResult);

                // updateCheckResult가 null이거나, 업데이트 정보가 없거나, 현재 버전과 동일한 경우
                // 이는 electron-updater가 업데이트가 없다고 판단한 상황이거나,
                // 개발 환경에서 'Skip checkForUpdates...' 로그와 함께 확인을 건너뛴 경우일 수 있음.
                // 이런 경우, 'update-not-available' 이벤트가 발생하지 않을 수 있으므로
                // 명시적으로 로그인 창으로 진행하도록 처리.
                if (updateCheckResult === null ||
                    !updateCheckResult.updateInfo ||
                    updateCheckResult.updateInfo.version === app.getVersion()) {

                    log.info("No update found or check skipped by updater. Proceeding to login window directly.");
                    // 'update-not-available' 이벤트 핸들러 내부의 proceedToLoginWindow() 호출에 의존하지 않고,
                    // 여기서 직접 호출하여 로그인 창으로의 진행을 보장.
                    // 단, 'update-not-available' 이벤트가 발생할 수도 있으므로 중복 호출 방지 고민 필요.
                    // -> 가장 간단한 방법은 proceedToLoginWindow 함수 내에서 loginWindow가 이미 있는지 확인하는 것.
                    proceedToLoginWindow();
                }
                // 'update-available' 이벤트는 해당 이벤트 핸들러에서 처리됨 (dialog 표시 등).
            })
            .catch(err => {
                log.error('[AutoUpdater] Initial check for updates failed:', err);
                dialog.showMessageBox({
                    type: 'error', // 오류이므로 type을 error로
                    title: '업데이트 확인 실패',
                    message: `업데이트 서버에 연결 중 오류가 발생했습니다: ${err.message}\n\n오프라인으로 계속 진행합니다.`,
                    buttons: ['확인']
                }).then(() => {
                    proceedToLoginWindow(); // 오류 발생 시에도 로그인 창으로 진행
                });
            });
    });

    ipcMain.on(IPC_CHANNELS.REQUEST_LOGIN_COMPLETE, () => {
        log.info("Login complete signal received (non-MSFT), closing login window and opening main window.");
        if (loginWindow && !loginWindow.isDestroyed()) {
            loginWindow.close();
        }
        if (!mainWindow) {
            createMainWindow();
        }
    });

    ipcMain.on(WINDOW_CONTROL.SWITCH_TO_MAIN_REQUEST, () => {
        log.info('Switch to main window requested.');
        if (loginWindow && !loginWindow.isDestroyed()) {
            // loginWindow는 렌더러의 fade-out 애니메이션 후 닫히도록 할 수도 있고,
            // 여기서 바로 닫아도 됩니다. 렌더러에서 fade-out 후 닫는 것이 더 자연스러울 수 있습니다.
            // 여기서는 일단 닫는 로직만 둡니다. 렌더러에서 fade-out 후 close 신호를 보낼 수도 있습니다.
            // 좀 더 부드러운 전환을 위해, 렌더러가 fade-out 애니메이션을 완료할 시간을 줍니다.
            // loginWindow.close(); // 바로 닫기
            // 더 나은 방법: loginWindow는 렌더러의 fadeOut 완료 후 스스로 닫도록 하고, 여기서는 mainWindow만 처리
            log.info('Closing login window (if open) and creating/showing main window.');
        }

        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.show();
            mainWindow.focus();
        } else {
            createMainWindow(); // mainWindow가 없으면 생성
            // mainWindow가 생성되고 ready-to-show 이벤트 발생 후 show
            if (mainWindow) {
                mainWindow.once('ready-to-show', () => {
                    if (mainWindow) {
                        mainWindow.show();
                        // mainWindow.webContents.openDevTools(); // 디버깅용
                    }
                });
            }
        }
        // 로그인 창이 여전히 떠있다면 닫아줍니다.
        // (login.js에서 fade-out 후 스스로 닫는 로직이 있다면 이 부분은 필요 없을 수 있음)
        if (loginWindow && !loginWindow.isDestroyed()) {
            setTimeout(() => { // 약간의 딜레이 후 닫기 (페이드아웃 시간 고려)
                 if (loginWindow && !loginWindow.isDestroyed()) loginWindow.close();
            }, 600); // CSS fadeOut 시간이 0.5s이므로 약간 더 길게
        }
    });

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