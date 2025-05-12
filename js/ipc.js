// js/ipc.js
exports.AZURE_CLIENT_ID = '736c8f61-cf79-4954-bb1a-9391ee6d70e1'; // 실제 값으로 변경

exports.MSFT_OPCODE = {
    OPEN_LOGIN: 'MSFT_AUTH_OPEN_LOGIN',        // 렌더러 -> 메인: 로그인 창 열기 요청
    OPEN_LOGOUT: 'MSFT_AUTH_OPEN_LOGOUT',
    REPLY_LOGIN: 'MSFT_AUTH_REPLY_LOGIN',      // 메인 -> 렌더러: 로그인 창 결과 응답 (인증 코드 또는 오류)
    REPLY_LOGOUT: 'MSFT_AUTH_REPLY_LOGOUT',
    PROCESS_AUTH_CODE: 'MSFT_PROCESS_AUTH_CODE' // 렌더러 -> 메인: 인증 코드로 계정 처리 요청
};

exports.MSFT_REPLY_TYPE = {
    SUCCESS: 'MSFT_AUTH_REPLY_SUCCESS',
    ERROR: 'MSFT_AUTH_REPLY_ERROR'
};

exports.MSFT_ERROR = {
    ALREADY_OPEN: 'MSFT_AUTH_ERR_ALREADY_OPEN',
    NOT_FINISHED: 'MSFT_AUTH_ERR_NOT_FINISHED',
    TOKEN_EXCHANGE_FAILED: 'MSFT_AUTH_ERR_TOKEN_EXCHANGE_FAILED', // 예시: 토큰 교환 실패 시
    ACCOUNT_ADD_FAILED: 'MSFT_AUTH_ERR_ACCOUNT_ADD_FAILED'    // 예시: 계정 추가 실패 시
};

exports.WINDOW_CONTROL = {
    SWITCH_TO_MAIN_REQUEST: 'WINDOW_SWITCH_TO_MAIN_REQUEST' // 렌더러 -> 메인: 메인 창으로 전환 요청
};
