// js/settings.js
function initializeSettings() {
    console.log('[SettingsJS] initializeSettings called. Setting up listeners and loading data...');

    // DOM 요소 가져오기
    const minMemoryInput = document.getElementById('min-memory-input');
    const minMemorySlider = document.getElementById('min-memory-slider');
    // const minMemoryValueDisplay = document.getElementById('min-memory-value-display'); // REMOVED: 이 ID를 가진 요소는 HTML에서 제거됨
    const maxMemoryInput = document.getElementById('max-memory-input');
    const maxMemorySlider = document.getElementById('max-memory-slider');
    // const maxMemoryValueDisplay = document.getElementById('max-memory-value-display'); // REMOVED: 이 ID를 가진 요소는 HTML에서 제거됨
    const resolutionWidthInput = document.getElementById('resolution-width-input');
    const resolutionHeightInput = document.getElementById('resolution-height-input');
    const fullscreenCheckbox = document.getElementById('fullscreen-checkbox');
    const saveSettingsButton = document.getElementById('saveSettingsButton');

    // --- 메모리 설정 UI 연동 함수 ---
    // displayElement 파라미터는 더 이상 필요 없음
    function setupMemoryControl(inputElement, sliderElement /*, displayElement - REMOVED */) {
        // displayElement 관련 null 체크 제거
        if (!inputElement || !sliderElement) return;

        const updateMemoryInputs = (value) => { // 함수명 변경: 이제 displayElement를 업데이트 하지 않음
            const numericValue = parseInt(value);
            if (isNaN(numericValue)) return;
            inputElement.value = numericValue;
            sliderElement.value = numericValue;
            // displayElement.textContent = `${numericValue} MB`; // REMOVED
        };

        inputElement.addEventListener('input', (e) => {
            updateMemoryInputs(e.target.value);
            if (inputElement === minMemoryInput && parseInt(minMemoryInput.value) > parseInt(maxMemoryInput.value)) {
                updateMemoryInputs(maxMemoryInput.value);
            }
            if (inputElement === maxMemoryInput && parseInt(maxMemoryInput.value) < parseInt(minMemoryInput.value)) {
                 updateMemoryInputs(minMemoryInput.value);
            }
        });

        sliderElement.addEventListener('input', (e) => {
            updateMemoryInputs(e.target.value);
            if (sliderElement === minMemorySlider && parseInt(minMemorySlider.value) > parseInt(maxMemorySlider.value)) {
                updateMemoryInputs(maxMemorySlider.value);
            }
            if (sliderElement === maxMemorySlider && parseInt(maxMemorySlider.value) < parseInt(minMemorySlider.value)) {
                updateMemoryInputs(minMemorySlider.value);
            }
        });
    }

    // displayElement 인자 없이 호출
    setupMemoryControl(minMemoryInput, minMemorySlider /*, minMemoryValueDisplay - REMOVED */);
    setupMemoryControl(maxMemoryInput, maxMemorySlider /*, maxMemoryValueDisplay - REMOVED */);

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
                if (minMemoryInput && settings.minMemoryMB) {
                    minMemoryInput.value = settings.minMemoryMB;
                    if (minMemorySlider) minMemorySlider.value = settings.minMemoryMB;
                    // if (minMemoryValueDisplay) minMemoryValueDisplay.textContent = `${settings.minMemoryMB} MB`; // REMOVED
                }
                if (maxMemoryInput && settings.maxMemoryMB) {
                    maxMemoryInput.value = settings.maxMemoryMB;
                    if (maxMemorySlider) maxMemorySlider.value = settings.maxMemoryMB;
                    // if (maxMemoryValueDisplay) maxMemoryValueDisplay.textContent = `${settings.maxMemoryMB} MB`; // REMOVED
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
            }
        } catch (error) {
            console.error('[SettingsJS] Error loading settings:', error);
            alert('설정 값을 불러오는 데 실패했습니다.');
        }
    }

    // --- 설정 값 저장 함수 ---
    async function saveAllSettings() {
        // (이 함수는 변경 없음)
        console.log('[SettingsJS] Saving settings...');
        if (!window.electronAPI || typeof window.electronAPI.saveLauncherSettings !== 'function') {
            console.error('[SettingsJS] electronAPI.saveLauncherSettings is not available.');
            alert('설정 저장 기능을 사용할 수 없습니다.');
            return;
        }

        const settingsToSave = {
            minMemoryMB: minMemoryInput ? parseInt(minMemoryInput.value) : 6144, // 기본값은 애플리케이션에 맞게 조정
            maxMemoryMB: maxMemoryInput ? parseInt(maxMemoryInput.value) : 6144, // 기본값은 애플리케이션에 맞게 조정
            resWidth: resolutionWidthInput ? parseInt(resolutionWidthInput.value) : 1920,
            resHeight: resolutionHeightInput ? parseInt(resolutionHeightInput.value) : 1080,
            fullscreen: fullscreenCheckbox ? fullscreenCheckbox.checked : false,
        };

        console.log('[SettingsJS] Settings to save:', settingsToSave);

          try {
            const result = await window.electronAPI.saveLauncherSettings(settingsToSave);
            // 저장 성공 여부와 관계없이 창을 닫거나, 성공 시에만 닫도록 선택 가능
            if (result && result.success) {
                console.log('[SettingsJS] Settings saved successfully.');
                // alert('설정이 저장되었습니다.'); // 성공 알림 (선택적)
            } else {
                console.error('[SettingsJS] Failed to save settings:', result ? result.error : 'Unknown error');
                alert(`설정 저장 실패: ${result && result.error ? result.error : '알 수 없는 오류'}`);
            }
        } catch (error) {
            console.error('[SettingsJS] Error saving settings via API:', error);
            alert(`설정 저장 중 오류 발생: ${error.message}`);
        } finally {
            // try-catch-finally 블록을 사용하여 성공/실패 여부와 관계없이 창 닫기
            if (typeof window.closeSettingsView === 'function') {
                window.closeSettingsView();
            } else {
                console.warn('[SettingsJS] window.closeSettingsView function is not available to close the settings view.');
                // 대체 방안: 직접 DOM 조작 (하지만 mainmenu.js의 로직과 중복될 수 있음)
                // const settingsView = document.getElementById('settings-view-placeholder');
                // const overlay = document.querySelector('.overlay');
                // if (settingsView) settingsView.classList.remove('visible');
                // if (overlay) overlay.classList.remove('visible');
            }
        }
    }

    if (saveSettingsButton) {
        saveSettingsButton.addEventListener('click', saveAllSettings);
    }

    loadCurrentSettings();
}


// mainmenu.js에서 호출할 수 있도록 함수가 로드된 후 실행될 수 있도록.
// 또는, settings-content.html이 로드된 후 특정 이벤트 발생 시 initializeSettings를 호출하도록 변경 가능
// 현재는 mainmenu.js에서 직접 호출하는 방식

    