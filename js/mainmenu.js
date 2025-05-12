
// mainmenu.js

// DOM이 완전히 로드된 후 스크립트 실행
document.addEventListener('DOMContentLoaded', () => {
    console.log('[MainMenuJS] DOM fully loaded and parsed.');

    const closeBtn = document.getElementById('close-btn');

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

    // --- 다른 버튼들에 대한 이벤트 리스너 추가 (필요시) ---
    const settingsButton = document.getElementById('settingsButton');
    if (settingsButton) {
        settingsButton.addEventListener('click', () => {
            console.log('Settings button clicked');
            alert('게임 설정 기능은 아직 준비 중입니다.');
            // TODO: 설정 관련 IPC 호출 또는 로직 구현
            // 예: window.electronAPI.openSettingsWindow();
        });
    }

    const logoutButton = document.getElementById('logoutButton');
    if (logoutButton) {
        logoutButton.addEventListener('click', () => {
            console.log('Logout button clicked');
            alert('로그아웃 기능은 아직 준비 중입니다.');
            // TODO: 로그아웃 관련 IPC 호출 또는 로직 구현
            // 예: window.electronAPI.requestLogout(); -> login 화면으로 전환 등
        });
    }

    const launchGameButton = document.getElementById('launchGameButton');
    if (launchGameButton) {
        launchGameButton.addEventListener('click', () => {
            console.log('Launch game button clicked');
            alert('게임 시작 기능은 아직 준비 중입니다.');
            // TODO: 게임 시작 관련 IPC 호출 또는 로직 구현
            // 예: window.electronAPI.launchGame();
        });
    }
    // --- 다른 버튼 리스너 끝 ---

});

console.log('[MainMenuJS] Script loaded.');