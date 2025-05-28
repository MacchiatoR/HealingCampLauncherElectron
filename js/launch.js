
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
let targetWindowForProgress = null;

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
        if (JAVA_PATH_CACHE) return JAVA_PATH_CACHE;
    }
    JAVA_PATH_CACHE = undefined;

    log.info('Attempting to find suitable Java installation (Version 17+)...');
    let foundJavaPath = null;

    // 개선된 버전 파싱 함수
    const parseMajorJavaVersion = (versionString) => {
        if (!versionString || typeof versionString !== 'string') return 0;
        // "17.0.1+9", "21-ea", "1.8.0_291" 등 다양한 형식 처리
        const match = versionString.match(/^(\d+)(\.\d+)*([.-_]\d+)*([+-].*)?$/);
        if (!match) return 0;
        let major = parseInt(match[1]) || 0;
        // 1.8.x 같은 형식 처리
        if (major === 1 && versionString.startsWith('1.')) {
            const parts = versionString.split(/[.-_]/);
            major = parseInt(parts[1]) || 0;
        }
        return major;
    };

    // Java 경로를 테스트하는 헬퍼 함수
    const testJavaPath = async (javaExePath, source) => {
        if (!fs.existsSync(javaExePath)) {
            log.warn(`Java executable not found at ${javaExePath} (Source: ${source})`);
            return null;
        }
        try {
            log.info(`Testing Java at: ${javaExePath} (Source: ${source})`);
            const javaInfo = await resolveJava(javaExePath);
            if (javaInfo && javaInfo.path && javaInfo.version) {
                const majorVersion = parseMajorJavaVersion(javaInfo.version);
                log.info(`Resolved Java: Path=${javaInfo.path}, Version=${javaInfo.version}, Major=${majorVersion}`);
                if (majorVersion >= 17) {
                    log.info(`Found SUITABLE Java: Path=${javaInfo.path}, Version=${javaInfo.version} (Source: ${source})`);
                    return javaInfo.path;
                } else {
                    log.warn(`Java at ${javaInfo.path} has version ${javaInfo.version} (Major ${majorVersion}) < 17 (Source: ${source})`);
                }
            } else {
                log.warn(`Java at ${javaExePath} resolved but missing path/version info: ${JSON.stringify(javaInfo)} (Source: ${source})`);
            }
        } catch (e) {
            log.warn(`Failed to resolve Java at ${javaExePath}: ${e.message} (Source: ${source})`);
        }
        return null;
    };

    try {
        // 1. @xmcl/installer로 잠재적 Java 위치 탐색
        const potentialLocations = await getPotentialJavaLocations();
        if (potentialLocations && potentialLocations.length > 0) {
            log.info('Potential Java locations from @xmcl/installer:', potentialLocations);
            for (const loc of potentialLocations) {
                let javaExeToTest = loc;
                if (!loc.toLowerCase().endsWith('java.exe') && !loc.toLowerCase().endsWith('java')) {
                    const platformSpecificPath = process.platform === 'win32' ? path.join(loc, 'bin', 'java.exe') : path.join(loc, 'bin', 'java');
                    if (fs.existsSync(platformSpecificPath)) {
                        javaExeToTest = platformSpecificPath;
                    } else {
                        const rootJavaExe = process.platform === 'win32' ? path.join(loc, 'java.exe') : path.join(loc, 'java');
                        if (fs.existsSync(rootJavaExe)) javaExeToTest = rootJavaExe;
                    }
                }
                foundJavaPath = await testJavaPath(javaExeToTest, '@xmcl/installer');
                if (foundJavaPath) break;
            }
        } else {
            log.warn('No potential Java locations found by @xmcl/installer.');
        }

        // 2. JAVA_HOME 환경 변수 확인
        if (!foundJavaPath) {
            const javaHome = process.env.JAVA_HOME;
            if (javaHome) {
                const javaExePath = process.platform === 'win32' ? path.join(javaHome, 'bin', 'java.exe') : path.join(javaHome, 'bin', 'java');
                foundJavaPath = await testJavaPath(javaExePath, 'JAVA_HOME');
            } else {
                log.info('JAVA_HOME environment variable is not set.');
            }
        }

        // 3. 시스템 PATH에서 Java 탐색
        if (!foundJavaPath) {
            const pathEnv = process.env.PATH || process.env.Path || '';
            const pathEntries = pathEnv.split(process.platform === 'win32' ? ';' : ':');
            for (const entry of pathEntries) {
                if (!entry) continue;
                const javaExePath = process.platform === 'win32' ? path.join(entry, 'java.exe') : path.join(entry, 'java');
                foundJavaPath = await testJavaPath(javaExePath, 'System PATH');
                if (foundJavaPath) break;
            }
        }

        // 4. 일반적인 Java 설치 경로 확인
        if (!foundJavaPath) {
            const commonLocations = [];
            if (process.platform === 'win32') {
                commonLocations.push('C:\\Program Files\\Java', 'C:\\Program Files (x86)\\Java');
            } else if (process.platform === 'darwin') {
                commonLocations.push('/Library/Java/JavaVirtualMachines', '/usr/lib/jvm');
            } else {
                commonLocations.push('/usr/lib/jvm', '/opt/java');
            }

            for (const baseDir of commonLocations) {
                if (!fs.existsSync(baseDir)) continue;
                const subDirs = fs.readdirSync(baseDir, { withFileTypes: true })
                    .filter(dirent => dirent.isDirectory())
                    .map(dirent => path.join(baseDir, dirent.name));
                for (const subDir of subDirs) {
                    const javaExePath = process.platform === 'win32' ? path.join(subDir, 'bin', 'java.exe') : path.join(subDir, 'bin', 'java');
                    foundJavaPath = await testJavaPath(javaExePath, `Common Location (${baseDir})`);
                    if (foundJavaPath) break;
                }
                if (foundJavaPath) break;
            }
        }

        if (foundJavaPath) {
            JAVA_PATH_CACHE = foundJavaPath;
            return foundJavaPath;
        }

        log.error("Suitable Java installation (Version 17+) not found after exhaustive search.");
        throw new Error("Could not find a suitable Java 17+ installation. Please install Java 17 or higher and ensure it's in your PATH, or configure the Java path manually.");

    } catch (e) {
        log.error(`Error during Java path detection: ${e.message}`);
        if (e.stack) log.error("Stack trace for Java detection error:", e.stack);
        if (e.message.includes("Could not find a suitable Java 17+")) throw e;
        throw new Error(`Java detection failed: ${e.message}. Please ensure Java 17+ is installed and accessible.`);
    }
}

/**
 * 마인크래프트 및 포지 설치/확인
 * @param {string} targetMcVersion 바닐라 마인크래프트 버전
 * @param {string} targetForgeMcVersion 포지가 대상하는 마인크래프트 버전 (예: "1.20.1")
 * @param {string} targetForgeBuild 포지 빌드 번호 (예: "47.2.0")
 * @returns {Promise<string>} 실행할 최종 버전 ID
 */
async function ensureMinecraftAndForgeInstalled(targetMcVersion, targetForgeMcVersion, targetForgeBuild, initialProgress, totalWeightForThisStep) {
    const mcRoot = getMinecraftRootPath();
    log.info(`Ensuring Minecraft & Forge at ${mcRoot}...`);
    const minecraftLocation = new MinecraftFolder(mcRoot);
    const currentJavaPath = await ensureJavaPath(minecraftLocation); // Java 경로는 별도 진행률 없음 (필요시 추가)
    const commonInstallOptions = { side: 'client', timeout: DOWNLOAD_TIMEOUT, retries: 3 };

    // 이 단계의 가중치를 바닐라 설치와 포지/종속성 설치로 나눔
    const vanillaInstallWeight = targetForgeBuild ? Math.floor(totalWeightForThisStep * 0.4) : totalWeightForThisStep;
    const forgeAndDepsWeight = targetForgeBuild ? totalWeightForThisStep - vanillaInstallWeight : 0;

    // 1. 바닐라 마인크래프트 설치
    const versionList = await getVersionList();
    const vanillaVersionMeta = versionList.versions.find(v => v.id === targetMcVersion);
    if (!vanillaVersionMeta) throw new Error(`Vanilla metadata for ${targetMcVersion} not found.`);
    const vanillaInstallOp = installTask(vanillaVersionMeta, minecraftLocation, commonInstallOptions);
    const resolvedVanillaVersion = await runTaskWithProgress(vanillaInstallOp, `바닐라 (${targetMcVersion}) 설치`, initialProgress, vanillaInstallWeight, 'install-vanilla');
    let currentOverallProgress = initialProgress + vanillaInstallWeight;
    let versionIdToLaunch = resolvedVanillaVersion.id;

    // 2. 포지 설치
    if (targetForgeMcVersion && targetForgeBuild) {
        const forgeVersionMetaForTask = { mcversion: targetForgeMcVersion, version: targetForgeBuild };
        const forgeSpecificInstallOptions = { java: currentJavaPath, ...commonInstallOptions };
        const forgeInstallWeight = Math.floor(forgeAndDepsWeight * 0.6);
        const forgeDepsWeight = forgeAndDepsWeight - forgeInstallWeight;

        const forgeInstallOp = installForgeTask(forgeVersionMetaForTask, minecraftLocation, forgeSpecificInstallOptions);
        const installedForgeId = await runTaskWithProgress(forgeInstallOp, `포지 (${targetForgeBuild}) 설치`, currentOverallProgress, forgeInstallWeight, 'install-forge');
        currentOverallProgress += forgeInstallWeight;

        const resolvedForgeVersionAfterInstall = await Version.parse(minecraftLocation, installedForgeId);
        const depsInstallOp = installDependenciesTask(resolvedForgeVersionAfterInstall, commonInstallOptions);
        await runTaskWithProgress(depsInstallOp, `포지 종속성 설치 (${installedForgeId})`, currentOverallProgress, forgeDepsWeight, 'install-forge-deps');
        versionIdToLaunch = installedForgeId;
    } else {
        // 바닐라 종속성 (이미 vanillaInstallWeight가 totalWeightForThisStep 전체를 차지했으므로 추가 가중치 없음, 또는 세분화)
        const vanillaDepsOp = installDependenciesTask(resolvedVanillaVersion, commonInstallOptions);
        // 바닐라 종속성은 바닐라 설치의 일부로 간주하거나, 매우 작은 가중치를 줄 수 있음
        await runTaskWithProgress(vanillaDepsOp, `바닐라 종속성 설치 (${resolvedVanillaVersion.id})`, currentOverallProgress, 0, 'install-vanilla-deps');
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
async function checkAndApplyResourceUpdate(resourceRootPath, logger, localVersionFileName, remoteVersionUrl, remoteZipUrl) { // 인자 이름을 명확히 하고, logger를 받도록 수정
    logger.info('Checking for resource updates...'); // 전달받은 logger 사용
    const localVersionFilePath = path.join(resourceRootPath, localVersionFileName); // 전달받은 파일 이름 사용
    let localVersion = '0';

    try {
        // fs는 const fs = require('fs-extra'); 로 정의된 것을 사용합니다.
        if (fs.existsSync(localVersionFilePath)) { // fs-extra의 existsSync 사용
            localVersion = (await fs.readFile(localVersionFilePath, 'utf-8')).trim();
            logger.info(`Local resource version: ${localVersion}`);
        } else {
            logger.info('No local resource version file found. Assuming version 0.');
        }

        logger.info(`Fetching remote resource version from: ${remoteVersionUrl}`); // 전달받은 URL 사용
        const response = await axios.get(remoteVersionUrl, { timeout: 5000 });
        const remoteVersion = response.data.toString().trim();
        logger.info(`Remote resource version: ${remoteVersion}`);

        if (localVersion === remoteVersion) {
            logger.info('Resources are up to date. No update needed.');
            return true;
        }

        logger.info(`Update required: Local version ${localVersion} -> Remote version ${remoteVersion}`);

        logger.info(`Downloading resource ZIP from: ${remoteZipUrl}`); // 전달받은 URL 사용
        const zipResponse = await axios({
            method: 'get',
            url: remoteZipUrl,
            responseType: 'arraybuffer',
            timeout: 300000
        });
        const zipBuffer = Buffer.from(zipResponse.data);
        logger.info('Resource ZIP downloaded successfully.');

        const modsFolderPath = path.join(resourceRootPath, 'mods');
        try {
            if (fs.existsSync(modsFolderPath)) { // fs-extra의 existsSync 사용
                logger.info(`Deleting existing mods folder: ${modsFolderPath}`);
                await fs.remove(modsFolderPath); // fs-extra의 remove 함수 사용 (재귀적 삭제, 없어도 오류 X)
                logger.info('Mods folder deleted successfully.');
            } else {
                logger.info('Mods folder not found, no deletion needed.');
            }
        } catch (deleteError) {
            logger.error(`Failed to delete mods folder: ${modsFolderPath}. Error: ${deleteError.message}`);
            // return false; // 필요시 주석 해제하여 업데이트 중단
        }
        const resourcePacksFolderPath = path.join(resourceRootPath, 'resourcepacks');
        try {
            if (fs.existsSync(resourcePacksFolderPath)) { // fs-extra의 existsSync 사용
                logger.info(`Deleting existing resourcePacksFolder folder: ${resourcePacksFolderPath}`);
                await fs.remove(resourcePacksFolderPath); // fs-extra의 remove 함수 사용 (재귀적 삭제, 없어도 오류 X)
                logger.info('ResourcePacksFolder folder deleted successfully.');
            } else {
                logger.info('ResourcePacksFolder folder not found, no deletion needed.');
            }
        } catch (deleteError) {
            logger.error(`Failed to delete resourcepacks folder: ${resourcePacksFolderPath}. Error: ${deleteError.message}`);
            // return false; // 필요시 주석 해제하여 업데이트 중단
        }

        logger.info(`Extracting ZIP to: ${resourceRootPath} (overwrite enabled)`);
        const zip = new AdmZip(zipBuffer);
        zip.extractAllTo(resourceRootPath, true /* overwrite */);
        logger.info('ZIP extracted successfully.');

        await fs.writeFile(localVersionFilePath, remoteVersion, 'utf-8'); // fs-extra의 writeFile 사용
        logger.info(`Local resource version updated to: ${remoteVersion}`);

        return true;

    } catch (error) {
        logger.error('Failed to check or apply resource update:', error.message);
        if (error.isAxiosError) {
            logger.error('Axios error details:', {
                url: error.config?.url,
                method: error.config?.method,
                status: error.response?.status,
                // data: error.response?.data, // 데이터가 너무 크면 로그 생략 고려
            });
        }
        return false;
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
    if (targetWindowForProgress && !targetWindowForProgress.isDestroyed()) {
        targetWindowForProgress.webContents.send(eventChannel, data);
    } else {
        log.warn(`[GameLauncher - sendProgressUpdate] Target window for progress is not available or destroyed. Channel: ${eventChannel}`);
    }
}

/**
 * Task 실행 및 진행률 로깅 + IPC 전송을 위한 헬퍼 함수
 * @param {import('@xmcl/task').Task<any>} taskInstance 실행할 xmcl Task 객체
 * @param {string} taskDescription 로깅 및 모달 메시지용 작업 설명
 * @param {string} overallTaskKey 전체 작업 단계를 구분하는 키 (선택적)
 * @returns {Promise<any>} Task의 결과값
 */
async function runTaskWithProgress(taskInstance, taskDescription, baseProgress, taskWeight, overallTaskKey = 'generic-task') {
    log.info(`Starting task: ${taskDescription} (Path: ${taskInstance.path || 'N/A'})`);
    // 태스크 시작 시, baseProgress + 0% 로 업데이트
    sendProgressUpdate('launch-progress-update', {
        message: `${taskDescription} 시작 중...`,
        progress: baseProgress, // 이 태스크의 시작점 진행률
        details: `Task: ${taskInstance.name || taskDescription}`,
        taskKey: overallTaskKey
    });

    let lastLoggedProgress = -1;
    let lastSentOverallProgress = baseProgress;

    try {
        const result = await taskInstance.startAndWait({
            onStart(task) {
                log.info(` -> Sub-task started: ${task.name || 'Unnamed Subtask'} (Path: ${task.path})`);
                sendProgressUpdate('launch-progress-update', {
                    message: taskDescription,
                    details: `진행 중: ${task.path || task.name || '세부 작업'}`,
                    progress: baseProgress + (taskInstance.total > 0 ? Math.round((taskInstance.progress / taskInstance.total) * taskWeight * 0.01) : 0),
                    taskKey: overallTaskKey
                });
            },
            onUpdate(task, chunkSize) {
                if (taskInstance.total > 0) {
                    const taskProgressPercent = (taskInstance.progress / taskInstance.total); // 현재 태스크의 진행률 (0 ~ 1)
                    const currentOverallProgress = Math.round(baseProgress + (taskProgressPercent * taskWeight));

                    if (currentOverallProgress !== lastSentOverallProgress && currentOverallProgress % 2 === 0) { // 2% 단위로 IPC (너무 잦지 않게)
                        sendProgressUpdate('launch-progress-update', {
                            message: taskDescription,
                            progress: currentOverallProgress,
                            details: `다운로드 중: ${task.path || task.name || '파일'}... (${Math.round(taskProgressPercent*100)}%)`,
                            taskKey: overallTaskKey
                        });
                        lastSentOverallProgress = currentOverallProgress;
                    }
                    if (currentOverallProgress % 5 === 0 && currentOverallProgress !== lastLoggedProgress) { // 5% 단위로 로그
                        log.info(` -> Overall task [${taskDescription}] (sub-task) progress: ${Math.round(taskProgressPercent*100)}%, Total progress: ${currentOverallProgress}%`);
                        lastLoggedProgress = currentOverallProgress;
                    }
                }
            },
            onFailed(task, error) { /* ... 이전과 동일 (progress는 lastSentOverallProgress 사용) ... */
                log.error(` -> Sub-task failed: ${task.name || 'Unnamed Subtask'} (Path: ${task.path})`, error);
                sendProgressUpdate('launch-progress-update', {
                    message: `${taskDescription} 중 오류 발생`,
                    progress: lastSentOverallProgress,
                    details: `오류: ${task.name || '세부 작업'} - ${error.message}`,
                    isError: true,
                    taskKey: overallTaskKey
                });
            },
            onSucceed(task, taskResult) { /* ... 이전과 동일 ... */ },
        });
        log.info(`Task completed: ${taskDescription}`);
        // 태스크 완료 시, 이 태스크에 할당된 가중치만큼 진행률을 더함
        sendProgressUpdate('launch-progress-update', {
            message: `${taskDescription} 완료!`,
            progress: baseProgress + taskWeight,
            details: `완료: ${taskDescription}`,
            taskKey: overallTaskKey
        });
        return result;
    } catch (error) {
        log.error(`Error during task execution [${taskDescription}]:`, error);
        sendProgressUpdate('launch-progress-update', {
            message: `${taskDescription} 실패`,
            progress: lastSentOverallProgress, // 실패 시 이전 진행률
            details: `실패: ${error.message}`,
            isError: true,
            taskKey: overallTaskKey
        });
        throw error;
    }
}
// --- 메인 실행 함수 ---
async function launchMinecraftGame(windowToUpdate) {
    if (!windowToUpdate || typeof windowToUpdate.webContents?.send !== 'function') {
        log.error('[launchMinecraftGame] Invalid window object provided for progress updates.');
        // 오류 처리가 필요합니다. 여기서는 간단히 로그만 남기고 진행하지만,
        // 실제로는 오류를 throw하거나, 진행률 업데이트 없이 진행할지 결정해야 합니다.
    }
    targetWindowForProgress = windowToUpdate; // 함수 스코프 변수에 할당
    
    sendProgressUpdate('launch-progress-start', { title: '게임 실행 준비' });
    let overallProgress = 0;

    try {
        log.info('Starting Minecraft launch sequence...');
        // 단계별 예상 진행률 가중치 (총합 100 기준, 조절 가능)
        const STAGE_WEIGHTS = {
            INIT: 5,
            AUTH: 5,
            INSTALL_CHECK: 60, // 가장 오래 걸리는 부분
            CUSTOM_RESOURCE_UPDATE: 15,
            PRE_LAUNCH: 5,
            GAME_STARTING_MESSAGE: 10 // 게임 시작 직전 메시지까지
        };

        overallProgress = STAGE_WEIGHTS.INIT;
        sendProgressUpdate('launch-progress-update', { message: '설정 및 계정 정보 확인 중...', progress: overallProgress, taskKey: 'init' });
        if (!ConfigManager.isLoaded()) { throw new Error('ConfigManager is not loaded.'); }

        overallProgress += STAGE_WEIGHTS.AUTH;
        sendProgressUpdate('launch-progress-update', { message: '인증 정보 확인 중...', progress: overallProgress, taskKey: 'auth' });
        const authParams = await getAuthParametersForLaunch();

        sendProgressUpdate('launch-progress-update', { message: '게임 파일 설치 확인 중...', progress: overallProgress, taskKey: 'install-check-start' });
        const versionIdToLaunch = await ensureMinecraftAndForgeInstalled(
            MINECRAFT_VERSION_TARGET,
            FORGE_MC_VERSION,
            FORGE_BUILD_VERSION,
            overallProgress, // 현재까지의 전체 진행률
            STAGE_WEIGHTS.INSTALL_CHECK // 이 단계에 할당된 가중치
        );
        overallProgress += STAGE_WEIGHTS.INSTALL_CHECK; // 설치 단계 완료 후 진행률 업데이트
        // ensureMinecraftAndForgeInstalled 내부에서 runTaskWithProgress가 세부 진행률 IPC를 보냄

        sendProgressUpdate('launch-progress-update', { message: '커스텀 리소스 업데이트 확인 중...', progress: overallProgress, taskKey: 'custom-resource-update-check' });
        const gameRootPath = getMinecraftRootPath();
        // --- 수정된 호출 부분 ---
        const updateSuccessful = await checkAndApplyResourceUpdate(
            gameRootPath,
            log, // launch.js에 정의된 log 객체 전달
            LOCAL_VERSION_FILE_NAME, // launch.js에 정의된 상수 전달
            RESOURCE_VERSION_URL,    // launch.js에 정의된 상수 전달
            RESOURCE_ZIP_URL         // launch.js에 정의된 상수 전달
        );
        // --- --- --- --- --- ---
        // checkAndApplyResourceUpdate 내부에서도 진행률 메시지 전송 가능 (여기서는 간단히 완료 후 업데이트)
        overallProgress += STAGE_WEIGHTS.CUSTOM_RESOURCE_UPDATE;
        if (!updateSuccessful) {
            log.warn('Resource update failed or was skipped.');
            sendProgressUpdate('launch-progress-update', { message: '커스텀 리소스 업데이트 실패 또는 생략됨.', progress: overallProgress, taskKey: 'custom-resource-update-result', isWarning: true });
        } else {
            sendProgressUpdate('launch-progress-update', { message: '커스텀 리소스 업데이트 완료.', progress: overallProgress, taskKey: 'custom-resource-update-result' });
        }

        overallProgress += STAGE_WEIGHTS.PRE_LAUNCH;
        sendProgressUpdate('launch-progress-update', { message: '게임 실행 준비 중...', progress: overallProgress, taskKey: 'pre-launch' });
        const mcProcess = await startGame(versionIdToLaunch, authParams);

        if (mcProcess && mcProcess.pid) {
            log.info(`Minecraft process (PID: ${mcProcess.pid}) has been launched.`);
            overallProgress = 100; // 최종 단계
            sendProgressUpdate('launch-progress-update', {
                title: '게임 실행 준비 완료!',
                message: '곧 게임이 시작됩니다...',
                progress: overallProgress,
                details: `게임 프로세스 ID: ${mcProcess.pid}`,
                taskKey: 'game-starting'
            });
            sendProgressUpdate('launch-progress-complete', { success: true, message: '게임이 성공적으로 실행되었습니다.' });
            return { success: true, message: 'Minecraft launched.', launchedPID: mcProcess.pid };
        } else {
            throw new Error('게임 실행 후 프로세스 정보를 가져오지 못했습니다.');
        }
    } catch (error) {
        log.error('Minecraft launch sequence failed:', error.message);
        let displayMessage = `게임 실행 실패: ${error.message || '알 수 없는 오류'}`;
        // ... (displayMessage 생성 로직) ...
        log.error('Detailed error stack for launch failure:', error.stack);
        sendProgressUpdate('launch-progress-complete', {
            success: false,
            message: displayMessage,
            error: error.message,
            progress: overallProgress // 실패 시점의 진행률
        });
        return { success: false, message: displayMessage };
    }
}

module.exports = {
    launchMinecraftGame,
};