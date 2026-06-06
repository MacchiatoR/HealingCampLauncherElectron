function initializeSettings() {
    console.log('[SettingsJS] initializeSettings called. Setting up listeners and loading data...');

    // --- DOM 요소 가져오기 ---
    const minMemoryInput = document.getElementById('min-memory-input');
    const minMemorySlider = document.getElementById('min-memory-slider');
    const maxMemoryInput = document.getElementById('max-memory-input');
    const maxMemorySlider = document.getElementById('max-memory-slider');
    
    const resolutionWidthInput = document.getElementById('resolution-width-input');
    const resolutionHeightInput = document.getElementById('resolution-height-input');
    const fullscreenCheckbox = document.getElementById('fullscreen-checkbox');
    const saveSettingsButton = document.getElementById('saveSettingsButton');

    // --- 유효성 검사 및 UI 연동 로직 (개선된 부분) ---

    // 최소/최대 메모리 값이 서로를 넘지 않도록 보장하는 함수
    // changedElement: 현재 사용자가 조작하고 있는 컨트롤 (input 또는 slider)
    function validateMemoryValues(changedElement) {
        const minVal = parseInt(minMemoryInput.value);
        const maxVal = parseInt(maxMemoryInput.value);

        if (minVal > maxVal) {
            // 사용자가 '최소 메모리'를 조작하다가 최대값을 넘었을 경우
            if (changedElement === minMemoryInput || changedElement === minMemorySlider) {
                // 최대 메모리를 최소 메모리 값과 동일하게 맞춰줌
                maxMemoryInput.value = minVal;
                maxMemorySlider.value = minVal;
            } 
            // 사용자가 '최대 메모리'를 조작하다가 최소값보다 낮아졌을 경우
            else {
                // 최소 메모리를 최대 메모리 값과 동일하게 맞춰줌
                minMemoryInput.value = maxVal;
                minMemorySlider.value = maxVal;
            }
        }
    }

    // 최소 메모리 슬라이더 이벤트 리스너
    minMemorySlider.addEventListener('input', (event) => {
        // 1. 슬라이더 값을 텍스트 입력창에 즉시 반영
        minMemoryInput.value = event.target.value;
        // 2. 최소/최대 유효성 검사 실행
        validateMemoryValues(event.target);
    });

    // 최소 메모리 텍스트 입력 이벤트 리스너
    minMemoryInput.addEventListener('input', (event) => {
        // 1. 텍스트 입력창 값을 슬라이더에 즉시 반영
        minMemorySlider.value = event.target.value;
        // 2. 최소/최대 유효성 검사 실행
        validateMemoryValues(event.target);
    });

    // 최대 메모리 슬라이더 이벤트 리스너
    maxMemorySlider.addEventListener('input', (event) => {
        // 1. 슬라이더 값을 텍스트 입력창에 즉시 반영
        maxMemoryInput.value = event.target.value;
        // 2. 최소/최대 유효성 검사 실행
        validateMemoryValues(event.target);
    });

    // 최대 메모리 텍스트 입력 이벤트 리스너
    maxMemoryInput.addEventListener('input', (event) => {
        // 1. 텍스트 입력창 값을 슬라이더에 즉시 반영
        maxMemorySlider.value = event.target.value;
        // 2. 최소/최대 유효성 검사 실행
        validateMemoryValues(event.target);
    });

    
    // --- 설정 값 로드 함수 ---
    async function loadCurrentSettings() {
        console.log('[SettingsJS] Loading current settings...');
        if (!window.electronAPI || typeof window.electronAPI.getLauncherSettings !== 'function') {
            console.error('[SettingsJS] electronAPI.getLauncherSettings is not available.');
            return;
        }
        try {
            const settings = await window.electronAPI.getLauncherSettings();
            console.log('[SettingsJS] Received settings from main:', settings);
            if (settings) {
                // 최소/최대 메모리 값을 설정하고, 슬라이더에도 반영
                if (minMemoryInput && settings.minMemoryMB) {
                    minMemoryInput.value = settings.minMemoryMB;
                    minMemorySlider.value = settings.minMemoryMB;
                }
                if (maxMemoryInput && settings.maxMemoryMB) {
                    maxMemoryInput.value = settings.maxMemoryMB;
                    maxMemorySlider.value = settings.maxMemoryMB;
                }
                
                // 나머지 설정 값 로드
                if (resolutionWidthInput && settings.resWidth) {
                    resolutionWidthInput.value = settings.resWidth;
                }
                if (resolutionHeightInput && settings.resHeight) {
                    resolutionHeightInput.value = settings.resHeight;
                }
                if (fullscreenCheckbox && typeof settings.fullscreen === 'boolean') {
                    fullscreenCheckbox.checked = settings.fullscreen;
                }
            }
        } catch (error) {
            console.error('[SettingsJS] Error loading settings:', error);
            alert('설정 값을 불러오는 데 실패했습니다.');
        }
    }

    // --- 설정 값 저장 함수 (기존 코드와 동일) ---
    async function saveAllSettings() {
        console.log('[SettingsJS] Saving settings...');
        if (!window.electronAPI || typeof window.electronAPI.saveLauncherSettings !== 'function') {
            console.error('[SettingsJS] electronAPI.saveLauncherSettings is not available.');
            alert('설정 저장 기능을 사용할 수 없습니다.');
            return;
        }

        const settingsToSave = {
            minMemoryMB: parseInt(minMemoryInput.value) || 2048,
            maxMemoryMB: parseInt(maxMemoryInput.value) || 6144,
            resWidth: parseInt(resolutionWidthInput.value) || 1920,
            resHeight: parseInt(resolutionHeightInput.value) || 1080,
            fullscreen: fullscreenCheckbox.checked,
        };

        console.log('[SettingsJS] Settings to save:', settingsToSave);

        try {
            const result = await window.electronAPI.saveLauncherSettings(settingsToSave);
            if (result && result.success) {
                console.log('[SettingsJS] Settings saved successfully.');
            } else {
                console.error('[SettingsJS] Failed to save settings:', result ? result.error : 'Unknown error');
                alert(`설정 저장 실패: ${result && result.error ? result.error : '알 수 없는 오류'}`);
            }
        } catch (error) {
            console.error('[SettingsJS] Error saving settings via API:', error);
            alert(`설정 저장 중 오류 발생: ${error.message}`);
        } finally {
            if (typeof window.closeSettingsView === 'function') {
                window.closeSettingsView();
            } else {
                console.warn('[SettingsJS] window.closeSettingsView function is not available.');
            }
        }
    }

    if (saveSettingsButton) {
        saveSettingsButton.addEventListener('click', saveAllSettings);
    }

    // 페이지 로드 시 현재 설정 값 불러오기
    loadCurrentSettings();
}


    