
// launch.js (또는 main.js의 일부)
const { launch, Version, diagnose, LaunchOption, MinecraftFolder } = require('@xmcl/core');
const {
    installTask,
    installForgeTask,
    installDependenciesTask,
    getVersionList,
    getPotentialJavaLocations, 
    resolveJava,               
} = require('@xmcl/installer');
const path = require('path');
const fs = require('fs-extra');
const { app } = require('electron');
const axios = require('axios'); // HTTP 요청용
const AdmZip = require('adm-zip'); // ZIP 압축 해제

const ConfigManager = require('./confighandler'); // 가정: ConfigManager는 별도로 존재
const AuthHandler = require('./authhandler');   // 가정: AuthHandler는 별도로 존재 (토큰 갱신 등)
const { ipcMain, BrowserWindow } = require('electron');

const log = {
    info: (message, ...args) => console.log(`[GameLauncher] [INFO] ${new Date().toISOString()} ${message}`, ...args),
    error: (message, ...args) => console.error(`[GameLauncher] [ERROR] ${new Date().toISOString()} ${message}`, ...args),
    warn: (message, ...args) => console.warn(`[GameLauncher] [WARN] ${new Date().toISOString()} ${message}`, ...args),
};

// --- 설정 ---
const MINECRAFT_VERSION_TARGET = '1.20.1';
const FORGE_MC_VERSION = '1.20.1';
const FORGE_BUILD_VERSION = '47.4.0';
const MINECRAFT_ROOT_PATH = path.join(app.getPath('appData'), '.instance_HealingcampLauncher'); // 데이터 저장 경로
let JAVA_PATH_CACHE = undefined; 

// --- 리소스 업데이트 설정 ---
const RESOURCE_VERSION_URL = 'https://www.dropbox.com/scl/fi/pl5l3q11squqmmqjsidqd/version_NarangNorang.txt?rlkey=2uycyf890dlgrzt8mlu5urglf&st=u75kw5s9&dl=1'; // 예: https://example.com/game_resources/version.txt
const RESOURCE_ZIP_URL = 'https://www.dropbox.com/scl/fi/82r85440eqvujtlt277ft/narangnorang.zip?rlkey=0if3jj6qqhlgb97thy0neev1g&st=gx4fmm4t&dl=1';         // 예: https://example.com/game_resources/latest_resources.zip
const LOCAL_VERSION_FILE_NAME = 'resource_version.txt'; // 실행 폴더 내 버전 파일명


// --- 다운로드 옵션 ---
const DOWNLOAD_TIMEOUT = 10000; // 10초 타임아웃

// --- Minecraft 루트 경로 지연 초기화 및 원하는 경로로 설정 ---
let minecraftRootPathSingleton = null;
function getMinecraftRootPath() {
    if (!minecraftRootPathSingleton) {
        minecraftRootPathSingleton = path.join(app.getPath('appData'), '.instance_HealingcampLauncher'); // 리소스 전용 폴더 또는 기존 게임 폴더
        log.info(`Resource/Game root path initialized to: ${minecraftRootPathSingleton}`);
        fs.ensureDirSync(minecraftRootPathSingleton);
    }
    return minecraftRootPathSingleton;
}

/**
 * Task 실행 및 진행률 로깅을 위한 헬퍼 함수
 * @param {import('@xmcl/task').Task<any>} taskInstance 실행할 xmcl Task 객체
 * @param {string} taskDescription 로깅을 위한 작업 설명
 * @returns {Promise<any>} Task의 결과값
 */
async function runTaskWithProgress(taskInstance, taskDescription) {
    log.info(`Starting task: ${taskDescription} (Path: ${taskInstance.path || 'N/A'})`);
    let lastLoggedProgress = -1; // 마지막으로 로그된 진행률 (너무 잦은 로그 방지용)

    try {
        const result = await taskInstance.startAndWait({
            onStart(task) {
                log.info(` -> Sub-task started: ${task.name || 'Unnamed Subtask'} (Path: ${task.path})`);
            },
            onUpdate(task, chunkSize) {
                const rootProgress = Math.round((taskInstance.progress / taskInstance.total) * 100);
                if (taskInstance.total > 0 && rootProgress % 10 === 0 && rootProgress !== lastLoggedProgress) {
                    log.info(` -> Overall task [${taskDescription}] progress: ${rootProgress}% (${taskInstance.progress} / ${taskInstance.total})`);
                    lastLoggedProgress = rootProgress;
                }
            },
            onFailed(task, error) {
                log.error(` -> Sub-task failed: ${task.name || 'Unnamed Subtask'} (Path: ${task.path})`, error);
            },
            onSucceed(task, taskResult) {
                log.info(` -> Sub-task succeeded: ${task.name || 'Unnamed Subtask'} (Path: ${task.path})`);
            },
        });
        log.info(`Task completed: ${taskDescription}`);
        return result; // Task의 최종 결과 반환
    } catch (error) {
        log.error(`Error during task execution [${taskDescription}]:`, error);
        throw error; // 오류를 다시 던져 상위에서 처리하도록 함
    }
}

/**
 * 적절한 Java 경로를 찾거나 확인합니다.
 * @param {MinecraftFolder} minecraftLocation 마인크래프트 폴더 객체
 * @returns {Promise<string>} Java 실행 파일 경로
 */
async function ensureJavaPath(minecraftLocation) {
    if (JAVA_PATH_CACHE && fs.existsSync(JAVA_PATH_CACHE)) {
        log.info(`Using cached Java path: ${JAVA_PATH_CACHE}`);
        return JAVA_PATH_CACHE;
    }

    log.info('Attempting to find suitable Java installation using @xmcl/installer...');
    try {
        // 방법 1: 잠재적 위치 스캔 후 첫 번째 유효한 Java 사용
        const potentialLocations = await getPotentialJavaLocations();
        log.info('Potential Java locations found:', potentialLocations);

        if (potentialLocations && potentialLocations.length > 0) {
            for (const loc of potentialLocations) {
                try {
                    const javaInfo = await resolveJava(loc); // 실행 파일 경로를 직접 받음
                    if (javaInfo && javaInfo.path && javaInfo.version) { // javaInfo.version으로 버전도 확인 가능
                        // 마인크래프트 1.20.1은 Java 17 이상 필요
                        const majorVersion = parseInt(javaInfo.version.split('.')[0]);
                        if (majorVersion >= 17) {
                            JAVA_PATH_CACHE = javaInfo.path;
                            log.info(`Found suitable Java at: ${JAVA_PATH_CACHE} (Version: ${javaInfo.version}, Major: ${majorVersion})`);
                            return JAVA_PATH_CACHE;
                        } else {
                            log.warn(`Found Java at ${loc} but version ${javaInfo.version} (Major: ${majorVersion}) is less than 17.`);
                        }
                    }
                } catch (resolveError) {
                    log.warn(`Could not resolve Java at potential location ${loc}:`, resolveError.message);
                }
            }
        }

        throw new Error("Suitable Java installation (Version 17+) not found automatically.");

    } catch (e) {
        log.error("Error finding Java:", e);
        // 사용자에게 Java 설치 경로를 수동으로 입력받는 UI를 제공하거나,
        // Mojang JRE 설치 기능을 사용하는 것을 고려할 수 있음.
        // await installJreFromMojang(...)
        throw new Error("Could not find a suitable Java 17+ installation. Please install Java 17 or higher and ensure it's in your PATH, or configure the Java path manually.");
    }
}

/**
 * 마인크래프트 및 포지 설치/확인
 * @param {string} targetMcVersion 바닐라 마인크래프트 버전
 * @param {string} targetForgeMcVersion 포지가 대상하는 마인크래프트 버전 (예: "1.20.1")
 * @param {string} targetForgeBuild 포지 빌드 번호 (예: "47.2.0")
 * @returns {Promise<string>} 실행할 최종 버전 ID
 */
async function ensureMinecraftAndForgeInstalled(targetMcVersion, targetForgeMcVersion, targetForgeBuild) {
    const mcRoot = getMinecraftRootPath();
    log.info(`Ensuring Minecraft ${targetMcVersion} ${targetForgeBuild ? `with Forge (MC: ${targetForgeMcVersion}, ForgeBuild: ${targetForgeBuild})` : ''} is installed at ${mcRoot}...`);
    const minecraftLocation = new MinecraftFolder(mcRoot);
    // await fs.ensureDir(minecraftLocation.root); // getMinecraftRootPath에서 처리

    const currentJavaPath = await ensureJavaPath(minecraftLocation);

    // --- 공통 설치 옵션 (타임아웃 포함) ---
    // DownloadOptions 또는 AssetsOptions 또는 InstallOptions 등에 timeout이 있을 것으로 예상
    // @xmcl/installer의 Options 타입들을 확인하여 정확한 구조 파악 필요
    // 여기서는 InstallOptions에 timeout이 있다고 가정하고, 다른 옵션들도 포함할 수 있음
    const commonInstallOptions = {
        side: 'client', // installTask, installDependenciesTask 공통
        timeout: DOWNLOAD_TIMEOUT, // <<--- 타임아웃 설정 추가
        retries: 3, // 재시도 횟수
    };
    log.info('Using common install options:', commonInstallOptions);


    // 1. 바닐라 마인크래프트 설치
    const versionList = await getVersionList();
    const vanillaVersionMeta = versionList.versions.find(v => v.id === targetMcVersion);
    if (!vanillaVersionMeta) throw new Error(`Vanilla Minecraft version metadata for ${targetMcVersion} not found.`);
    log.info(`Checking/Installing Vanilla Minecraft ${targetMcVersion}...`);
    // installTask의 세 번째 인자 options에 commonInstallOptions 전달
    const vanillaInstallOp = installTask(vanillaVersionMeta, minecraftLocation, commonInstallOptions);
    const resolvedVanillaVersion = await runTaskWithProgress(vanillaInstallOp, `바닐라 (${targetMcVersion}) 설치`, 'install-vanilla');
    log.info(`Vanilla Minecraft ${targetMcVersion} installed/verified. Resolved ID: ${resolvedVanillaVersion.id}`);
    let versionIdToLaunch = resolvedVanillaVersion.id;

    // 2. 포지 설치 (targetForgeBuild가 제공된 경우)
    if (targetForgeMcVersion && targetForgeBuild) {
        const forgeVersionMetaForTask = {
            mcversion: targetForgeMcVersion,
            version: targetForgeBuild,
        };

        // installForgeTask의 options는 InstallForgeOptions 타입
        // InstallForgeOptions가 DownloadOptions를 포함하거나 확장하는지 확인 필요.
        // 여기서는 InstallForgeOptions에 java 외에 commonInstallOptions의 일부를 전달할 수 있다고 가정.
        const forgeSpecificInstallOptions = {
            java: currentJavaPath,
            // minecraft: minecraftLocation, // installForgeTask의 두 번째 인자로 이미 전달됨
            ...commonInstallOptions, // 타임아웃 등 공통 옵션 포함
            // side는 installForgeTask에서 내부적으로 처리될 수 있으므로 commonInstallOptions에서 제외하거나,
            // installForgeTask가 받는 옵션에 side가 없다면 여기서 제거.
            // 일반적으로 Forge 설치는 client side만 고려.
        };
        // InstallForgeOptions에 side가 없다면:
        // const { side, ...otherCommonOptions } = commonInstallOptions;
        // const forgeSpecificInstallOptions = { java: currentJavaPath, ...otherCommonOptions };


        log.info(`Checking/Installing Forge (MC: ${targetForgeMcVersion}, ForgeBuild: ${targetForgeBuild})...`);
        const forgeInstallOp = installForgeTask(forgeVersionMetaForTask, minecraftLocation, forgeSpecificInstallOptions);
        const installedForgeId = await runTaskWithProgress(forgeInstallOp, `포지 (${targetForgeBuild}) 설치`, 'install-forge');
        log.info(`Forge installation task completed. Installed Forge version ID: ${installedForgeId}`);

        const resolvedForgeVersionAfterInstall = await Version.parse(minecraftLocation, installedForgeId);
        // installDependenciesTask의 두 번째 인자 options에 commonInstallOptions 전달
        const depsInstallOp = installDependenciesTask(resolvedForgeVersionAfterInstall, commonInstallOptions);
        await runTaskWithProgress(depsInstallOp, `포지 종속성 설치 (${installedForgeId})`, 'install-forge-deps');

        log.info(`Forge ${installedForgeId} and its dependencies are installed.`);
        versionIdToLaunch = installedForgeId;
    } else {
        // 바닐라만 설치하는 경우 종속성 확인
        log.info(`Ensuring dependencies for Vanilla version: ${resolvedVanillaVersion.id}...`);
        // installDependenciesTask의 두 번째 인자 options에 commonInstallOptions 전달
        const vanillaDepsOp = installDependenciesTask(resolvedVanillaVersion, commonInstallOptions);
        await runTaskWithProgress(vanillaDepsOp, `바닐라 종속성 설치 (${resolvedVanillaVersion.id})`, 'install-vanilla-deps');
    }
    return versionIdToLaunch;
}

/**
 * 실행에 필요한 인증 프로필 및 관련 정보를 LaunchOption 형태로 반환
 * @returns {Promise<Pick<LaunchOption, 'gameProfile' | 'accessToken' | 'userType' | 'properties'>>}
 */
async function getAuthParametersForLaunch() { // 함수 이름 변경 (더 명확하게)
    log.info("Attempting to get selected account from ConfigManager for launch parameters...");
    const selectedAccount = ConfigManager.getSelectedAccount();

    log.info("Selected account object from ConfigManager:", JSON.stringify(selectedAccount, null, 2));

    if (!selectedAccount || typeof selectedAccount.username !== 'string' || typeof selectedAccount.uuid !== 'string' ||
        selectedAccount.type !== 'microsoft' || typeof selectedAccount.accessToken !== 'string' ||
        typeof selectedAccount.expiresAt !== 'number' ||
        typeof selectedAccount.msRefreshToken !== 'string') {
        const msg = "Selected Microsoft account information is invalid or missing required fields for launch. Please login again.";
        log.error(msg, selectedAccount);
        throw new Error(msg);
    }

    log.info(`Preparing launch parameters for: ${selectedAccount.username} (UUID: ${selectedAccount.uuid})`);

    let currentMcAccessToken = selectedAccount.accessToken; // confighandler에 저장된 Minecraft Access Token
    const mcTokenExpiresAt = selectedAccount.expiresAt;
    const msRefreshTokenFromConfig = selectedAccount.msRefreshToken;

    const now = Date.now();
    const fiveMinutesInMs = 5 * 60 * 1000;

    if (!currentMcAccessToken || !mcTokenExpiresAt || mcTokenExpiresAt - fiveMinutesInMs < now) {
        log.warn(`Minecraft Access Token for ${selectedAccount.username} needs refresh. Attempting...`);
        if (!msRefreshTokenFromConfig) throw new Error("Cannot refresh MC Token: MS Refresh Token is missing.");
        try {
            const refreshedData = await AuthHandler.refreshTokensForLaunch(selectedAccount.uuid, msRefreshTokenFromConfig);
            if (refreshedData && refreshedData.mcAccessToken) {
                currentMcAccessToken = refreshedData.mcAccessToken;
                log.info(`Successfully refreshed Minecraft Access Token for ${selectedAccount.username}.`);
                // selectedAccount의 이름이나 UUID도 refreshedData에서 가져온 값으로 업데이트 가능
                // (단, ConfigManager가 이미 최신 정보로 업데이트했을 것임)
            } else {
                throw new Error("Failed to refresh Minecraft Access Token (no token in response).");
            }
        } catch (error) {
            log.error(`Error refreshing tokens for ${selectedAccount.username}:`, error);
            throw new Error(`Token refresh failed: ${error.message || 'Unknown error'}. Please try logging in again.`);
        }
    } else {
        log.info(`Using existing valid Minecraft Access Token for ${selectedAccount.username}.`);
    }

    if (!currentMcAccessToken) throw new Error("Failed to obtain a valid Minecraft Access Token for launch.");

    return {
        userType: 'msa', // Microsoft 계정이므로 'msa'
        accessToken: currentMcAccessToken, // Minecraft 게임 세션용 액세스 토큰
        gameProfile: {
            id: selectedAccount.uuid.replace(/-/g, ""), // 대시(-) 없는 UUID
            name: selectedAccount.username,             // Minecraft 사용자 이름
        },
        properties: {} // 일반적으로 비어있거나 '{}'. 필요시 채움.
    };
}

/**
 * 리소스 버전 체크 및 업데이트 (ZIP 다운로드 및 압축 해제)
 * @param {string} resourceRootPath 리소스가 설치될 루트 경로 (예: getMinecraftRootPath())
 * @returns {Promise<boolean>} 업데이트 성공 여부 또는 업데이트 필요 없었는지 여부
 */
async function checkAndApplyResourceUpdate(resourceRootPath) {
    log.info('Checking for resource updates...');
    const localVersionFilePath = path.join(resourceRootPath, LOCAL_VERSION_FILE_NAME);
    let localVersion = '0'; // 로컬 버전 파일이 없으면 '0' 또는 매우 낮은 값으로 초기화

    try {
        if (fs.existsSync(localVersionFilePath)) {
            localVersion = (await fs.readFile(localVersionFilePath, 'utf-8')).trim();
            log.info(`Local resource version: ${localVersion}`);
        } else {
            log.info('No local resource version file found. Assuming version 0.');
        }

        // 1. 원격 버전 정보 가져오기
        log.info(`Fetching remote resource version from: ${RESOURCE_VERSION_URL}`);
        const response = await axios.get(RESOURCE_VERSION_URL, { timeout: 5000 }); // 타임아웃 설정
        const remoteVersion = response.data.toString().trim(); // toString() 추가 및 trim
        log.info(`Remote resource version: ${remoteVersion}`);

        // 버전 비교 (단순 문자열 비교 또는 숫자 변환 후 비교)
        // 여기서는 단순 문자열 비교. 더 복잡한 버전 체계(예: SemVer)라면 라이브러리 사용 고려.
        if (localVersion === remoteVersion) {
            log.info('Resources are up to date. No update needed.');
            return true; // 업데이트 필요 없음
        }

        log.info(`Update required: Local version ${localVersion} -> Remote version ${remoteVersion}`);

        // 2. ZIP 파일 다운로드
        log.info(`Downloading resource ZIP from: ${RESOURCE_ZIP_URL}`);
        const zipResponse = await axios({
            method: 'get',
            url: RESOURCE_ZIP_URL,
            responseType: 'arraybuffer', // 바이너리 데이터로 받기
            timeout: 300000 // 5분 타임아웃 (파일 크기에 따라 조절)
        });
        const zipBuffer = Buffer.from(zipResponse.data);
        log.info('Resource ZIP downloaded successfully.');

        // 3. ZIP 파일 압축 해제 (기존 파일 덮어쓰기)
        log.info(`Extracting ZIP to: ${resourceRootPath} (overwrite enabled)`);
        const zip = new AdmZip(zipBuffer);
        // extractAllTo는 기본적으로 덮어쓰기를 지원합니다.
        // 하지만 더 명시적으로 하려면, 압축 풀기 전에 기존 파일을 삭제하거나,
        // AdmZip의 entry.getData()를 사용하여 각 파일을 수동으로 쓰는 방법도 있습니다.
        // 여기서는 간단히 extractAllTo를 사용합니다. (overwriteIfNewer는 옵션)
        zip.extractAllTo(resourceRootPath, true /* overwrite */);
        log.info('ZIP extracted successfully.');

        // 4. 로컬 버전 파일 업데이트
        await fs.writeFile(localVersionFilePath, remoteVersion, 'utf-8');
        log.info(`Local resource version updated to: ${remoteVersion}`);

        return true; // 업데이트 성공

    } catch (error) {
        log.error('Failed to check or apply resource update:', error.message);
        if (error.isAxiosError) {
            log.error('Axios error details:', {
                url: error.config?.url,
                method: error.config?.method,
                status: error.response?.status,
                data: error.response?.data, // 데이터가 너무 크면 로그 생략 고려
            });
        }
        // 업데이트 실패 시 게임 실행을 계속할지, 아니면 중단할지 결정해야 함.
        // 여기서는 오류를 던지지 않고 false를 반환하여, 호출부에서 처리하도록 함.
        return false; // 업데이트 실패
    }
}

/**
 * 게임 실행 (사용자 설정 반영)
 * @param {string} versionIdToLaunch 실행할 버전 ID
 * @param {Pick<LaunchOption, 'gameProfile' | 'accessToken' | 'userType' | 'properties'>} authParams 인증 파라미터
 * @returns {Promise<import('child_process').ChildProcess>}
 */
async function startGame(versionIdToLaunch, authParams) {
    const mcRoot = getMinecraftRootPath();
    log.info(`Attempting to launch Minecraft version: ${versionIdToLaunch} from ${mcRoot}`);
    const minecraftLocation = new MinecraftFolder(mcRoot);
    const currentJavaPath = await ensureJavaPath(minecraftLocation);

    // --- ConfigManager에서 사용자 설정 가져오기 ---
    const config = ConfigManager.getConfig(); // 전체 설정 객체 가져오기
    let gameSettings = config?.settings?.game;

    if (!gameSettings) {
        log.warn('Game settings not found in ConfigManager. Using default launch options for memory/resolution.');
        gameSettings = { // 폴백 기본값 (ConfigManager의 DEFAULT_CONFIG와 유사하게)
            minMemoryMB: 1024, // ConfigManager의 기본값과 일치시키거나 더 안전한 값
            maxMemoryMB: 4096, // ConfigManager의 기본값과 일치시키거나 더 안전한 값
            resWidth: 1280,    // 안전한 기본 해상도
            resHeight: 720,
            fullscreen: false,
            // launchDetached, autoConnect 등 다른 설정도 필요시 여기에 기본값 추가
        };
    }

    // 메모리 설정 (MB 단위)
    const minMemory = typeof gameSettings.minMemoryMB === 'number' && gameSettings.minMemoryMB >= 512 ? gameSettings.minMemoryMB : 1024;
    const maxMemory = typeof gameSettings.maxMemoryMB === 'number' && gameSettings.maxMemoryMB >= 1024 ? gameSettings.maxMemoryMB : 4096;
    
    // 해상도 설정
    const gameResolutionWidth = typeof gameSettings.resWidth === 'number' && gameSettings.resWidth >= 800 ? gameSettings.resWidth : undefined; // undefined면 게임 기본값 사용
    const gameResolutionHeight = typeof gameSettings.resHeight === 'number' && gameSettings.resHeight >= 600 ? gameSettings.resHeight : undefined; // undefined면 게임 기본값 사용
    
    // 전체화면 설정
    const fullscreen = typeof gameSettings.fullscreen === 'boolean' ? gameSettings.fullscreen : false;

    log.info(`Applying game settings - Min Mem: ${minMemory}MB, Max Mem: ${maxMemory}MB, Resolution: ${gameResolutionWidth || 'Default'}x${gameResolutionHeight || 'Default'}, Fullscreen: ${fullscreen}`);

    // LaunchOption 구성
    const launchOptions /*: LaunchOption*/ = { // 타입 명시 (선택적)
        version: versionIdToLaunch,
        gamePath: minecraftLocation.root,
        javaPath: currentJavaPath,

        userType: authParams.userType,
        accessToken: authParams.accessToken,
        gameProfile: authParams.gameProfile,
        properties: authParams.properties,

        minMemory: minMemory, // MB 단위
        maxMemory: maxMemory, // MB 단위
        resolution: { width: gameResolutionWidth, height: gameResolutionHeight, fullscreen: fullscreen },

        // 기존 extraExecOption 유지 또는 ConfigManager에서 가져오기
        extraExecOption: { detached: true, stdio: 'ignore' } // 예시
        // server: config?.settings?.game?.autoConnect && config?.selectedServer ? { host: config.selectedServer.host, port: config.selectedServer.port } : undefined,
    };

    log.info('Launching Minecraft with options:', {
        ...launchOptions,
        accessToken: launchOptions.accessToken ? "HIDDEN" : "NONE",
    });

    const process = await launch(launchOptions);

    log.info(`Minecraft process started with PID: ${process.pid}`);
    if (process && typeof process.unref === 'function') {
        process.unref();
        log.info(`Minecraft process (PID: ${process.pid}) unref'd.`);
    }
    process.on('error', (err) => { log.error(`Minecraft process (PID: ${process.pid}) error:`, err); });
    process.on('exit', (code, signal) => { log.info(`Minecraft process (PID: ${process.pid}) exited with code ${code}, signal ${signal}`); });

    return process;
}

// --- 진행률 업데이트 IPC 전송 함수 ---
function sendProgressUpdate(eventChannel, data) {
    // 현재 활성화된 모든 렌더러 창에 메시지를 보낼 수 있지만,
    // 보통은 특정 런처 창에만 보내야 합니다.
    // main.js에서 BrowserWindow 인스턴스를 launch.js로 넘겨주거나,
    // 전역에서 접근 가능한 형태로 관리해야 합니다.
    // 여기서는 mainWindow가 전역적으로 또는 모듈 인자로 전달되었다고 가정합니다.

    // 예시: mainWindow가 launch.js로 전달되었다고 가정
    // 이 부분은 실제 Electron 애플리케이션 구조에 맞게 수정해야 합니다.
    const focusedWindow = BrowserWindow.getFocusedWindow(); // 또는 특정 ID의 창
    if (focusedWindow) {
        focusedWindow.webContents.send(eventChannel, data);
    } else {
        log.warn(`[GameLauncher - sendProgressUpdate] No focused window found to send IPC message on channel: ${eventChannel}`);
    }
}

/**
 * Task 실행 및 진행률 로깅 + IPC 전송을 위한 헬퍼 함수
 * @param {import('@xmcl/task').Task<any>} taskInstance 실행할 xmcl Task 객체
 * @param {string} taskDescription 로깅 및 모달 메시지용 작업 설명
 * @param {string} overallTaskKey 전체 작업 단계를 구분하는 키 (선택적)
 * @returns {Promise<any>} Task의 결과값
 */
async function runTaskWithProgress(taskInstance, taskDescription, overallTaskKey = 'generic-task') {
    log.info(`Starting task: ${taskDescription} (Path: ${taskInstance.path || 'N/A'})`);
    sendProgressUpdate('launch-progress-update', {
        message: `${taskDescription} 시작 중...`,
        progress: 0, // 작업 시작 시 0%
        details: `Task: ${taskInstance.name || taskDescription}`,
        taskKey: overallTaskKey
    });

    let lastLoggedProgress = -1;
    let lastSentProgress = -1; // IPC 전송용 진행률

    try {
        const result = await taskInstance.startAndWait({
            onStart(task) {
                log.info(` -> Sub-task started: ${task.name || 'Unnamed Subtask'} (Path: ${task.path})`);
                sendProgressUpdate('launch-progress-update', {
                    message: taskDescription, // 메인 작업 설명 유지
                    details: `진행 중: ${task.path || task.name || '세부 작업'}`,
                    progress: taskInstance.total > 0 ? Math.round((taskInstance.progress / taskInstance.total) * 100) : lastSentProgress, // 현재 진행률
                    taskKey: overallTaskKey
                });
            },
            onUpdate(task, chunkSize) {
                if (taskInstance.total > 0) {
                    const currentProgress = Math.round((taskInstance.progress / taskInstance.total) * 100);
                    if (currentProgress % 5 === 0 && currentProgress !== lastSentProgress) { // 5% 단위로 IPC 전송
                        sendProgressUpdate('launch-progress-update', {
                            message: taskDescription,
                            progress: currentProgress,
                            details: `다운로드 중: ${task.path || task.name || '파일'}... (${currentProgress}%)`,
                            taskKey: overallTaskKey
                        });
                        lastSentProgress = currentProgress;
                    }
                    if (currentProgress % 10 === 0 && currentProgress !== lastLoggedProgress) {
                        log.info(` -> Overall task [${taskDescription}] progress: ${currentProgress}% (${taskInstance.progress} / ${taskInstance.total})`);
                        lastLoggedProgress = currentProgress;
                    }
                }
            },
            onFailed(task, error) {
                log.error(` -> Sub-task failed: ${task.name || 'Unnamed Subtask'} (Path: ${task.path})`, error);
                sendProgressUpdate('launch-progress-update', {
                    message: `${taskDescription} 중 오류 발생`,
                    progress: lastSentProgress, // 실패 시 이전 진행률 유지 또는 -1 (오류 표시)
                    details: `오류: ${task.name || '세부 작업'} - ${error.message}`,
                    isError: true,
                    taskKey: overallTaskKey
                });
            },
            onSucceed(task, taskResult) {
                log.info(` -> Sub-task succeeded: ${task.name || 'Unnamed Subtask'} (Path: ${task.path})`);
            },
        });
        log.info(`Task completed: ${taskDescription}`);
        sendProgressUpdate('launch-progress-update', {
            message: `${taskDescription} 완료!`,
            progress: 100,
            details: `완료: ${taskDescription}`,
            taskKey: overallTaskKey
        });
        return result;
    } catch (error) {
        log.error(`Error during task execution [${taskDescription}]:`, error);
        sendProgressUpdate('launch-progress-update', {
            message: `${taskDescription} 실패`,
            progress: -1, // 오류 상태 표시
            details: `실패: ${error.message}`,
            isError: true,
            taskKey: overallTaskKey
        });
        throw error;
    }
}

// --- 메인 실행 함수 ---
async function launchMinecraftGame() {
    // IPC로 모달 표시 요청 (렌더러에서 모달을 먼저 띄움)
    sendProgressUpdate('launch-progress-start', { title: '게임 실행 준비' }); // '...' 제거, 애니메이션은 렌더러에서
    try {
        log.info('Starting Minecraft launch sequence...');
        sendProgressUpdate('launch-progress-update', { message: '설정 및 계정 정보 확인 중...', progress: 5, taskKey: 'init' });

        if (!ConfigManager.isLoaded()) {
            const errMsg = 'ConfigManager is not loaded. Cannot proceed with launch.';
            log.warn(errMsg);
            throw new Error(errMsg); // 오류를 던져 catch 블록에서 처리
        }
        const authParams = await getAuthParametersForLaunch();
        sendProgressUpdate('launch-progress-update', { message: '게임 파일 설치 확인 중...', progress: 15, taskKey: 'install-check' });

        const versionIdToLaunch = await ensureMinecraftAndForgeInstalled(
            MINECRAFT_VERSION_TARGET,
            FORGE_MC_VERSION,
            FORGE_BUILD_VERSION
        );
        sendProgressUpdate('launch-progress-update', { message: '커스텀 리소스 업데이트 확인 중...', progress: 70, taskKey: 'custom-resource-update-check' });

        const gameRootPath = getMinecraftRootPath();
        const updateSuccessful = await checkAndApplyResourceUpdate(gameRootPath);
        if (!updateSuccessful) {
            log.warn('Resource update failed or was skipped.');
            sendProgressUpdate('launch-progress-update', { message: '커스텀 리소스 업데이트 실패 또는 생략됨.', progress: 80, taskKey: 'custom-resource-update-result', isWarning: true });
        } else {
            sendProgressUpdate('launch-progress-update', { message: '커스텀 리소스 업데이트 완료.', progress: 80, taskKey: 'custom-resource-update-result' });
        }

        sendProgressUpdate('launch-progress-update', { message: '게임 실행 준비 중...', progress: 90, taskKey: 'pre-launch' }); // 여기도 '...' 제거 가능
        const mcProcess = await startGame(versionIdToLaunch, authParams);

        if (mcProcess && mcProcess.pid) {
            log.info(`Minecraft process (PID: ${mcProcess.pid}) has been launched.`);
            sendProgressUpdate('launch-progress-complete', { success: true, message: '게임이 실행되었습니다!' });
            return { success: true, message: 'Minecraft launched.', launchedPID: mcProcess.pid };
        } else {
            const errMsg = '게임 실행 후 프로세스 정보를 가져오지 못했습니다.';
            log.warn('Minecraft launch was attempted, but the returned process object is invalid or PID is missing.');
            // sendProgressUpdate('launch-progress-complete', { success: false, message: errMsg }); // 아래 catch에서 처리
            throw new Error(errMsg); // 오류를 던져 catch 블록에서 일관되게 처리
        }
    } catch (error) {
        log.error('Minecraft launch sequence failed:', error.message);
        let displayMessage = `게임 실행 실패: ${error.message || '알 수 없는 오류'}`;
        // ... (기존 displayMessage 생성 로직은 유지) ...
        if (error.name === 'AggregateError' && error.errors && error.errors.length > 0) {
            const firstError = error.errors[0];
            if (firstError.name === 'ChecksumNotMatchError') {
                displayMessage = '게임 파일 다운로드 중 오류가 발생했습니다 (파일 손상). 인터넷 연결을 확인하고 다시 시도해주세요.';
            } else if (firstError.code === 'UND_ERR_CONNECT_TIMEOUT') {
                displayMessage = '게임 파일 다운로드 중 연결 시간 초과 오류가 발생했습니다. 인터넷 연결을 확인하고 다시 시도해주세요.';
            } else {
                displayMessage = `게임 파일 설치 중 오류 발생: ${firstError.message || '알 수 없는 오류'}`;
            }
        } else if (error.message && error.message.includes("Suitable Java installation")) {
            displayMessage = error.message;
        } else if (error.message && error.message.includes("ConfigManager is not loaded")) {
            displayMessage = error.message;
        }


        log.error('Detailed error stack for launch failure:', error.stack);
        // 실패 시 모달에 오류 메시지를 표시하고, 렌더러에서 모달을 닫도록 함
        sendProgressUpdate('launch-progress-complete', {
            success: false,
            message: displayMessage, // 사용자에게 보여줄 최종 오류 메시지
            error: error.message // 상세 오류 메시지 (개발자용 또는 상세 보기에 사용 가능)
        });
        return { success: false, message: displayMessage }; // 런처 내부 반환값
    }
}

module.exports = {
    launchMinecraftGame,
};