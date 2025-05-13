
// mainmenu.js

// DOM이 완전히 로드된 후 스크립트 실행
document.addEventListener('DOMContentLoaded', () => {

    console.log('[MainMenuJS] DOM fully loaded and parsed.');
    const { MSFT_OPCODE, MSFT_REPLY_TYPE, MSFT_ERROR } = window.electronAPI?.CONSTANTS || {};
    const settingsButton = document.getElementById('settingsButton');
    const logoutButton = document.getElementById('logoutButton');
    const launchGameButton = document.getElementById('launchGameButton');
    const closeBtn = document.getElementById('close-btn');

    const mainMenuButtonsContainer = document.getElementById('mainMenuButtons');
    const backButtonContainer = document.getElementById('backButtonContainer');
    const backToMainButton = document.getElementById('backToMainButton');
    const dimmingOverlay = document.getElementById('dimming-overlay');
    const FADE_DURATION = 300;

    if (!MSFT_OPCODE) {
        console.error("[MainMenuJS] Critical error: MSFT_OPCODE constants not found via electronAPI.CONSTANTS. Logout functionality will be impaired.");
        // 사용자에게 심각한 오류 알림
        alert("런퍼에 필요한 설정을 불러오지 못했습니다. 앱을 재시작해주세요.");
        return; // 나머지 로직 실행 중단
    }

    if (closeBtn) {
        console.log('[MainMenuJS] Close button element found.');
        if (window.electronAPI && typeof window.electronAPI.requestCloseCurrentWindow === 'function') {
            closeBtn.addEventListener('click', () => {
                console.log('[MainMenuJS] Close button clicked. Requesting window close via electronAPI.');
                window.electronAPI.requestCloseCurrentWindow(); // Preload를 통해 노출된 함수 호출
            });
            console.log('[MainMenuJS] Close button click listener attached.');
        } else {
            console.error('[MainMenuJS] Close button found, but electronAPI.requestCloseCurrentWindow is not available. Check preload.js exposure and main process handler.');
            // 사용자에게 피드백 제공 (예: 버튼 비활성화 또는 alert)
            closeBtn.title = '닫기 기능을 사용할 수 없습니다.';
            closeBtn.style.cursor = 'not-allowed';
            // 또는 클릭 시 alert
            closeBtn.addEventListener('click', () => {
                 alert('닫기 기능을 초기화하지 못했습니다.');
            });
        }
    } else {
        console.error('[MainMenuJS] Close button element (#close-btn) not found.');
    }

    if (logoutButton) {
        logoutButton.addEventListener('click', async () => {
            console.log('Logout button clicked');
            if (!window.electronAPI ||
                typeof window.electronAPI.getSelectedAccount !== 'function' ||
                typeof window.electronAPI.sendMsftOpenLogout !== 'function') {
                console.error('[MainMenuJS] One or more required electronAPI functions for logout are not available.');
                alert('로그아웃 기능을 실행할 수 없습니다. (API 누락)');
                return;
            }

            logoutButton.disabled = true;
            logoutButton.textContent = '로그아웃 중...';

            try {
                const selectedAccount = await window.electronAPI.getSelectedAccount();

                if (selectedAccount && selectedAccount.uuid) {
                    console.log('[MainMenuJS] Selected account found:', selectedAccount.uuid, '. Requesting MS logout.');
                    // isLastAccount 인자 없이 호출
                    window.electronAPI.sendMsftOpenLogout(selectedAccount.uuid);
                    // 응답 처리는 receiveLogoutReply에서, 화면 전환은 main.js에서
                } else {
                    console.log('[MainMenuJS] No selected account or no accounts at all. Directly switching to login window.');
                    window.electronAPI.requestSwitchToLoginWindow();
                }
            } catch (error) {
                console.error('[MainMenuJS] Error during main logout process initiation:', error);
                alert(`로그아웃 처리 중 오류가 발생했습니다: ${error.message}`);
                // 오류 발생 시 버튼 상태 복구는 receiveLogoutReply에서도 처리될 수 있으나,
                // 여기서도 해주는 것이 안전할 수 있음. (단, 화면 전환이 이미 시작되었을 수 있음)
                if (logoutButton) {
                    logoutButton.disabled = false;
                    logoutButton.textContent = '로그아웃';
                }
            }
        });
    }

    // 메인 프로세스로부터 로그아웃 결과 수신 (MS 계정 로그아웃 후)
    if (window.electronAPI && typeof window.electronAPI.receiveLogoutReply === 'function') {
        console.log('[MainMenuJS] Setting up listener for MSFT_REPLY_LOGOUT.');
        window.electronAPI.receiveLogoutReply(async (replyType, uuid) => {
            const msftLogoutLogger = {
                info: (message, ...logArgs) => console.log(`[MSFT Logout Handler] ${message}`, ...logArgs),
                error: (message, ...logArgs) => console.error(`[MSFT Logout Handler] ${message}`, ...logArgs)
            };
            const mainLogoutButton = document.getElementById('logoutButton'); // 상단 로그아웃 버튼

            const resetButtonState = () => {
            if (mainLogoutButton) {
                mainLogoutButton.disabled = false;
                mainLogoutButton.textContent = '로그아웃'; // 원래 버튼 텍스트
            }

            if (replyType === MSFT_REPLY_TYPE.ERROR) {
                const errorData = uuid;
                msftLogoutLogger.error('MSFT Logout error reply:', errorData);
                alert(`Microsoft 로그아웃 중 오류 발생: ${errorData === MSFT_ERROR.NOT_FINISHED ? '사용자가 취소했습니다.' : errorData}`);
                resetButtonState(); 
                return;
            }

            if (replyType === MSFT_REPLY_TYPE.SUCCESS) {
                msftLogoutLogger.info(`MSFT Logout successful for UUID: ${uuid}. Main process is handling account removal and screen switch.`);
                alert(`계정(UUID: ${uuid})이 로그아웃되었습니다. 로그인 화면으로 이동합니다.`);
            }
        }});
    } else {
        console.error("[MainMenuJS] Critical error: electronAPI.receiveLogoutReply not available.");
    }

    if (launchGameButton) {
        launchGameButton.addEventListener('click', async () => {
            console.log('[MainMenuJS] Launch game button clicked');
            launchGameButton.disabled = true;
            launchGameButton.textContent = '게임 실행 중...';

            if (!window.electronAPI || typeof window.electronAPI.launchMinecraft !== 'function') {
                alert('게임 실행 기능을 사용할 수 없습니다. (API 누락)');
                launchGameButton.disabled = false;
                launchGameButton.textContent = '게임 시작';
                return;
            }

            try {
                const result = await window.electronAPI.launchMinecraft();
                if (result.success) {
                    alert(result.message); // 또는 다른 UI 피드백
                    // 게임 프로세스가 시작되었으므로, 버튼 텍스트는 그대로 두거나 변경할 수 있음
                    // launchGameButton.textContent = '게임 실행됨';
                } else {
                    alert(`게임 실행 실패: ${result.message}`);
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
    }

    // --- 화면 전환 함수 ---
    async function switchToView(viewToShowId, viewToHideId, showBackButton = false, showOverlay = false) {
        const viewToHide = viewToHideId ? document.getElementById(viewToHideId) : null;
        const viewToShow = viewToShowId ? document.getElementById(viewToShowId) : null;

        // 오버레이 제어
        if (dimmingOverlay) {
            if (showOverlay) {
                dimmingOverlay.style.pointerEvents = 'auto'; // 오버레이 보이면서 클릭 방지 해제 (선택적)
                dimmingOverlay.classList.add('visible');
            } else {
                dimmingOverlay.classList.remove('visible');
                // transition 후 pointer-events none으로 (CSS에서 처리 가능)
                setTimeout(() => {
                    if (!dimmingOverlay.classList.contains('visible')) { // 다시 visible되지 않았다면
                         dimmingOverlay.style.pointerEvents = 'none';
                    }
                }, FADE_DURATION);
            }
        }

        // 1. 현재 뷰 페이드 아웃
        if (viewToHide) {
            viewToHide.classList.remove('visible');
            await new Promise(resolve => setTimeout(resolve, FADE_DURATION));
            viewToHide.style.display = 'none';
        }

        // 2. 버튼 상태 변경 (이전과 동일)
        if (mainMenuButtonsContainer && backButtonContainer) { /* ... */ }

        // 3. 새 뷰 표시 및 페이드 인
        if (viewToShow) {
            viewToShow.style.display = viewToShowId === 'settings-view-placeholder' ? 'block' : 'flex'; // settings-placeholder는 block으로 (내부 container가 fixed)
            await new Promise(resolve => requestAnimationFrame(resolve)); // reflow
            viewToShow.classList.add('visible');
        }
    }

    // --- 설정 버튼 클릭 이벤트 ---
    if (settingsButton) {
        settingsButton.addEventListener('click', async () => {
            console.log('Settings button clicked. Switching to settings view...');

            // mainMenuView와 settingsViewPlaceholder의 ID를 직접 사용
            await switchToView(null, 'main-menu-view', true, true);

            const settingsPlaceholderElement = document.getElementById('settings-view-placeholder'); // 여기서 다시 가져옴
            if (!settingsPlaceholderElement) {
                console.error('settings-view-placeholder element not found!');
                return;
            }

            try {
                const response = await fetch('./settings-content.html'); // 경로 확인!
                if (!response.ok) {
                    throw new Error(`Failed to load settings content: ${response.statusText}`);
                }
                const settingsHtml = await response.text();
                settingsPlaceholderElement.innerHTML = settingsHtml;

                // 설정 화면 콘텐츠 로드 후 표시
                await switchToView('settings-view-placeholder', null, true);

                if (typeof initializeSettings === "function") {
                    initializeSettings();
                } else {
                    console.warn('initializeSettings function not found.');
                    bindBasicSettingsEvents();
                }

            } catch (error) {
                console.error('Error loading or switching to settings view:', error);
                alert('설정 화면을 불러오는 데 실패했습니다.');
                // 오류 발생 시 메인 메뉴로 복구
                await switchToView('main-menu-view', 'settings-view-placeholder', false);
            }
        });
    }

    // --- 돌아가기 버튼 클릭 이벤트 ---
    if (backToMainButton) {
        backToMainButton.addEventListener('click', async () => { // async 추가
            console.log('Back to main menu button clicked.');
            await switchToView('main-menu-view', 'settings-view-placeholder', false);
            const settingsPlaceholderElement = document.getElementById('settings-view-placeholder');
            // if (settingsPlaceholderElement) settingsPlaceholderElement.innerHTML = ''; // 내용 비우기 (선택 사항)
        });
    }

    // --- 설정 화면의 기본 이벤트 바인딩 (settings.js가 없을 경우 대비) ---
    function bindBasicSettingsEvents() {
        const memorySlider = document.getElementById('memory-slider');
        const memoryValueSpan = document.getElementById('memory-value');
        if (memorySlider && memoryValueSpan) {
            memorySlider.addEventListener('input', () => {
                memoryValueSpan.textContent = `${memorySlider.value} MB`;
            });
            // TODO: ConfigManager에서 현재 값 로드하여 슬라이더 초기값 설정
            // 예: if(window.electronAPI && window.electronAPI.getConfigValue) {
            //          window.electronAPI.getConfigValue('game.maxMemoryMB').then(val => {
            //              if(val) memorySlider.value = val; memoryValueSpan.textContent = `${val} MB`;
            //          });
            //      }
        }

        const saveSettingsButton = document.getElementById('saveSettingsButton');
         if(saveSettingsButton) {
             saveSettingsButton.addEventListener('click', () => {
                 console.log('Save settings button clicked.');
                 // TODO: 설정 값 가져와서 ConfigManager 통해 저장하는 IPC 호출
                 // 예: const newMaxMemory = document.getElementById('memory-slider').value;
                 //     if(window.electronAPI && window.electronAPI.setConfigValue) {
                 //         window.electronAPI.setConfigValue('game.maxMemoryMB', newMaxMemory)
                 //             .then(() => alert('설정이 저장되었습니다.'))
                 //             .catch(err => alert(`설정 저장 실패: ${err.message}`));
                 //     }
                 alert('설정 저장 기능은 아직 준비 중입니다.');
             });
         }
         // 다른 설정 항목에 대한 이벤트 리스너 및 값 로드/저장 로직 추가...
    }

    // 초기 뷰 설정 (DOMContentLoaded 마지막)
    const initialMainMenuView = document.getElementById('main-menu-view');
    if (initialMainMenuView) {
        initialMainMenuView.classList.add('visible'); // 처음에는 메인 메뉴만 보이게
    }
    const initialSettingsView = document.getElementById('settings-view-placeholder');
    if (initialSettingsView) {
        initialSettingsView.classList.remove('visible'); // 처음에는 설정 메뉴 숨김
    }
});


console.log('[MainMenuJS] Script loaded.');