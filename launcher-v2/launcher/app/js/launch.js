// launch.js
const { launch, Version, diagnose, LaunchOption, MinecraftFolder } = require('@xmcl/core');
const {
    installTask,
    installDependenciesTask,
    installNeoForgedTask,
    fetchJavaRuntimeManifest,
    installJavaRuntimeTask,
    JavaRuntimeTargetType,
    getVersionList,
    getPotentialJavaLocations,
    resolveJava,
} = require('@xmcl/installer');
const path = require('path');
const fs = require('fs-extra');
const { app, ipcMain, BrowserWindow } = require('electron');
const axios = require('axios'); // HTTP 요청용
const AdmZip = require('adm-zip'); // ZIP 압축 해제
const yaml = require('js-yaml'); // npm install js-yaml

const ConfigManager = require('./confighandler'); // 가정: ConfigManager는 별도로 존재
const AuthHandler = require('./authhandler');     // 가정: AuthHandler는 별도로 존재

const log = {
    info: (message, ...args) => console.log(`[GameLauncher] [INFO] ${new Date().toISOString()} ${message}`, ...args),
    error: (message, ...args) => console.error(`[GameLauncher] [ERROR] ${new Date().toISOString()} ${message}`, ...args),
    warn: (message, ...args) => console.warn(`[GameLauncher] [WARN] ${new Date().toISOString()} ${message}`, ...args),
};

// --- 설정 ---
const MINECRAFT_VERSION_TARGET = '1.21.1';
const NEOFORGE_PROJECT = 'neoforge';
const NEOFORGE_VERSION = '21.1.233';
const REQUIRED_JAVA_MAJOR_VERSION = 21;
// 데이터 저장 경로 (필요시 수정)
const MINECRAFT_ROOT_PATH = path.join(app.getPath('appData'), '.instance_HealingcampLauncher'); 

let targetWindowForProgress = null;

// --- 리소스 업데이트 설정 ---
// 주의: Dropbox 링크는 트래픽 제한이 있을 수 있으므로 추후 변경 권장
const RESOURCE_VERSION_URL = 'https://github.com/MacchiatoR/HealingCampLauncherElectron/releases/download/resource_1.0.0/version_NarangNorang.txt'; 
const RESOURCE_ZIP_URL = 'https://github.com/MacchiatoR/HealingCampLauncherElectron/releases/download/resource_1.0.0/narangnorang.zip';         
const LOCAL_VERSION_FILE_NAME = 'resource_version.txt'; 

// --- 다운로드 옵션 ---
const DOWNLOAD_TIMEOUT = 10000; // 10초 타임아웃

// --- Minecraft 루트 경로 지연 초기화 ---
let minecraftRootPathSingleton = null;
function getMinecraftRootPath() {
    if (!minecraftRootPathSingleton) {
        minecraftRootPathSingleton = MINECRAFT_ROOT_PATH;
        log.info(`Resource/Game root path initialized to: ${minecraftRootPathSingleton}`);
        fs.ensureDirSync(minecraftRootPathSingleton);
    }
    return minecraftRootPathSingleton;
}

// --- 진행률 업데이트 IPC 전송 함수 ---
function sendProgressUpdate(eventChannel, data) {
    if (targetWindowForProgress && !targetWindowForProgress.isDestroyed()) {
        try {
            targetWindowForProgress.webContents.send(eventChannel, data);
        } catch (e) {
            log.warn(`Failed to send IPC message: ${e.message}`);
        }
    } else {
        log.warn(`[GameLauncher] Target window for progress is not available or destroyed.`);
    }
}

/**
 * Task 실행 및 진행률 로깅 + IPC 전송을 위한 헬퍼 함수 (통합됨)
 * @param {import('@xmcl/task').Task<any>} taskInstance 실행할 xmcl Task 객체
 * @param {string} taskDescription 로깅 및 모달 메시지용 작업 설명
 * @param {number} baseProgress 이 작업이 시작될 때의 전체 진행률 (0~100)
 * @param {number} taskWeight 이 작업이 전체 진행률에서 차지하는 비중 (0~100)
 * @param {string} overallTaskKey 전체 작업 단계를 구분하는 키
 * @returns {Promise<any>} Task의 결과값
 */
async function runTaskWithProgress(taskInstance, taskDescription, baseProgress = 0, taskWeight = 0, overallTaskKey = 'generic-task') {
    log.info(`Starting task: ${taskDescription} (Path: ${taskInstance.path || 'N/A'})`);
    
    // 태스크 시작 알림
    sendProgressUpdate('launch-progress-update', {
        message: `${taskDescription} 시작 중...`,
        progress: baseProgress,
        details: `Task: ${taskInstance.name || taskDescription}`,
        taskKey: overallTaskKey
    });

    let lastLoggedProgress = -1;
    let lastSentOverallProgress = baseProgress;

    try {
        const result = await taskInstance.startAndWait({
            onStart(task) {
                log.info(` -> Sub-task started: ${task.name || 'Unnamed Subtask'} (Path: ${task.path})`);
            },
            onUpdate(task, chunkSize) {
                if (taskInstance.total > 0) {
                    const taskProgressPercent = (taskInstance.progress / taskInstance.total); // 0.0 ~ 1.0
                    // 전체 진행률 = 시작점 + (현재태스크진행률 * 가중치)
                    const currentOverallProgress = Math.round(baseProgress + (taskProgressPercent * taskWeight));

                    // 너무 잦은 업데이트 방지 (1% 단위 또는 상태 변경 시)
                    if (currentOverallProgress !== lastSentOverallProgress) {
                        sendProgressUpdate('launch-progress-update', {
                            message: taskDescription,
                            progress: currentOverallProgress,
                            details: `진행 중: ${task.path || task.name || '파일'} (${Math.round(taskProgressPercent * 100)}%)`,
                            taskKey: overallTaskKey
                        });
                        lastSentOverallProgress = currentOverallProgress;
                    }
                    
                    // 로그는 10% 단위로
                    const percentInt = Math.round(taskProgressPercent * 100);
                    if (percentInt % 10 === 0 && percentInt !== lastLoggedProgress) {
                        log.info(` -> [${taskDescription}] Progress: ${percentInt}% (Total: ${currentOverallProgress}%)`);
                        lastLoggedProgress = percentInt;
                    }
                }
            },
            onFailed(task, error) {
                log.error(` -> Sub-task failed: ${task.name || 'Unnamed Subtask'}`, error);
                // 실패했더라도 상위 catch에서 처리하므로 여기서는 로그만 남김
            },
            onSucceed(task, taskResult) {
                // 개별 서브태스크 성공 로그
            },
        });

        log.info(`Task completed: ${taskDescription}`);
        
        // 태스크 완료 시, 할당된 가중치를 모두 채운 진행률 전송
        sendProgressUpdate('launch-progress-update', {
            message: `${taskDescription} 완료!`,
            progress: baseProgress + taskWeight,
            details: `완료: ${taskDescription}`,
            taskKey: overallTaskKey
        });
        return result;
    } catch (error) {
        log.error(`Error during task execution [${taskDescription}]:`, error);
        throw error; // 상위 호출자로 에러 전파
    }
}

/**
 * 재시도 로직이 포함된 Task 실행 함수
 * [수정됨] 인자들을 runTaskWithProgress로 올바르게 전달하도록 수정
 */
async function runTaskWithRetry(taskInstance, description, baseProgress, taskWeight, taskKey, retries = 3) {
    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            return await runTaskWithProgress(taskInstance, description, baseProgress, taskWeight, taskKey);
        } catch (error) {
            if (attempt < retries) {
                log.warn(`${description} 실패 (${attempt}/${retries}) → 재시도 중... 에러: ${error.message}`);
                await new Promise(r => setTimeout(r, 1000)); // 1초 대기 후 재시도
            } else {
                log.error(`${description} 최종 실패.`);
                throw error;
            }
        }
    }
}

/**
 * 적절한 Java 경로를 찾거나 확인 (없으면 설치)
 */
async function ensureJavaPath(minecraftLocation) {
    const minecraftRoot = typeof minecraftLocation === 'string'
        ? minecraftLocation
        : (minecraftLocation.root || minecraftLocation.toString?.() || '');

    if (!minecraftRoot || typeof minecraftRoot !== 'string') {
        throw new Error('Invalid minecraftLocation: must be a string or an object with root property.');
    }

    const logDir = path.join(minecraftRoot, 'logs_launcher');
    if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
    const logFilePath = path.join(logDir, 'java_detection.yml');

    const foundJavaList = [];
    let foundJavaPath = null;
    let javaInstalled = false;

    const parseMajorJavaVersion = (versionString) => {
        if (!versionString || typeof versionString !== 'string') return 0;
        const match = versionString.match(/^(\d+)(\.\d+)*([.-_]\d+)*([+-].*)?$/);
        if (!match) return 0;
        let major = parseInt(match[1]) || 0;
        if (major === 1 && versionString.startsWith('1.')) {
            const parts = versionString.split(/[.-_]/);
            major = parseInt(parts[1]) || 0;
        }
        return major;
    };

    const testJavaPath = async (javaExePath, source) => {
        if (!fs.existsSync(javaExePath)) return null;
        try {
            const javaInfo = await resolveJava(javaExePath);
            if (javaInfo && javaInfo.path && javaInfo.version) {
                const majorVersion = parseMajorJavaVersion(javaInfo.version);
                foundJavaList.push({ path: javaInfo.path, version: javaInfo.version, source });
                if (majorVersion >= REQUIRED_JAVA_MAJOR_VERSION) return javaInfo.path;
            }
        } catch (_) { }
        return null;
    };

    try {
        // 1. 기존 탐색 로직
        const potentialLocations = await getPotentialJavaLocations();
        if (potentialLocations && potentialLocations.length > 0) {
            for (const loc of potentialLocations) {
                let javaExeToTest = loc;
                if (!loc.toLowerCase().endsWith('java.exe') && !loc.toLowerCase().endsWith('java')) {
                    const platformSpecificPath = process.platform === 'win32'
                        ? path.join(loc, 'bin', 'java.exe')
                        : path.join(loc, 'bin', 'java');
                    if (fs.existsSync(platformSpecificPath)) {
                        javaExeToTest = platformSpecificPath;
                    }
                }
                foundJavaPath = await testJavaPath(javaExeToTest, '@xmcl/installer');
                if (foundJavaPath) break;
            }
        }

        // 2. JAVA_HOME 확인
        if (!foundJavaPath && process.env.JAVA_HOME) {
            const javaExePath = process.platform === 'win32'
                ? path.join(process.env.JAVA_HOME, 'bin', 'java.exe')
                : path.join(process.env.JAVA_HOME, 'bin', 'java');
            foundJavaPath = await testJavaPath(javaExePath, 'JAVA_HOME');
        }

        // 3. PATH 환경변수 확인
        if (!foundJavaPath) {
            const pathEnv = process.env.PATH || '';
            const pathEntries = pathEnv.split(process.platform === 'win32' ? ';' : ':');
            for (const entry of pathEntries) {
                if (!entry) continue;
                const javaExePath = process.platform === 'win32' ? path.join(entry, 'java.exe') : path.join(entry, 'java');
                foundJavaPath = await testJavaPath(javaExePath, 'System PATH');
                if (foundJavaPath) break;
            }
        }

        // 4. 없으면 런처 전용 폴더에 자동 설치
        if (!foundJavaPath) {
            const javaInstallDir = path.join(minecraftRoot, 'runtime', `java-${REQUIRED_JAVA_MAJOR_VERSION}`);
            // 이미 다운로드 되어있는지 확인
            const checkPath = process.platform === 'win32' 
                ? path.join(javaInstallDir, 'bin', 'java.exe') 
                : path.join(javaInstallDir, 'bin', 'java');
            
            if (fs.existsSync(checkPath)) {
                foundJavaPath = checkPath;
            } else {
                console.log(`Java ${REQUIRED_JAVA_MAJOR_VERSION} not found. Installing...`);
                if (!fs.existsSync(javaInstallDir)) fs.mkdirSync(javaInstallDir, { recursive: true });
                
                const javaManifest = await fetchJavaRuntimeManifest({
                    target: JavaRuntimeTargetType.Gamma,
                });
                await installJavaRuntimeTask({
                    manifest: javaManifest,
                    destination: javaInstallDir,
                    timeout: 300000,
                    retries: 3,
                }).startAndWait();

                foundJavaPath = checkPath;
                javaInstalled = true;
            }
        }

        const logData = {
            timestamp: new Date().toISOString(),
            found_java: foundJavaList,
            selected_java: foundJavaPath || null,
            installed: javaInstalled
        };
        fs.writeFileSync(logFilePath, yaml.dump(logData), 'utf8');

        return foundJavaPath;

    } catch (e) {
        log.error(`Error during Java path detection: ${e.message}`);
        throw e;
    }
}

/**
 * 마인크래프트 및 네오포지 설치/확인 (수정됨: 진행률 인자 전달)
 */
async function ensureMinecraftAndNeoForgeInstalled(targetMcVersion, targetNeoForgeProject, targetNeoForgeVersion, initialProgress, totalWeightForThisStep) {
    const mcRoot = getMinecraftRootPath();
    log.info(`Ensuring Minecraft & NeoForge at ${mcRoot}...`);
    const minecraftLocation = new MinecraftFolder(mcRoot);
    const currentJavaPath = await ensureJavaPath(minecraftLocation);
    const commonInstallOptions = { side: 'client', timeout: DOWNLOAD_TIMEOUT, retries: 3 };

    // 가중치 분배: 네오포지가 있으면 바닐라(40%) + 네오포지&종속성(60%), 없으면 바닐라(100%)
    const vanillaInstallWeight = targetNeoForgeVersion ? Math.floor(totalWeightForThisStep * 0.4) : totalWeightForThisStep;
    const loaderAndDepsWeight = targetNeoForgeVersion ? totalWeightForThisStep - vanillaInstallWeight : 0;

    // 1. 바닐라 메타데이터 가져오기
    const versionList = await getVersionList();
    const vanillaVersionMeta = versionList.versions.find(v => v.id === targetMcVersion);
    if (!vanillaVersionMeta) throw new Error(`Vanilla metadata for ${targetMcVersion} not found.`);
    
    // 2. 바닐라 설치
    const vanillaInstallOp = installTask(vanillaVersionMeta, minecraftLocation, commonInstallOptions);
    const resolvedVanillaVersion = await runTaskWithRetry(
        vanillaInstallOp, 
        `바닐라 (${targetMcVersion}) 설치`, 
        initialProgress, 
        vanillaInstallWeight, 
        'install-vanilla'
    );
    
    let currentOverallProgress = initialProgress + vanillaInstallWeight;
    let versionIdToLaunch = resolvedVanillaVersion.id;

    // 3. 네오포지 설치
    if (targetNeoForgeProject && targetNeoForgeVersion) {
        const neoForgeSpecificInstallOptions = { java: currentJavaPath, ...commonInstallOptions };
        
        // 네오포지 설치와 종속성 설치로 가중치 세분화
        const loaderInstallWeight = Math.floor(loaderAndDepsWeight * 0.6);
        const loaderDepsWeight = loaderAndDepsWeight - loaderInstallWeight;

        const neoForgeInstallOp = installNeoForgedTask(targetNeoForgeProject, targetNeoForgeVersion, minecraftLocation, neoForgeSpecificInstallOptions);
        const installedNeoForgeId = await runTaskWithRetry(
            neoForgeInstallOp, 
            `네오포지 (${targetNeoForgeVersion}) 설치`, 
            currentOverallProgress, 
            loaderInstallWeight, 
            'install-neoforge'
        );
        currentOverallProgress += loaderInstallWeight;

        const resolvedNeoForgeVersionAfterInstall = await Version.parse(minecraftLocation, installedNeoForgeId);
        const depsInstallOp = installDependenciesTask(resolvedNeoForgeVersionAfterInstall, commonInstallOptions);
        
        await runTaskWithRetry(
            depsInstallOp, 
            `네오포지 종속성 설치 (${installedNeoForgeId})`, 
            currentOverallProgress, 
            loaderDepsWeight, 
            'install-neoforge-deps'
        );
        versionIdToLaunch = installedNeoForgeId;
    } else {
        // 바닐라만 설치하는 경우 종속성 확인
        const vanillaDepsOp = installDependenciesTask(resolvedVanillaVersion, commonInstallOptions);
        await runTaskWithRetry(
            vanillaDepsOp, 
            `바닐라 종속성 설치 (${resolvedVanillaVersion.id})`, 
            currentOverallProgress, 
            0, // 남은 가중치 없음 (이미 위에서 할당됨)
            'install-vanilla-deps'
        );
    }

    return versionIdToLaunch;
}

/**
 * 인증 정보 가져오기
 */
async function getAuthParametersForLaunch() {
    log.info("Attempting to get selected account from ConfigManager for launch parameters...");
    const selectedAccount = ConfigManager.getSelectedAccount();

    log.info("Selected account object:", JSON.stringify(selectedAccount, null, 2));

    if (!selectedAccount || typeof selectedAccount.username !== 'string' || typeof selectedAccount.uuid !== 'string' ||
        selectedAccount.type !== 'microsoft' || typeof selectedAccount.accessToken !== 'string' ||
        typeof selectedAccount.expiresAt !== 'number' ||
        typeof selectedAccount.msRefreshToken !== 'string') {
        const msg = "Selected Microsoft account information is invalid. Please login again.";
        log.error(msg, selectedAccount);
        throw new Error(msg);
    }

    log.info(`Preparing launch parameters for: ${selectedAccount.username}`);

    let currentMcAccessToken = selectedAccount.accessToken;
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
            } else {
                throw new Error("Failed to refresh Minecraft Access Token (no token in response).");
            }
        } catch (error) {
            log.error(`Error refreshing tokens for ${selectedAccount.username}:`, error);
            throw new Error(`Token refresh failed: ${error.message || 'Unknown error'}. Please try logging in again.`);
        }
    } else {
        log.info(`Using existing valid Minecraft Access Token.`);
    }

    if (!currentMcAccessToken) throw new Error("Failed to obtain a valid Minecraft Access Token for launch.");

    return {
        userType: 'msa',
        accessToken: currentMcAccessToken,
        gameProfile: {
            id: selectedAccount.uuid.replace(/-/g, ""),
            name: selectedAccount.username,
        },
        properties: {}
    };
}

/**
 * 리소스 업데이트 (ZIP 다운로드 및 해제)
 */
async function checkAndApplyResourceUpdate(resourceRootPath, logger, localVersionFileName, remoteVersionUrl, remoteZipUrl) {
    logger.info('Checking for resource updates...');
    const localVersionFilePath = path.join(resourceRootPath, localVersionFileName);
    let localVersion = '0';

    try {
        if (fs.existsSync(localVersionFilePath)) {
            localVersion = (await fs.readFile(localVersionFilePath, 'utf-8')).trim();
            logger.info(`Local resource version: ${localVersion}`);
        } else {
            logger.info('No local resource version file found. Assuming version 0.');
        }

        logger.info(`Fetching remote resource version from: ${remoteVersionUrl}`);
        const response = await axios.get(remoteVersionUrl, { timeout: 5000 });
        const remoteVersion = response.data.toString().trim();
        logger.info(`Remote resource version: ${remoteVersion}`);

        if (localVersion === remoteVersion) {
            logger.info('Resources are up to date. No update needed.');
            return true;
        }

        logger.info(`Update required: Local ${localVersion} -> Remote ${remoteVersion}`);
        logger.info(`Downloading resource ZIP from: ${remoteZipUrl}`);
        
        const zipResponse = await axios({
            method: 'get',
            url: remoteZipUrl,
            responseType: 'arraybuffer',
            timeout: 300000 // 5분
        });
        const zipBuffer = Buffer.from(zipResponse.data);
        logger.info('Resource ZIP downloaded successfully.');

        // 안전한 삭제를 위해 try-catch로 감쌉니다.
        const modsFolderPath = path.join(resourceRootPath, 'mods');
        try {
            if (fs.existsSync(modsFolderPath)) {
                logger.info(`Deleting mods folder: ${modsFolderPath}`);
                await fs.remove(modsFolderPath);
                logger.info('Mods folder deleted.');
            }
        } catch (deleteError) {
            logger.error(`Failed to delete mods folder: ${deleteError.message}`);
        }

        const resourcePacksFolderPath = path.join(resourceRootPath, 'resourcepacks');
        try {
            if (fs.existsSync(resourcePacksFolderPath)) {
                logger.info(`Deleting resourcepacks folder: ${resourcePacksFolderPath}`);
                await fs.remove(resourcePacksFolderPath);
                logger.info('Resourcepacks folder deleted.');
            }
        } catch (deleteError) {
            logger.error(`Failed to delete resourcepacks folder: ${deleteError.message}`);
        }

        logger.info(`Extracting ZIP to: ${resourceRootPath}`);
        const zip = new AdmZip(zipBuffer);
        zip.extractAllTo(resourceRootPath, true); // overwrite = true
        logger.info('ZIP extracted successfully.');

        await fs.writeFile(localVersionFilePath, remoteVersion, 'utf-8');
        logger.info(`Local resource version updated to: ${remoteVersion}`);

        return true;

    } catch (error) {
        logger.error('Failed to check or apply resource update:', error.message);
        return false;
    }
}

/**
 * 게임 프로세스 시작
 */
async function startGame(versionIdToLaunch, authParams) {
    const mcRoot = getMinecraftRootPath();
    log.info(`Attempting to launch Minecraft version: ${versionIdToLaunch} from ${mcRoot}`);
    const minecraftLocation = new MinecraftFolder(mcRoot);
    const currentJavaPath = await ensureJavaPath(minecraftLocation);

    const config = ConfigManager.getConfig();
    let gameSettings = config?.settings?.game;

    if (!gameSettings) {
        log.warn('Game settings not found. Using defaults.');
        gameSettings = {
            minMemoryMB: 1024,
            maxMemoryMB: 4096,
            resWidth: 1280,
            resHeight: 720,
            fullscreen: false,
        };
    }

    const minMemory = typeof gameSettings.minMemoryMB === 'number' && gameSettings.minMemoryMB >= 512 ? gameSettings.minMemoryMB : 1024;
    const maxMemory = typeof gameSettings.maxMemoryMB === 'number' && gameSettings.maxMemoryMB >= 1024 ? gameSettings.maxMemoryMB : 4096;
    const gameResolutionWidth = typeof gameSettings.resWidth === 'number' && gameSettings.resWidth >= 800 ? gameSettings.resWidth : undefined;
    const gameResolutionHeight = typeof gameSettings.resHeight === 'number' && gameSettings.resHeight >= 600 ? gameSettings.resHeight : undefined;
    const fullscreen = typeof gameSettings.fullscreen === 'boolean' ? gameSettings.fullscreen : false;

    log.info(`Applying game settings - Min: ${minMemory}MB, Max: ${maxMemory}MB, Fullscreen: ${fullscreen}`);

    const launchOptions = {
        version: versionIdToLaunch,
        gamePath: minecraftLocation.root,
        javaPath: currentJavaPath,
        userType: authParams.userType,
        accessToken: authParams.accessToken,
        gameProfile: authParams.gameProfile,
        properties: authParams.properties,
        minMemory: minMemory,
        maxMemory: maxMemory,
        resolution: { width: gameResolutionWidth, height: gameResolutionHeight, fullscreen: fullscreen },
        extraExecOption: { detached: true, stdio: 'ignore' }
    };

    log.info('Launching Minecraft with options (token hidden).');
    const process = await launch(launchOptions);

    log.info(`Minecraft process started with PID: ${process.pid}`);
    if (process && typeof process.unref === 'function') {
        process.unref();
    }
    process.on('error', (err) => { log.error(`Minecraft process error:`, err); });
    process.on('exit', (code, signal) => { log.info(`Minecraft process exited with code ${code}, signal ${signal}`); });

    return process;
}

// --- 메인 실행 함수 ---
async function launchMinecraftGame(windowToUpdate) {
    if (!windowToUpdate || typeof windowToUpdate.webContents?.send !== 'function') {
        log.error('[launchMinecraftGame] Invalid window object provided.');
        // UI가 없더라도 백그라운드에서 진행될 수도 있으므로 return은 하지 않음 (상황에 따라 결정)
    }
    targetWindowForProgress = windowToUpdate;
    
    sendProgressUpdate('launch-progress-start', { title: '게임 실행 준비' });
    
    // 전체 진행률 단계 가중치 설정 (총합 100)
    const STAGE_WEIGHTS = {
        INIT: 5,
        AUTH: 5,
        INSTALL_CHECK: 60, // 다운로드/설치 (가장 큼)
        CUSTOM_RESOURCE_UPDATE: 15,
        PRE_LAUNCH: 5,
        GAME_STARTING: 10
    };

    let overallProgress = 0;

    try {
        log.info('Starting Minecraft launch sequence...');

        // 1. 초기화
        overallProgress = STAGE_WEIGHTS.INIT;
        sendProgressUpdate('launch-progress-update', { message: '설정 확인 중...', progress: overallProgress, taskKey: 'init' });
        if (!ConfigManager.isLoaded()) throw new Error('ConfigManager is not loaded.');

        // 2. 인증
        overallProgress += STAGE_WEIGHTS.AUTH;
        sendProgressUpdate('launch-progress-update', { message: '계정 인증 중...', progress: overallProgress, taskKey: 'auth' });
        const authParams = await getAuthParametersForLaunch();

        // 3. 설치 확인 (바닐라/네오포지/종속성)
        sendProgressUpdate('launch-progress-update', { message: '게임 파일 설치 확인 중...', progress: overallProgress, taskKey: 'install-check-start' });
        
        const versionIdToLaunch = await ensureMinecraftAndNeoForgeInstalled(
            MINECRAFT_VERSION_TARGET,
            NEOFORGE_PROJECT,
            NEOFORGE_VERSION,
            overallProgress, // 현재 누적 진행률
            STAGE_WEIGHTS.INSTALL_CHECK // 이 단계의 총 가중치
        );
        overallProgress += STAGE_WEIGHTS.INSTALL_CHECK;

        // 4. 커스텀 리소스 업데이트
        sendProgressUpdate('launch-progress-update', { message: '리소스 업데이트 확인 중...', progress: overallProgress, taskKey: 'custom-resource-update-check' });
        const gameRootPath = getMinecraftRootPath();
        const updateSuccessful = await checkAndApplyResourceUpdate(
            gameRootPath,
            log,
            LOCAL_VERSION_FILE_NAME,
            RESOURCE_VERSION_URL,
            RESOURCE_ZIP_URL
        );
        overallProgress += STAGE_WEIGHTS.CUSTOM_RESOURCE_UPDATE;

        if (!updateSuccessful) {
            log.warn('Resource update skipped or failed.');
            sendProgressUpdate('launch-progress-update', { message: '리소스 업데이트 건너뜀', progress: overallProgress, taskKey: 'custom-resource-update-result', isWarning: true });
        } else {
            sendProgressUpdate('launch-progress-update', { message: '리소스 업데이트 완료', progress: overallProgress, taskKey: 'custom-resource-update-result' });
        }

        // 5. 실행 준비 및 실행
        overallProgress += STAGE_WEIGHTS.PRE_LAUNCH;
        sendProgressUpdate('launch-progress-update', { message: '게임 실행 준비 중...', progress: overallProgress, taskKey: 'pre-launch' });
        
        const mcProcess = await startGame(versionIdToLaunch, authParams);

        if (mcProcess && mcProcess.pid) {
            log.info(`Minecraft process (PID: ${mcProcess.pid}) launched.`);
            overallProgress = 100;
            sendProgressUpdate('launch-progress-update', {
                title: '게임 실행 준비 완료!',
                message: '게임이 곧 시작됩니다.',
                progress: overallProgress,
                details: `PID: ${mcProcess.pid}`,
                taskKey: 'game-starting'
            });
            sendProgressUpdate('launch-progress-complete', { success: true, message: '게임 실행 성공' });
            return { success: true, message: 'Minecraft launched.', launchedPID: mcProcess.pid };
        } else {
            throw new Error('게임 프로세스를 시작하지 못했습니다.');
        }

    } catch (error) {
        log.error('Minecraft launch sequence failed:', error);

        // "알 수 없는 오류" 방지를 위해 에러 상세 내용을 문자열로 변환
        const detailedError = error.message || JSON.stringify(error, Object.getOwnPropertyNames(error)) || 'Unknown error occurred';
        let displayMessage = `게임 실행 실패: ${detailedError}`;

        // 사용자에게 보여줄 메시지 정제
        if (detailedError.includes('ETIMEDOUT')) displayMessage = '네트워크 연결 시간 초과. 인터넷 상태를 확인해주세요.';
        if (detailedError.includes('429')) displayMessage = '다운로드 요청이 너무 많습니다 (Dropbox 제한). 잠시 후 다시 시도해주세요.';

        sendProgressUpdate('launch-progress-complete', {
            success: false,
            message: displayMessage,
            error: detailedError,
            progress: overallProgress
        });
        return { success: false, message: displayMessage };
    }
}

module.exports = {
    launchMinecraftGame,
};
