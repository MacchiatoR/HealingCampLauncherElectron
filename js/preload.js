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
    CLOSE_REQUEST: 'WINDOW_CONTROL_CLOSE_REQUEST' // <<<--- 새 채널 이름 추가
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
        MSFT_REPLY_TYPE: MSFT_REPLY_TYPE,
        MSFT_ERROR: MSFT_ERROR
    },

    // --- 새 API 함수 추가 ---
    /**
     * 현재 창을 닫도록 메인 프로세스에 요청합니다.
     */
    requestCloseCurrentWindow: () => {
        console.log('[Preload] Requesting to close current window via channel:', WINDOW_CONTROL.CLOSE_REQUEST);
        ipcRenderer.send(WINDOW_CONTROL.CLOSE_REQUEST); // 정의된 채널로 메시지 전송
    }
});

console.log('[Preload] electronAPI has been exposed to the window object.');