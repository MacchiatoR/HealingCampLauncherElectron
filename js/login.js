const loginOptionMicrosoft = document.getElementById('loginButton')
const originalLoginButtonText = loginOptionMicrosoft.textContent;

let loginOptionsViewOnLoginSuccess
let loginOptionsViewOnLoginCancel

loginOptionMicrosoft.onclick = (e) => {
    if (window.electronAPI && typeof window.electronAPI.sendMsftOpenLogin === 'function') {
        
        loginOptionMicrosoft.textContent = '로그인 창 여는 중...'; // 또는 '로그인 중...'
        loginOptionMicrosoft.disabled = true; // 버튼 비활성화

        window.electronAPI.sendMsftOpenLogin(
            loginOptionsViewOnLoginSuccess,
            loginOptionsViewOnLoginCancel
        );
    } else {
        console.error('electronAPI.sendMsftOpenLogin is not available!');
        resetButtonState();
    }
};

const { MSFT_REPLY_TYPE, MSFT_ERROR } = window.electronAPI?.CONSTANTS || {};

function resetButtonState() {
    if (loginOptionMicrosoft) {
        loginOptionMicrosoft.textContent = originalLoginButtonText;
        loginOptionMicrosoft.disabled = false; // 버튼 다시 활성화
    }
}

// 메인 프로세스로부터 로그인 창 결과 수신
if (window.electronAPI && typeof window.electronAPI.receiveLoginReply === 'function') {
    console.log('[LoginJS] Setting up listener for login replies (electronAPI.receiveLoginReply).');
    const removeLoginReplyListener = window.electronAPI.receiveLoginReply((replyType, data, targetView) => {
        console.log(`[LoginJS] Received login reply. Type: ${replyType}, Data:`, data, `Target View (from main): ${targetView}`);

        if (replyType === MSFT_REPLY_TYPE.ERROR) {
            const errorCodeOrErrorObject = data;
            const viewAfterError = targetView || loginOptionsViewOnLoginCancel; // main.js에서 보낸 targetView 우선 사용

            console.error('[LoginJS] Login Error Reply. Error Code/Object:', errorCodeOrErrorObject);
            resetButtonState();

        } else if (replyType === MSFT_REPLY_TYPE.SUCCESS) {
            const queryMap = data;
            const viewOnSuccess = targetView || loginOptionsViewOnLoginSuccess; // main.js에서 보낸 targetView 우선 사용

            console.log('[LoginJS] Login Success Reply. QueryMap (contains authCode):', queryMap);

            if (!queryMap || !queryMap.code) {
                console.error('[LoginJS] Auth code (queryMap.code) is missing in success reply!', queryMap);
                resetButtonState();
                return;
            }

            const authCode = queryMap.code;
            console.info(`AuthCode acquired: ${authCode}. Proceeding to process with AuthManager via main process...`);

            if (loginOptionMicrosoft) {
                 loginOptionMicrosoft.textContent = '계정 정보 확인 중...';
            }

            // 메인 프로세스에 인증 코드 처리 요청
            if (window.electronAPI && typeof window.electronAPI.processAuthCode === 'function') {
                // (선택) UI를 '처리 중' 상태로 변경 (예: 로딩 스피너)
                // document.body.classList.add('loading');
                console.log('[LoginJS] Calling electronAPI.processAuthCode...');

                window.electronAPI.processAuthCode(authCode)
                    .then(result => {
                        // document.body.classList.remove('loading'); // 로딩 스피너 제거
                        console.log('[LoginJS] AuthManager processing result from main process:', result);

                        if (result.success) {
                            const accountValue = result.value;
                            console.info('Microsoft Account successfully processed by AuthManager:', accountValue);

                            // updateSelectedAccount는 UI 및 Config 저장을 담당해야 함
                            // Config 저장은 메인 프로세스 AuthManager에서 이미 수행했을 수 있음.
                            // 여기서는 UI 업데이트 및 로컬 상태 반영에 집중할 수 있음.
                            if (typeof updateSelectedAccount === 'function') {
                                updateSelectedAccount(accountValue);
                            }

                            console.info('Login flow complete. Fading out login window and requesting main window switch...');

                            // 1. login.html 페이드 아웃 시작
                            document.body.classList.add('fade-out');

                            // 2. 페이드 아웃 애니메이션 시간(0.5s) 후 메인 창 전환 요청
                            setTimeout(() => {
                                console.log('[LoginJS] Fade out complete. Requesting switch to main window.');
                                if (window.electronAPI && typeof window.electronAPI.requestSwitchToMainWindow === 'function') {
                                    window.electronAPI.requestSwitchToMainWindow();
                                    // 현재 로그인 창은 main.js에서 닫힐 것입니다.
                                } else {
                                    console.error('[LoginJS] electronAPI.requestSwitchToMainWindow is not available!');
                                    resetButtonState();
                                }
                            }, 500); // CSS fadeOut animation-duration (0.5s)
                        } else {
                            const displayableError = result.error; // { title: '...', desc: '...' } 형태 기대
                            console.error('Error from AuthManager (via main process):', displayableError);
                            resetButtonState();
                        }
                    })
                    .catch(ipcError => {
                        console.error('IPC Error while calling electronAPI.processAuthCode:', ipcError);
                        resetButtonState();
                    });
            } else {
                console.error('[LoginJS] electronAPI.processAuthCode is not available! Check preload.js.');
                resetButtonState();
                alert('계정 처리 기능을 사용할 수 없습니다. (Preload 스크립트 오류)');
            }
        }
    });
} else {
    console.error('[LoginJS] electronAPI.receiveLoginReply or MSFT constants from preload are not available! Login reply handling will not work.');
    if (!window.electronAPI) console.error("Reason: window.electronAPI is undefined.");
    else if (!window.electronAPI.receiveLoginReply) console.error("Reason: window.electronAPI.receiveLoginReply is undefined.");
    else if (!MSFT_REPLY_TYPE || !MSFT_ERROR) console.error("Reason: MSFT_REPLY_TYPE or MSFT_ERROR (from electronAPI.CONSTANTS) is undefined.");
    alert('로그인 응답 처리 기능을 초기화할 수 없습니다. (Preload 스크립트 오류)');
}