
// launch.js (또는 main.js의 일부)
const { launch, Version, diagnose, LaunchOption, MinecraftFolder } = require('@xmcl/core');
const {
    installTask,
    installForgeTask,
    installDependenciesTask,
    getVersionList,
    getPotentialJavaLocations, // <<--- 추가
    resolveJava,               // <<--- 추가
    scanLocalJava,             // <<--- 추가 (또는 getSuitableJava와 유사한 더 고수준 함수가 있다면 그것 사용)
    // DEFAULT_FORGE_MAVEN // 필요시 사용
} = require('@xmcl/installer');
const { getSuitableJava } = require('@xmcl/system'); // Java 경로 찾기
// const { Task, TaskContext } = require('@xmcl/task'); // TaskContext는 startAndWait의 인자로 직접 객체 리터럴 사용 가능

const path = require('path');
const os = require('os');
const fs = require('fs-extra');
const { app } = require('electron');

const ConfigManager = require('./confighandler'); // 가정: ConfigManager는 별도로 존재
const AuthHandler = require('./authhandler');   // 가정: AuthHandler는 별도로 존재 (토큰 갱신 등)

const log = {
    info: (message, ...args) => console.log(`[GameLauncher] [INFO] ${new Date().toISOString()} ${message}`, ...args),
    error: (message, ...args) => console.error(`[GameLauncher] [ERROR] ${new Date().toISOString()} ${message}`, ...args),
    warn: (message, ...args) => console.warn(`[GameLauncher] [WARN] ${new Date().toISOString()} ${message}`, ...args),
};

// --- 설정 ---
const MINECRAFT_VERSION_TARGET = '1.20.1';
// 중요: 실제 사용할 정확한 포지 버전 문자열로 교체하세요. (예: '1.20.1-47.2.17')
const FORGE_MC_VERSION = '1.20.1';
const FORGE_BUILD_VERSION = '47.4.0';
const MINECRAFT_ROOT_PATH = path.join(app.getPath('appData'), '.instance_HealingcampLauncher'); // 데이터 저장 경로
let JAVA_PATH_CACHE = undefined; // Java 경로 캐시

// --- Minecraft 루트 경로 지연 초기화 및 원하는 경로로 설정 ---
let minecraftRootPathSingleton = null;
function getMinecraftRootPath() { // <<--- 이 함수는 여기에 정의되어 있습니다.
    if (!minecraftRootPathSingleton) {
        // ... (경로 초기화 로직) ...
        minecraftRootPathSingleton = path.join(app.getPath('appData'), '.instance_HealingcampLauncher');
        log.info(`Minecraft root path initialized to: ${minecraftRootPathSingleton}`);
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

        // 방법 2: scanLocalJava 사용 (문서상 JAVA_HOME과 같은 디렉토리를 스캔한다고 되어 있음)
        // 이 방법이 더 적합할 수 있으나, getPotentialJavaLocations와 어떻게 다른지 확인 필요.
        // const scannedJava = await scanLocalJava([]); // 빈 배열을 주면 기본 위치를 스캔할 수도 있음 (문서 확인)
        // if (scannedJava && scannedJava.length > 0) {
        //     for (const javaInfo of scannedJava) {
        //         if (javaInfo.version && parseInt(javaInfo.version.split('.')[0]) >= 17) {
        //             JAVA_PATH_CACHE = javaInfo.path; // javaInfo.path가 실행 파일 경로인지 확인
        //             log.info(`Found suitable Java via scanLocalJava: ${JAVA_PATH_CACHE} (Version: ${javaInfo.version})`);
        //             return JAVA_PATH_CACHE;
        //         }
        //     }
        // }


        // 위 방법들로 못 찾았다면, 직접 지정된 경로 확인 (이 부분은 이제 불필요할 수 있음)
        // if (process.env.JAVA_HOME) {
        //     const javaHomePath = path.join(process.env.JAVA_HOME, 'bin', os.platform() === 'win32' ? 'java.exe' : 'java');
        //     if (fs.existsSync(javaHomePath)) {
        //         const javaInfo = await resolveJava(javaHomePath);
        //         if (javaInfo && parseInt(javaInfo.version.split('.')[0]) >= 17) {
        //             JAVA_PATH_CACHE = javaHomePath;
        //             log.info(`Using Java from JAVA_HOME: ${JAVA_PATH_CACHE}`);
        //             return JAVA_PATH_CACHE;
        //         }
        //     }
        // }

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
    await fs.ensureDir(minecraftLocation.root);

    const currentJavaPath = await ensureJavaPath(minecraftLocation);

    // 1. 바닐라 마인크래프트 설치 (이전과 동일)
    const versionList = await getVersionList();
    const vanillaVersionMeta = versionList.versions.find(v => v.id === targetMcVersion);
    if (!vanillaVersionMeta) throw new Error(`Vanilla Minecraft version metadata for ${targetMcVersion} not found.`);
    log.info(`Checking/Installing Vanilla Minecraft ${targetMcVersion}...`);
    const vanillaInstallOp = installTask(vanillaVersionMeta, minecraftLocation, { side: 'client' });
    const resolvedVanillaVersion = await runTaskWithProgress(vanillaInstallOp, `Install Vanilla ${targetMcVersion}`);
    log.info(`Vanilla Minecraft ${targetMcVersion} installed/verified. Resolved ID: ${resolvedVanillaVersion.id}`);
    let versionIdToLaunch = resolvedVanillaVersion.id;

    // 2. 포지 설치 (targetForgeBuild가 제공된 경우)
    if (targetForgeMcVersion && targetForgeBuild) {
        // installForgeTask의 첫 번째 인자로 RequiredVersion 객체 전달
        // installer 정보를 제공하지 않으면 xmcl이 기본 Maven 저장소에서 찾으려고 시도합니다.
        const forgeVersionMetaForTask = {
            mcversion: targetForgeMcVersion, // 예: "1.20.1"
            version: targetForgeBuild,     // 예: "47.2.0"
            // installer: undefined, // 또는 특정 installer 정보가 있다면 여기에 객체로 제공
                                   // { path: 'maven/net/minecraftforge/forge/1.20.1-47.2.0/forge-1.20.1-47.2.0-installer.jar', sha1: '...' }
                                   // 이 정보는 getForgeVersionList()가 반환하는 ForgeVersion 객체의 installer 속성에 해당합니다.
                                   // 이 정보가 없으면 xmcl이 URL을 추론합니다.
        };

        const forgeInstallOptions = {
            minecraft: minecraftLocation,
            java: currentJavaPath,
        };

        log.info(`Checking/Installing Forge (MC: ${targetForgeMcVersion}, ForgeBuild: ${targetForgeBuild})...`);
        log.info('Forge Install Task Input (versionMeta):', forgeVersionMetaForTask);
        log.info('Forge Install Options (otherOptions):', forgeInstallOptions);

        const forgeInstallOp = installForgeTask(forgeVersionMetaForTask, minecraftLocation, forgeInstallOptions);
        const installedForgeId = await runTaskWithProgress(forgeInstallOp, `Install Forge ${targetForgeMcVersion}-${targetForgeBuild}`);
        log.info(`Forge installation task completed. Installed Forge version ID: ${installedForgeId}`);

        log.info(`Ensuring dependencies for installed Forge version: ${installedForgeId}...`);
        const resolvedForgeVersionAfterInstall = await Version.parse(minecraftLocation, installedForgeId);
        const depsInstallOp = installDependenciesTask(resolvedForgeVersionAfterInstall, { side: 'client' });
        await runTaskWithProgress(depsInstallOp, `Install Dependencies for ${installedForgeId}`);

        log.info(`Forge ${installedForgeId} and its dependencies are installed.`);
        versionIdToLaunch = installedForgeId;
    } else {
        // 바닐라만 설치하는 경우 종속성 확인
        log.info(`Ensuring dependencies for Vanilla version: ${resolvedVanillaVersion.id}...`);
        const vanillaDepsOp = installDependenciesTask(resolvedVanillaVersion, { side: 'client' });
        await runTaskWithProgress(vanillaDepsOp, `Install Dependencies for Vanilla ${resolvedVanillaVersion.id}`);
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


// --- 메인 실행 함수 ---
async function launchMinecraftGame() {
    try {
        log.info('Starting Minecraft launch sequence...');
        const authParams = await getAuthParametersForLaunch(); // 수정된 함수 호출

        const versionIdToLaunch = await ensureMinecraftAndForgeInstalled(
            MINECRAFT_VERSION_TARGET,
            FORGE_MC_VERSION,
            FORGE_BUILD_VERSION
        );

        const mcProcess = await startGame(versionIdToLaunch, authParams); // 수정된 함수 호출

        if (mcProcess && mcProcess.pid) {
            log.info(`Minecraft process (PID: ${mcProcess.pid}) has been launched. Launcher will now exit.`);
            return { success: true, message: 'Minecraft launched. Exiting launcher.', launchedPID: mcProcess.pid };
        } else {
            log.warn('Minecraft launch initiated, but PID not found.');
            return { success: true, message: 'Minecraft launch initiated (PID unknown).', launchedPID: null };
        }
    } catch (error) {
        log.error('Minecraft launch sequence failed:', error.message, error.stack);
        return { success: false, message: `게임 실행 실패: ${error.message}` };
    }
}

module.exports = {
    launchMinecraftGame,
};