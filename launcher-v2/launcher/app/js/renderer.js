
document.addEventListener('DOMContentLoaded', () => {
    // --- 요소 가져오기 ---
    const settingsButton = document.getElementById('settingsButton');
    const logoutButton = document.getElementById('logoutButton');
    const launchButton = document.getElementById('launchButton');
    const closeButton = document.getElementById('close-btn');

    const overlay = document.getElementById('overlay');
    const settingsView = document.getElementById('settings-view-placeholder');
    const progressModalOverlay = document.getElementById('progress-modal-overlay');

    // --- 이벤트 리스너 연결 ---
    settingsButton.addEventListener('click', showSettings);
    logoutButton.addEventListener('click', handleLogout);
    launchButton.addEventListener('click', handleLaunch);
    closeButton.addEventListener('click', () => window.electronAPI.closeWindow());

    // --- 함수 정의 ---

    // 설정 창 보이기
    async function showSettings() {
        // 이미 로드된 경우 다시 로드하지 않음
        if (settingsView.innerHTML.trim() === '') {
            try {
                // 'settings-content.html' 파일 내용을 가져와 삽입
                const response = await fetch('../settings-content.html');
                if (!response.ok) throw new Error('설정 파일을 불러올 수 없습니다.');
                const content = await response.text();
                settingsView.innerHTML = content;

                // 설정 창 내부의 닫기/저장 버튼에 이벤트 리스너 추가
                const closeSettingsButton = settingsView.querySelector('#closeSettingsButton'); // 닫기 버튼 ID가 있다고 가정
                const saveSettingsButton = settingsView.querySelector('#saveSettingsButton'); // 저장 버튼 ID

                if (closeSettingsButton) closeSettingsButton.addEventListener('click', hideSettings);
                if (saveSettingsButton) saveSettingsButton.addEventListener('click', () => {
                    console.log('설정 저장!');
                    // 여기에 실제 저장 로직 추가 (예: window.electronAPI.saveSettings(...))
                    hideSettings();
                });

            } catch (error) {
                console.error('설정 창 로드 실패:', error);
                settingsView.innerHTML = '<p>설정 창을 불러오는 데 실패했습니다.</p>';
            }
        }
        overlay.classList.add('visible');
        settingsView.classList.add('visible');
    }

    // 설정 창 숨기기
    function hideSettings() {
        overlay.classList.remove('visible');
        settingsView.classList.remove('visible');
    }
    
    // 오버레이 클릭 시 설정 창 닫기
    overlay.addEventListener('click', hideSettings);


    // 로그아웃 처리
    function handleLogout() {
        console.log('로그아웃 버튼 클릭');
        // main 프로세스에 로그아웃 요청
        window.electronAPI.logout();
    }

    // 게임 시작 처리
    function handleLaunch() {
        console.log('게임 시작 버튼 클릭');
        
        // 진행률 모달 보이기
        progressModalOverlay.classList.add('visible');
        const progressBar = document.getElementById('progress-bar');
        const progressMessage = document.getElementById('progress-modal-message');
        const progressDetails = document.getElementById('progress-modal-details');

        // (예시) 진행률 시뮬레이션
        let progress = 0;
        progressMessage.textContent = "업데이트 확인 중...";
        progressBar.style.width = '10%';

        setTimeout(() => {
            progressMessage.textContent = "파일 다운로드 중 (1/2)...";
            progressBar.style.width = '50%';
            progressDetails.textContent = "launcher.jar (25.3MB)";
        }, 1000);

        setTimeout(() => {
            progressMessage.textContent = "게임 파일 무결성 검사 중...";
            progressBar.style.width = '90%';
            progressDetails.textContent = "";
        }, 2500);
        
        setTimeout(() => {
            progressMessage.textContent = "게임 실행 준비 완료!";
            progressBar.style.width = '100%';
            // Main 프로세스에 실제 게임 실행 신호 보내기
            window.electronAPI.launchGame();

            // 잠시 후 모달 닫기
            setTimeout(() => {
                progressModalOverlay.classList.remove('visible');
            }, 1000);
        }, 3500);
    }
});