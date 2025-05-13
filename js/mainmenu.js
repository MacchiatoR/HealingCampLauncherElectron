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

    // --- 진행률 모달 DOM 요소 ---
    const progressModalOverlay = document.getElementById('progress-modal-overlay');
    const progressModalTitle = document.getElementById('progress-modal-title');
    const progressModalMessage = document.getElementById('progress-modal-message');
    const progressBar = document.getElementById('progress-bar');
    const progressModalDetails = document.getElementById('progress-modal-details');

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

    // --- 모달 관리 ---
    let titleAnimationInterval = null; // 타이틀 애니메이션 인터벌 ID
    let closeModalCountdownInterval = null; // 모달 닫기 카운트다운 인터벌 ID

    function stopTitleAnimation() {
        if (titleAnimationInterval) {
            clearInterval(titleAnimationInterval);
            titleAnimationInterval = null;
        }
    }

    function startTitleAnimation(baseTitle = "게임 실행 준비 중") {
        stopTitleAnimation(); // 기존 애니메이션 중지
        let dots = 0;
        const maxDots = 3;
        if (progressModalTitle) {
            progressModalTitle.textContent = baseTitle; // 초기 텍스트 (점 없음)
            titleAnimationInterval = setInterval(() => {
                dots = (dots + 1) % (maxDots + 1); // 0, 1, 2, 3 반복 (0은 점 없음)
                let animatedTitle = baseTitle;
                for (let i = 0; i < dots; i++) {
                    animatedTitle += ".";
                }
                progressModalTitle.textContent = animatedTitle;
            }, 2000); // 0.5초마다 점 변경
        }
    }

    function showProgressModal(show = true) {
        if (progressModalOverlay) {
            if (show) {
                progressModalOverlay.classList.add('visible');
            } else {
                progressModalOverlay.classList.remove('visible');
                stopTitleAnimation();
                if (closeModalCountdownInterval) { // 카운트다운 중지
                    clearInterval(closeModalCountdownInterval);
                    closeModalCountdownInterval = null;
                }
            }
        }
    }

    function updateProgressModal({ title, message, progress, details, isError = false, isWarning = false }) {
        // ... (이전 updateProgressModal 로직과 거의 동일, 오류 시 타이틀 변경 부분은 onLaunchProgressComplete에서 처리 가능)
        if (progressModalMessage && message) progressModalMessage.textContent = message;
        if (progressBar && typeof progress === 'number') {
            progressBar.style.width = `${Math.max(0, Math.min(100, progress))}%`;
            if (isError) {
                progressBar.style.backgroundColor = 'var(--text-primary)';
                // stopTitleAnimation(); // 애니메이션 중지는 showProgressModal(false) 또는 complete 핸들러에서
            } else if (isWarning) {
                progressBar.style.backgroundColor = 'orange';
            } else {
                progressBar.style.backgroundColor = 'var(--launch-button-bg)';
            }
        }
        if (progressModalDetails && details !== undefined) { // details가 명시적으로 제공될 때만 업데이트
            progressModalDetails.textContent = details;
        }
    }


    // --- 게임 실행 버튼 이벤트 ---
    if (launchGameButton) {
        launchGameButton.addEventListener('click', async () => {
            // ... (리스너 등록 및 실행 요청 부분은 이전과 동일) ...
            console.log('[MainMenuJS] Launch game button clicked, invoking main process.');
            launchGameButton.disabled = true;
            launchGameButton.textContent = '실행 준비 중...';

            window.electronAPI.removeLaunchProgressListeners();

            window.electronAPI.onLaunchProgressStart((data) => {
                console.log('[MainMenuJS] IPC launch-progress-start:', data);
                if (closeModalCountdownInterval) clearInterval(closeModalCountdownInterval); // 이전 카운트다운 중지
                startTitleAnimation(data.title || "게임 실행 준비 중");
                updateProgressModal({ message: '초기화 중...', progress: 0, details: '' }); // 상세 정보 초기화
                showProgressModal(true);
            });

            window.electronAPI.onLaunchProgressUpdate((data) => {
                console.log('[MainMenuJS] IPC launch-progress-update:', data);
                updateProgressModal(data);
            });

            window.electronAPI.onLaunchProgressComplete(async (data) => {
                console.log('[MainMenuJS] IPC launch-progress-complete:', data);
                stopTitleAnimation();
                updateProgressModal(data); // 최종 메시지 (성공 또는 실패 메시지)

                if (data.success) {
                    if (progressModalTitle) progressModalTitle.textContent = "성공";
                    if (progressModalMessage) progressModalMessage.textContent = data.message;
                    setTimeout(() => {
                        showProgressModal(false);
                        launchGameButton.disabled = false;
                        launchGameButton.textContent = '게임 실행됨';
                    }, 2000);
                } else {
                    // 실패 시 카운트다운 시작
                    if (progressModalTitle) progressModalTitle.textContent = "오류 발생";
                    if (progressModalMessage) progressModalMessage.textContent = data.message; // launch.js에서 온 displayMessage

                    let countdown = 3;
                    if (progressModalDetails) {
                        progressModalDetails.textContent = `실패: ${countdown}초 후 자동으로 창이 닫힙니다.`;
                    }

                    if (closeModalCountdownInterval) clearInterval(closeModalCountdownInterval); // 만약을 위해 이전 인터벌 정리
                    closeModalCountdownInterval = setInterval(() => {
                        countdown--;
                        if (progressModalDetails) {
                            progressModalDetails.textContent = `실패: ${countdown}초 후 자동으로 창이 닫힙니다.`;
                        }
                        if (countdown <= 0) {
                            clearInterval(closeModalCountdownInterval);
                            closeModalCountdownInterval = null;
                            showProgressModal(false);
                            launchGameButton.disabled = false;
                            launchGameButton.textContent = '게임 시작';
                        }
                    }, 1000); // 1초마다 실행
                }
                window.electronAPI.removeLaunchProgressListeners();
            });

            try {
                await window.electronAPI.launchMinecraft();
            } catch (error) {
                console.error('[MainMenuJS] Error invoking launchMinecraft in main process:', error);
                stopTitleAnimation();
                if (closeModalCountdownInterval) clearInterval(closeModalCountdownInterval);

                updateProgressModal({ title:"런처 오류", message: '런처 오류로 실행에 실패했습니다.', progress: -1, isError: true, details: '3초 후 자동으로 창이 닫힙니다.' });
                // showProgressModal(true); // 이미 떠 있을 수 있음

                let countdown = 3;
                // 위 updateProgressModal에서 details가 이미 설정되었으므로, 바로 인터벌 시작
                closeModalCountdownInterval = setInterval(() => {
                    countdown--;
                     if (progressModalDetails) {
                        progressModalDetails.textContent = `실패: ${countdown}초 후 자동으로 창이 닫힙니다.`;
                    }
                    if (countdown <= 0) {
                        clearInterval(closeModalCountdownInterval);
                        closeModalCountdownInterval = null;
                        showProgressModal(false);
                        launchGameButton.disabled = false;
                        launchGameButton.textContent = '게임 시작';
                    }
                }, 1000);
                window.electronAPI.removeLaunchProgressListeners();
            }
        });
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