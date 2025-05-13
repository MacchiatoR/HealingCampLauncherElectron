// mainmenu.js

document.addEventListener('DOMContentLoaded', () => {
    console.log('[MainMenuJS] DOM fully loaded and parsed.');

    const electronAPI = window.electronAPI;
    const CONSTANTS = electronAPI?.CONSTANTS || {};
    const { MSFT_OPCODE, MSFT_REPLY_TYPE, MSFT_ERROR } = CONSTANTS;

    if (!MSFT_OPCODE || !MSFT_REPLY_TYPE || !MSFT_ERROR) {
        console.error("[MainMenuJS] Critical error: MSFT constants not found or incomplete via electronAPI.CONSTANTS. Functionality will be impaired.");
        alert("런처 실행에 필요한 설정을 불러오지 못했습니다. 앱을 재시작해주세요.");
        return;
    }

    const settingsButton = document.getElementById('settingsButton');
    const logoutButton = document.getElementById('logoutButton');
    const launchGameButton = document.getElementById('launchGameButton');
    const closeBtn = document.getElementById('close-btn');
    const settingsViewPlaceholder = document.getElementById('settings-view-placeholder');
    const overlay = document.querySelector('.overlay');

    const FADE_DURATION = 300;

    // --- 창 닫기 버튼 이벤트 ---
    if (closeBtn) {
        if (electronAPI && typeof electronAPI.requestCloseCurrentWindow === 'function') {
            closeBtn.addEventListener('click', () => {
                console.log('[MainMenuJS] Close button clicked. Requesting window close.');
                electronAPI.requestCloseCurrentWindow();
            });
        } else {
            console.error('[MainMenuJS] electronAPI.requestCloseCurrentWindow is not available.');
            closeBtn.title = '닫기 기능을 사용할 수 없습니다.';
            closeBtn.style.cursor = 'not-allowed';
            closeBtn.addEventListener('click', () => alert('닫기 기능을 초기화하지 못했습니다.'));
        }
    } else {
        console.error('[MainMenuJS] Close button element (#close-btn) not found.');
    }

    // --- 로그아웃 버튼 이벤트 ---
    if (logoutButton) {
        logoutButton.addEventListener('click', async () => {
            console.log('[MainMenuJS] Logout button clicked.');
            if (!electronAPI || typeof electronAPI.getSelectedAccount !== 'function' || typeof electronAPI.sendMsftOpenLogout !== 'function' || typeof electronAPI.requestSwitchToLoginWindow !== 'function') {
                console.error('[MainMenuJS] Required electronAPI functions for logout are not available.');
                alert('로그아웃 기능을 실행할 수 없습니다. (API 누락)');
                return;
            }
            logoutButton.disabled = true;
            logoutButton.textContent = '로그아웃 중...';
            try {
                const selectedAccount = await electronAPI.getSelectedAccount();
                if (selectedAccount && selectedAccount.uuid) {
                    electronAPI.sendMsftOpenLogout(selectedAccount.uuid);
                } else {
                    electronAPI.requestSwitchToLoginWindow();
                }
            } catch (error) {
                console.error('[MainMenuJS] Error during logout process initiation:', error);
                alert(`로그아웃 처리 중 오류가 발생했습니다: ${error.message}`);
                logoutButton.disabled = false;
                logoutButton.textContent = '로그아웃';
            }
        });
    } else {
        console.error('[MainMenuJS] Logout button element (#logoutButton) not found.');
    }

    // --- MS 로그아웃 결과 수신 리스너 ---
    if (electronAPI && typeof electronAPI.receiveLogoutReply === 'function') {
        electronAPI.receiveLogoutReply((replyType, data) => {
            console.log(`[MainMenuJS] Received MSFT_REPLY_LOGOUT - Type: ${replyType}, Data:`, data);
            const mainLogoutButton = document.getElementById('logoutButton');
            const resetButtonState = () => {
                if (mainLogoutButton) {
                    mainLogoutButton.disabled = false;
                    mainLogoutButton.textContent = '로그아웃';
                }
            };
            if (replyType === MSFT_REPLY_TYPE.ERROR) {
                alert(`Microsoft 로그아웃 중 오류 발생: ${data === MSFT_ERROR.NOT_FINISHED ? '사용자가 취소했습니다.' : (data.message || data)}`);
                resetButtonState();
            } else if (replyType === MSFT_REPLY_TYPE.SUCCESS) {
                // 로그인 창으로 전환은 메인 프로세스에서 처리
            } else {
                resetButtonState();
            }
        });
    } else {
        console.error("[MainMenuJS] Critical error: electronAPI.receiveLogoutReply not available.");
    }

    // --- 게임 실행 버튼 이벤트 ---
    if (launchGameButton) {
        launchGameButton.addEventListener('click', async () => {
            console.log('[MainMenuJS] Launch game button clicked.');
            if (!electronAPI || typeof electronAPI.launchMinecraft !== 'function') {
                alert('게임 실행 기능을 사용할 수 없습니다. (API 누락)');
                return;
            }
            launchGameButton.disabled = true;
            launchGameButton.textContent = '게임 실행 중...';
            try {
                const result = await electronAPI.launchMinecraft();
                if (result && result.success) {
                    console.log('[MainMenuJS] Game launch successful:', result.message);
                } else {
                    alert(`게임 실행 실패: ${result.message || '알 수 없는 오류'}`);
                    launchGameButton.disabled = false;
                    launchGameButton.textContent = '게임 시작';
                }
            } catch (error) {
                console.error('[MainMenuJS] Error calling launchMinecraft API:', error);
                alert(`게임 실행 중 오류 발생: ${error.message}`);
                launchGameButton.disabled = false;
                launchGameButton.textContent = '게임 시작';
            }
        });
    } else {
        console.error('[MainMenuJS] Launch game button element (#launchGameButton) not found.');
    }

    // --- 화면(뷰) 전환 및 오버레이 관리 함수 ---
    function manageViewAndOverlay(viewElement, show = false, showOverlay = false) {
        console.log(`[MainMenuJS - manageViewAndOverlay] Target: ${viewElement ? viewElement.id : 'overlay only'}, Show: ${show}, ShowOverlay: ${showOverlay}`);

        if (overlay) {
            if (showOverlay) {
                overlay.style.pointerEvents = 'auto';
                overlay.classList.add('visible');
            } else {
                overlay.classList.remove('visible');
                setTimeout(() => {
                    if (!overlay.classList.contains('visible')) {
                        overlay.style.pointerEvents = 'none';
                    }
                }, FADE_DURATION);
            }
        }

        if (viewElement) {
            if (show) {
                viewElement.style.display = 'flex'; // 모든 view-content는 flex로 중앙 정렬
                requestAnimationFrame(() => { // 다음 프레임에서 class 추가하여 transition 활성화
                    viewElement.classList.add('visible');
                });
            } else {
                viewElement.classList.remove('visible');
                setTimeout(() => {
                    if (!viewElement.classList.contains('visible')) {
                        viewElement.style.display = 'none';
                    }
                }, FADE_DURATION);
            }
        }
    }

    // --- 설정 창 닫기 함수 (settings.js에서 호출용) ---
    window.closeSettingsView = () => {
        console.log('[MainMenuJS] Global closeSettingsView called.');
        if (settingsViewPlaceholder && settingsViewPlaceholder.classList.contains('visible')) {
            manageViewAndOverlay(settingsViewPlaceholder, false, false); // 설정창 숨김, 오버레이 숨김
        }
    };

    // --- 설정 버튼 클릭 이벤트 ---
    if (settingsButton && settingsViewPlaceholder && overlay) {
        settingsButton.addEventListener('click', async () => {
            console.log('[MainMenuJS] Settings button clicked.');

            if (settingsViewPlaceholder.innerHTML.trim() === '' || settingsViewPlaceholder.firstElementChild?.id !== 'settings-view-content') {
                try {
                    console.log('[MainMenuJS] Fetching settings-content.html...');
                    const response = await fetch('./settings-content.html');
                    if (!response.ok) throw new Error(`Failed to load: ${response.statusText}`);
                    settingsViewPlaceholder.innerHTML = await response.text();
                    console.log('[MainMenuJS] settings-content.html loaded.');
                    if (typeof initializeSettings === "function") initializeSettings();
                    else console.warn('[MainMenuJS] initializeSettings function not defined.');
                } catch (error) {
                    console.error('[MainMenuJS] Error loading settings-content.html:', error);
                    alert('설정 화면을 불러오는 데 실패했습니다.');
                    return;
                }
            } else {
                console.log('[MainMenuJS] settings-content.html already loaded.');
                 if (typeof initializeSettings === "function") initializeSettings(); // 값 새로고침 등을 위해 재호출
            }
            manageViewAndOverlay(settingsViewPlaceholder, true, true); // 설정창 보임, 오버레이 보임
        });
    } else {
        console.error('[MainMenuJS] Settings button, placeholder, or overlay missing. Settings disabled.');
    }

    // --- 오버레이 클릭 시 설정 창 닫기 ---
    if (overlay && settingsViewPlaceholder) {
        overlay.addEventListener('click', (event) => {
            if (event.target === overlay && settingsViewPlaceholder.classList.contains('visible')) {
                console.log('[MainMenuJS] Overlay clicked. Closing settings view.');
                window.closeSettingsView(); // 전역 닫기 함수 호출
            }
        });
    }

    // --- 초기 뷰 상태 ---
    if (settingsViewPlaceholder) {
        settingsViewPlaceholder.classList.remove('visible');
        settingsViewPlaceholder.style.display = 'none';
    }
    if (overlay) {
        overlay.classList.remove('visible');
        overlay.style.pointerEvents = 'none';
    }

    console.log('[MainMenuJS] Main menu setup complete.');
});