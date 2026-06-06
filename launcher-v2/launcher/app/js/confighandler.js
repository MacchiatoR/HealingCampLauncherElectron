      
// confighandler.js
let config = null;
// helios-core의 LoggerUtil을 사용하거나, main.js의 log 객체를 사용하도록 통일하는 것이 좋을 수 있습니다.
// 여기서는 helios-core의 것을 사용한다고 가정합니다.
const { LoggerUtil } = require('helios-core');
const logger = LoggerUtil.getLogger('ConfigManager'); // 클래스명처럼 사용
const fs = require('fs-extra');
const path = require('path');
const { app } = require('electron');

let userDataPath = null;
let configPathInternal = null;
let dataPathForLegacyInternal = null; // .helioslauncher 경로
let configPathLEGACYInternal = null;

function initializePaths() {
    if (!app || !app.isReady()) {
        const errMessage = 'ConfigManager paths cannot be initialized: Electron app is not ready.';
        console.error(`[ConfigManager] [ERROR] ${errMessage}`); // LoggerUtil이 아직 준비 안됐을 수 있음
        throw new Error(errMessage);
    }
    if (!userDataPath) { // 한 번만 초기화
        userDataPath = app.getPath('userData');
        configPathInternal = path.join(userDataPath, 'config.json');

        const sysRoot = process.env.APPDATA || (process.platform === 'darwin' ? process.env.HOME + '/Library/Application Support' : process.env.HOME);
        dataPathForLegacyInternal = path.join(sysRoot, '.helioslauncher');
        configPathLEGACYInternal = path.join(dataPathForLegacyInternal, 'config.json');
        console.log(`[ConfigManager] [INFO] Paths initialized: configPath=${configPathInternal}`);
    }
}

const DEFAULT_CONFIG = {
    settings: {
        game: { 
            resWidth: 1920, 
            resHeight: 1080, 
            fullscreen: false, 
            autoConnect: true, 
            launchDetached: true, 
            minMemoryMB: 6144, // <<--- 추가: 기본 최소 메모리
            maxMemoryMB: 6144  // <<--- 추가: 기본 최대 메모리},
        },
        launcher: { allowPrerelease: false, dataDirectory: null } // dataDirectory는 동적으로 설정
    },
    newsCache: { date: null, content: null, dismissed: false },
    clientToken: null,
    selectedServer: null,
    selectedAccount: null,
    authenticationDatabase: {},
    modConfigurations: [],
    javaConfig: {}
};

function validateKeySet(srcObj, destObj) {
    // ... (이전 코드와 동일) ...
    if(srcObj == null){
        srcObj = {}
    }
    const validationBlacklist = ['authenticationDatabase', 'javaConfig']
    const keys = Object.keys(srcObj)
    for(let i=0; i<keys.length; i++){
        if(typeof destObj[keys[i]] === 'undefined'){
            destObj[keys[i]] = srcObj[keys[i]]
        } else if(typeof srcObj[keys[i]] === 'object' && srcObj[keys[i]] != null && !(srcObj[keys[i]] instanceof Array) && validationBlacklist.indexOf(keys[i]) === -1){
            // Ensure sub-objects are also validated deeply
            destObj[keys[i]] = validateKeySet(srcObj[keys[i]], destObj[keys[i]] || {});
        }
    }
    return destObj
}

exports.load = function() {
    // load가 호출되는 시점에는 app이 ready 상태여야 함.
    // initializePaths()가 먼저 호출되었다고 가정하거나, 여기서 호출.
    if (!configPathInternal) { // 경로가 아직 초기화되지 않았다면
        initializePaths();   // 여기서 경로 초기화 시도
    }
    // DEFAULT_CONFIG의 dataDirectory를 동적으로 설정
    const dynamicDefaultConfig = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
    dynamicDefaultConfig.settings.launcher.dataDirectory = dataPathForLegacyInternal;


    let doLoad = true;
    // ... (이하 load 함수 로직은 이전과 유사하게, 단 configPathInternal, configPathLEGACYInternal 사용) ...
    if (!fs.existsSync(configPathInternal)) {
        logger.info(`Config file not found at ${configPathInternal}. Checking legacy path...`);
        fs.ensureDirSync(path.dirname(configPathInternal));
        if (fs.existsSync(configPathLEGACYInternal)) {
            logger.info(`Migrating legacy config from ${configPathLEGACYInternal} to ${configPathInternal}`);
            try {
                fs.moveSync(configPathLEGACYInternal, configPathInternal);
            } catch (moveErr) {
                logger.error('Failed to move legacy config, creating new default config:', moveErr);
                doLoad = false;
                config = JSON.parse(JSON.stringify(dynamicDefaultConfig));
                exports.save(); // save 호출 전 경로 초기화 보장 필요
            }
        } else {
            logger.info('No existing or legacy config file found. Creating default config.');
            doLoad = false;
            config = JSON.parse(JSON.stringify(dynamicDefaultConfig));
            exports.save();
        }
    }
    // ... (이하 JSON 파싱 및 validateKeySet 로직) ...
    if (doLoad) {
        let doValidate = false;
        try {
            logger.info(`Loading config from ${configPathInternal}`);
            config = JSON.parse(fs.readFileSync(configPathInternal, 'UTF-8'));
            doValidate = true;
        } catch (err) {
            logger.error('Error parsing config file, creating new default config:', err);
            fs.ensureDirSync(path.dirname(configPathInternal));
            config = JSON.parse(JSON.stringify(dynamicDefaultConfig));
            exports.save();
        }
        if (doValidate) {
            logger.info('Validating config file keyset...');
            config = validateKeySet(dynamicDefaultConfig, config);
            exports.save();
        }
    }
    logger.info('ConfigManager: Successfully Loaded/Initialized.');
};

exports.save = function() {
    if (!configPathInternal) {
        // save가 load보다 먼저 호출되는 극단적인 경우 방지 (또는 load 시 반드시 초기화)
        try {
            initializePaths();
        } catch (e) {
            logger.error('ConfigManager: Cannot save config, paths not initialized and app not ready.');
            return;
        }
    }
    if (!config) {
        logger.error('ConfigManager: Attempted to save null config.');
        return;
    }
    try {
        fs.writeFileSync(configPathInternal, JSON.stringify(config, null, 4), 'UTF-8');
        logger.info(`ConfigManager: Config saved successfully to ${configPathInternal}`);
    } catch (err) {
        logger.error('ConfigManager: Failed to save config:', err);
    }
};

exports.isLoaded = function() {
    return config != null;
};

exports.getSelectedAccount = function() {
    if (!config) { logger.warn('getSelectedAccount: Config not loaded.'); return null; }
    if (!config.selectedAccount) { /* logger.info('getSelectedAccount: No account selected.'); */ return null; } // 로그 레벨 조정
    if (!config.authenticationDatabase) { logger.warn('getSelectedAccount: authenticationDatabase is missing.'); return null; }
    const account = config.authenticationDatabase[config.selectedAccount];
    // if (!account) logger.warn(`getSelectedAccount: Selected account UUID "${config.selectedAccount}" not found in database.`);
    return account;
};

// Microsoft 계정 추가 (이전 제공 코드 기반, 필드명 명확화)
exports.addMicrosoftAuthAccount = function(uuid, mcAccessToken, name, mcExpiresAt, msAccessToken, msRefreshToken, msExpiresAt) {
    if (!config) throw new Error('Config not loaded. Cannot add account.');
    const trimmedUUID = uuid.trim();
    config.selectedAccount = trimmedUUID; // 새로 추가/업데이트된 계정을 선택된 계정으로 설정

    const accountData = {
        type: 'microsoft',
        accessToken: mcAccessToken,         // Minecraft Access Token (helios-core의 mcToken.access_token)
        username: name.trim(),              // Minecraft 사용자 이름 (helios-core의 mcProfile.name)
        uuid: trimmedUUID,                  // Minecraft 프로필 UUID (helios-core의 mcProfile.id)
        displayName: name.trim(),           // 표시 이름
        expiresAt: mcExpiresAt,             // Minecraft Access Token 만료 시간
        msRefreshToken: msRefreshToken,     // Microsoft Refresh Token (갱신용)
        // 다음 두 필드는 직접 사용하지 않더라도 저장해두면 디버깅이나 다른 용도로 유용할 수 있음
        msAccessToken: msAccessToken,       // Microsoft Access Token (Graph API 등 다른 MS 서비스용)
        msAccessTokenExpiresAt: msExpiresAt // Microsoft Access Token 만료 시간
    };
    config.authenticationDatabase[trimmedUUID] = accountData;
    logger.info(`Added/Updated Microsoft account in ConfigManager: ${name.trim()} (UUID: ${trimmedUUID})`);
    return accountData;
};


exports.removeAuthAccount = function(uuid) {
    // ... (이전 코드와 동일, config null 체크 추가) ...
    if (!config) { logger.warn('removeAuthAccount: Config not loaded.'); return false; }
    if(config.authenticationDatabase[uuid] != null){
        delete config.authenticationDatabase[uuid];
        logger.info(`Removed account UUID ${uuid} from authenticationDatabase.`);
        if(config.selectedAccount === uuid){
            const keys = Object.keys(config.authenticationDatabase);
            if(keys.length > 0){
                config.selectedAccount = keys[0];
                logger.info(`Selected account changed to ${keys[0]} after removing ${uuid}.`);
            } else {
                config.selectedAccount = null;
                config.clientToken = null; // Mojang 계정용 clientToken도 초기화
                logger.info(`No accounts left. Selected account and clientToken cleared after removing ${uuid}.`);
            }
        }
        return true;
    }
    logger.warn(`Attempted to remove non-existent account UUID ${uuid}.`);
    return false;
};

// 특정 UUID로 계정 정보 가져오기 (gameLauncher에서 갱신 후 사용 가능)
exports.getAuthAccount = function(uuid) {
    if (!config || !config.authenticationDatabase || !uuid) return null;
    return config.authenticationDatabase[uuid];
};

// <<<--- setSelectedAccount 함수 추가 ---
/**
 * 주어진 UUID를 가진 계정을 선택된 계정으로 설정합니다.
 * @param {string | null} uuid 선택할 계정의 UUID, 또는 null로 설정하여 선택 해제
 */
exports.setSelectedAccount = function(uuid) {
    if (!config) {
        logger.warn('setSelectedAccount: Config not loaded.');
        // throw new Error('Config not loaded. Cannot set selected account.'); // 또는 오류 발생
        return;
    }
    if (uuid === null) {
        config.selectedAccount = null;
        logger.info('Selected account cleared (set to null).');
    } else if (typeof uuid === 'string' && config.authenticationDatabase && config.authenticationDatabase[uuid.trim()]) {
        config.selectedAccount = uuid.trim();
        logger.info(`Account UUID ${uuid.trim()} has been set as selected.`);
    } else if (typeof uuid === 'string') {
        logger.warn(`setSelectedAccount: Account with UUID "${uuid}" not found in authenticationDatabase. Cannot set as selected.`);
        // 이 경우 selectedAccount를 변경하지 않거나, null로 설정할 수 있음 (정책에 따라)
        // config.selectedAccount = null; // 예: 존재하지 않으면 선택 해제
    } else {
        logger.warn(`setSelectedAccount: Invalid UUID provided: ${uuid}`);
    }
    // 이 함수는 보통 save()를 직접 호출하지 않고,
    // 이 함수를 호출한 쪽(예: AuthHandler)에서 로직 완료 후 save()를 호출합니다.
};

// 선택된 계정 정보 초기화 (로그아웃 시 등)
exports.clearSelectedAccount = function() {
    if (!config) { logger.warn('clearSelectedAccount: Config not loaded.'); return; }
    config.selectedAccount = null;
    logger.info('Cleared selected account.');
};

exports.initialize = function() {
    if (!app.isReady()) {
        const errMsg = "ConfigManager.initialize called before app is ready.";
        console.error(`[ConfigManager] [ERROR] ${errMsg}`);
        throw new Error(errMsg);
    }
    initializePaths(); // 경로 설정
    if (!exports.isLoaded()) {
        exports.load(); // 실제 설정 파일 로드
    }
};
    
/**
 * 현재 설정(config) 객체 전체를 반환합니다.
 * 주의: 반환된 객체를 직접 수정하면 원본 config가 변경될 수 있습니다.
 * 읽기 전용으로 사용하거나, 필요시 깊은 복사하여 사용하세요.
 * @returns {object | null} config 객체 또는 null
 */
exports.getConfig = function() {
    if (!config) {
        logger.warn('getConfig: Config not loaded yet.');
    }
    return config;
};
