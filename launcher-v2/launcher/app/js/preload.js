// preload.js
const { contextBridge, ipcRenderer } = require('electron');

// --- ipc.js 내용 (기존 코드 유지) ---
const AZURE_CLIENT_ID = '736c8f61-cf79-4954-bb1a-9391ee6d70e1'; // 실제 값으로


const MSFT_OPCODE = {
    OPEN_LOGIN: 'MSFT_AUTH_OPEN_LOGIN',
    OPEN_LOGOUT: 'MSFT_AUTH_OPEN_LOGOUT',
    REPLY_LOGIN: 'MSFT_AUTH_REPLY_LOGIN',
    REPLY_LOGOUT: 'MSFT_AUTH_REPLY_LOGOUT',
    PROCESS_AUTH_CODE: 'MSFT_PROCESS_AUTH_CODE'
};
const MSFT_REPLY_TYPE = {
    SUCCESS: 'MSFT_AUTH_REPLY_SUCCESS',
    ERROR: 'MSFT_AUTH_REPLY_ERROR'
};
const MSFT_ERROR = {
    ALREADY_OPEN: 'MSFT_AUTH_ERR_ALREADY_OPEN',
    NOT_FINISHED: 'MSFT_AUTH_ERR_NOT_FINISHED'
};

const WINDOW_CONTROL = {
    SWITCH_TO_MAIN_REQUEST: 'WINDOW_SWITCH_TO_MAIN_REQUEST',
    SWITCH_TO_LOGIN_REQUEST: 'WINDOW_SWITCH_TO_LOGIN_REQUEST',
    CLOSE_REQUEST: 'WINDOW_CONTROL_CLOSE_REQUEST' 
};
// --- ipc.js 내용 끝 ---

const CHANNELS = {
    SPLASH_DONE: 'splash-done',
    REQUEST_LOGIN_COMPLETE: 'request-login-complete',
};

contextBridge.exposeInMainWorld('electronAPI', {
    // --- 기존 API 함수들 ---
    splashDone: () => ipcRenderer.send(CHANNELS.SPLASH_DONE),
    sendLoginComplete: () => ipcRenderer.send(CHANNELS.REQUEST_LOGIN_COMPLETE),
    sendMsftOpenLogin: (successView, cancelView) => {
        console.log('[Preload] Sending MSFT_OPEN_LOGIN with channel:', MSFT_OPCODE.OPEN_LOGIN);
        ipcRenderer.send(MSFT_OPCODE.OPEN_LOGIN, successView, cancelView);
    },
    receiveLoginReply: (callback) => {
        const channel = MSFT_OPCODE.REPLY_LOGIN;
        const listener = (event, ...args) => callback(...args);
        ipcRenderer.on(channel, listener);
        return () => {
            ipcRenderer.removeListener(channel, listener);
        };
    },
    processAuthCode: (authCode) => {
        console.log('[Preload] Requesting to process auth code'); // 코드는 로그에 남기지 않음
        return ipcRenderer.invoke(MSFT_OPCODE.PROCESS_AUTH_CODE, authCode);
    },
    requestSwitchToMainWindow: () => {
        console.log('[Preload] Requesting to switch to main window.');
        ipcRenderer.send(WINDOW_CONTROL.SWITCH_TO_MAIN_REQUEST);
    },
    // --- 기존 CONSTANTS ---
     CONSTANTS: {
        MSFT_OPCODE: MSFT_OPCODE,           // <<<--- 여기에 MSFT_OPCODE 추가
        MSFT_REPLY_TYPE: MSFT_REPLY_TYPE,
        MSFT_ERROR: MSFT_ERROR
        // 만약 WINDOW_CONTROL이나 CHANNELS 상수도 렌더러에서 필요하다면 여기에 추가
        // WINDOW_CONTROL: WINDOW_CONTROL,
        // CHANNELS: CHANNELS
    },

    // --- 새 API 함수 추가 ---
    /**
     * 현재 창을 닫도록 메인 프로세스에 요청합니다.
     */
    requestCloseCurrentWindow: () => {
        console.log('[Preload] Requesting to close current window via channel:', WINDOW_CONTROL.CLOSE_REQUEST);
        ipcRenderer.send(WINDOW_CONTROL.CLOSE_REQUEST); // 정의된 채널로 메시지 전송
    },

    // --- 로그아웃 관련 API 추가 ---
    /**
     * Microsoft 로그아웃 창을 열도록 메인 프로세스에 요청합니다.
     * @param {string} uuid 로그아웃할 계정의 UUID
     */
    sendMsftOpenLogout: (uuid) => { 
        console.log('[Preload] Sending MSFT_OPEN_LOGOUT for UUID:', uuid);
        ipcRenderer.send(MSFT_OPCODE.OPEN_LOGOUT, uuid); // isLastAccount 인자 없이 전송
    },

    getSelectedAccount: () => {
        console.log('[Preload] Requesting selected account from main process.');
        return ipcRenderer.invoke('config:getSelectedAccount'); // main.js에 핸들러 필요
    },

    /**
     * 메인 프로세스로부터 로그아웃 결과 응답을 수신합니다.
     * @param {function} callback (replyType, data1, data2, ...)
     * @returns {function} 리스너 제거 함수
     */
    receiveLogoutReply: (callback) => {
        const channel = MSFT_OPCODE.REPLY_LOGOUT;
        const listener = (event, replyType, uuid) => callback(replyType, uuid); // args 구조 변경
        ipcRenderer.on(channel, listener);
        return () => {
            ipcRenderer.removeListener(channel, listener);
        };
    },

    /**
     * 메인 프로세스에 특정 Microsoft 계정 제거를 요청합니다.
     * @param {string} uuid 제거할 계정의 UUID
     * @returns {Promise<{success: boolean, error?: string}>}
     */
    removeMicrosoftAccount: (uuid) => {
        console.log('[Preload] Requesting to remove Microsoft account:', uuid);
        return ipcRenderer.invoke('auth:removeMicrosoftAccount', uuid);
    },

    requestSwitchToLoginWindow: () => {
        console.log('[Preload] Requesting to switch to login window.');
        ipcRenderer.send(WINDOW_CONTROL.SWITCH_TO_LOGIN_REQUEST);
    },

    launchMinecraft: () => {
        console.log('[Preload] Requesting to launch Minecraft.');
        return ipcRenderer.invoke('launch-minecraft');
    },

    getLauncherSettings: () => ipcRenderer.invoke('settings:get-all'),
    saveLauncherSettings: (settings) => ipcRenderer.invoke('settings:save-all', settings),

    // 진행률 업데이트 수신을 위한 리스너 등록 함수
    onLaunchProgressStart: (callback) => ipcRenderer.on('launch-progress-start', (_event, data) => callback(data)),
    onLaunchProgressUpdate: (callback) => ipcRenderer.on('launch-progress-update', (_event, data) => callback(data)),
    onLaunchProgressComplete: (callback) => ipcRenderer.on('launch-progress-complete', (_event, data) => callback(data)),
    // 리스너 제거 함수 (컴포넌트 unmount 시 호출)
    removeLaunchProgressListeners: () => {
        ipcRenderer.removeAllListeners('launch-progress-start');
        ipcRenderer.removeAllListeners('launch-progress-update');
        ipcRenderer.removeAllListeners('launch-progress-complete');
    },
    requestAppQuit: () => ipcRenderer.send('request-app-quit')
});

console.log('[Preload] electronAPI has been exposed to the window object.');
