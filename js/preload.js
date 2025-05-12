// preload.js
const { contextBridge, ipcRenderer } = require('electron');

// --- ipc.js 내용 시작 ---
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
    SWITCH_TO_MAIN_REQUEST: 'WINDOW_SWITCH_TO_MAIN_REQUEST' // 렌더러 -> 메인: 메인 창으로 전환 요청
};
// --- ipc.js 내용 끝 ---

const CHANNELS = {
    SPLASH_DONE: 'splash-done',
    REQUEST_LOGIN_COMPLETE: 'request-login-complete',
    // MSFT_OPEN_LOGIN: 'msft-open-login' // 이 줄은 이제 MSFT_OPCODE.OPEN_LOGIN을 직접 사용하므로 필요 없을 수 있음
};

contextBridge.exposeInMainWorld('electronAPI', {
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
        console.log('[Preload] Requesting to process auth code:', authCode);
        return ipcRenderer.invoke(MSFT_OPCODE.PROCESS_AUTH_CODE, authCode);
    },

    requestSwitchToMainWindow: () => {
        console.log('[Preload] Requesting to switch to main window.');
        ipcRenderer.send(WINDOW_CONTROL.SWITCH_TO_MAIN_REQUEST);
    },

    CONSTANTS: {
        MSFT_REPLY_TYPE: MSFT_REPLY_TYPE,
        MSFT_ERROR: MSFT_ERROR
    }
});

console.log('[Preload] electronAPI has been exposed to the window object.'); 