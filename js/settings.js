      
// js/settings.js
function initializeSettings() {
    console.log('[SettingsJS] initializeSettings called. Setting up listeners and loading data...');

    // DOM 요소 가져오기
    const minMemoryInput = document.getElementById('min-memory-input');
    const minMemorySlider = document.getElementById('min-memory-slider');
    const minMemoryValueDisplay = document.getElementById('min-memory-value-display');
    const maxMemoryInput = document.getElementById('max-memory-input');
    const maxMemorySlider = document.getElementById('max-memory-slider');
    const maxMemoryValueDisplay = document.getElementById('max-memory-value-display');
    const resolutionWidthInput = document.getElementById('resolution-width-input');
    const resolutionHeightInput = document.getElementById('resolution-height-input');
    const fullscreenCheckbox = document.getElementById('fullscreen-checkbox');
    const allowPrereleaseCheckbox = document.getElementById('allow-prerelease-checkbox'); // 이전 코드에 있었음
    const saveSettingsButton = document.getElementById('saveSettingsButton');

    // --- 메모리 설정 UI 연동 함수 ---
    function setupMemoryControl(inputElement, sliderElement, displayElement) {
        if (!inputElement || !sliderElement || !displayElement) return;

        const updateMemoryDisplays = (value) => {
            const numericValue = parseInt(value);
            if (isNaN(numericValue)) return;
            inputElement.value = numericValue;
            sliderElement.value = numericValue;
            displayElement.textContent = `${numericValue} MB`;
        };

        inputElement.addEventListener('input', (e) => {
            updateMemoryDisplays(e.target.value);
            // 최소값이 최대값을 넘지 않도록, 최대값이 최소값보다 작아지지 않도록 하는 로직 추가 가능
            if (inputElement === minMemoryInput && parseInt(minMemoryInput.value) > parseInt(maxMemoryInput.value)) {
                updateMemoryDisplays(maxMemoryInput.value); // 최소를 최대로 맞춤 (또는 그 반대)
            }
            if (inputElement === maxMemoryInput && parseInt(maxMemoryInput.value) < parseInt(minMemoryInput.value)) {
                 updateMemoryDisplays(minMemoryInput.value); // 최대를 최소로 맞춤
            }
        });

        sliderElement.addEventListener('input', (e) => {
            updateMemoryDisplays(e.target.value);
            if (sliderElement === minMemorySlider && parseInt(minMemorySlider.value) > parseInt(maxMemorySlider.value)) {
                updateMemoryDisplays(maxMemorySlider.value);
            }
            if (sliderElement === maxMemorySlider && parseInt(maxMemorySlider.value) < parseInt(minMemorySlider.value)) {
                updateMemoryDisplays(minMemorySlider.value);
            }
        });
        // 초기 값으로 한 번 업데이트 (로드 후)
        // updateMemoryDisplays(inputElement.value); // loadCurrentSettings에서 처리
    }

    setupMemoryControl(minMemoryInput, minMemorySlider, minMemoryValueDisplay);
    setupMemoryControl(maxMemoryInput, maxMemorySlider, maxMemoryValueDisplay);

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
                if (minMemoryInput && settings.minMemoryMB) { // minMemoryMB 로드
                    minMemoryInput.value = settings.minMemoryMB;
                    if (minMemorySlider) minMemorySlider.value = settings.minMemoryMB;
                    if (minMemoryValueDisplay) minMemoryValueDisplay.textContent = `${settings.minMemoryMB} MB`;
                }
                if (maxMemoryInput && settings.maxMemoryMB) {
                    maxMemoryInput.value = settings.maxMemoryMB;
                    if (maxMemorySlider) maxMemorySlider.value = settings.maxMemoryMB;
                    if (maxMemoryValueDisplay) maxMemoryValueDisplay.textContent = `${settings.maxMemoryMB} MB`;
                }
                if (resolutionWidthInput && settings.resWidth) {
                    resolutionWidthInput.value = settings.resWidth;
                }
                if (resolutionHeightInput && settings.resHeight) {
                    resolutionHeightInput.value = settings.resHeight;
                }
                if (fullscreenCheckbox && typeof settings.fullscreen === 'boolean') {
                    fullscreenCheckbox.checked = settings.fullscreen;
                }
                if (allowPrereleaseCheckbox && typeof settings.allowPrerelease === 'boolean') {
                    allowPrereleaseCheckbox.checked = settings.allowPrerelease;
                }
            }
        } catch (error) {
            console.error('[SettingsJS] Error loading settings:', error);
            alert('설정 값을 불러오는 데 실패했습니다.');
        }
    }

    // --- 설정 값 저장 함수 ---
    async function saveAllSettings() {
        console.log('[SettingsJS] Saving settings...');
        if (!window.electronAPI || typeof window.electronAPI.saveLauncherSettings !== 'function') {
            console.error('[SettingsJS] electronAPI.saveLauncherSettings is not available.');
            alert('설정 저장 기능을 사용할 수 없습니다.');
            return;
        }

        const settingsToSave = {
            minMemoryMB: minMemoryInput ? parseInt(minMemoryInput.value) : 6144,
            maxMemoryMB: maxMemoryInput ? parseInt(maxMemoryInput.value) : 6144,
            resWidth: resolutionWidthInput ? parseInt(resolutionWidthInput.value) : 1920,
            resHeight: resolutionHeightInput ? parseInt(resolutionHeightInput.value) : 1080,
            fullscreen: fullscreenCheckbox ? fullscreenCheckbox.checked : false,
            allowPrerelease: allowPrereleaseCheckbox ? allowPrereleaseCheckbox.checked : false,
        };

        console.log('[SettingsJS] Settings to save:', settingsToSave);

        try {
            const result = await window.electronAPI.saveLauncherSettings(settingsToSave);
            if (result && result.success) {
                if (typeof switchToMainCallback === 'function') {
                    switchToMainCallback(); // 메인 메뉴로 돌아가는 콜백 함수 호출
                }
            } else {
                alert(`설정 저장 실패: ${result.error || '알 수 없는 오류'}`);
            }
        } catch (error) {
            console.error('[SettingsJS] Error saving settings:', error);
            alert(`설정 저장 중 오류 발생: ${error.message}`);
        }
    }

    if (saveSettingsButton) {
        saveSettingsButton.addEventListener('click', saveAllSettings);
    }

    loadCurrentSettings(); // 설정 화면 진입 시 현재 설정 값 로드
}

// mainmenu.js에서 호출할 수 있도록 함수가 로드된 후 실행될 수 있도록.
// 또는, settings-content.html이 로드된 후 특정 이벤트 발생 시 initializeSettings를 호출하도록 변경 가능
// 현재는 mainmenu.js에서 직접 호출하는 방식

    