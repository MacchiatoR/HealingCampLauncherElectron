// confighandler.js
let config = null;
const { LoggerUtil } = require('helios-core');
const logger = LoggerUtil.getLogger('confighandler');
const fs = require('fs-extra');
const path = require('path');
const { app } = require('electron'); // Electron의 app 모듈 직접 가져오기

// launcherDir를 함수 내부 또는 app.isReady() 이후에 초기화하거나,
// 이 모듈이 로드되는 시점에 app이 준비되었다고 가정하고 사용합니다.
// 가장 안전한 방법은 getLauncherDirectory 함수 내에서 app.getPath를 호출하는 것입니다.
let launcherDirInternal = null; // 내부 변수로 변경

exports.getLauncherDirectory = function(){
    if (!launcherDirInternal) {
        if (app.isReady()) { // 앱이 준비되었는지 확인
            launcherDirInternal = app.getPath('userData');
        } else {
            // 앱이 준비되지 않은 경우, 동기적으로 경로를 가져올 수 없으므로
            // 에러를 던지거나, 기본 경로를 반환하거나, 비동기 처리를 고려해야 합니다.
            // 여기서는 간단히 에러를 로깅하고 null을 반환하거나,
            // 또는 이 함수가 app.whenReady() 이후에만 호출된다고 가정합니다.
            logger.warn('getLauncherDirectory called before app is ready. Path might be incorrect.');
            // 임시로 app.getPath를 시도해볼 수 있으나, isReady() 이전에는 불안정할 수 있습니다.
            try {
                launcherDirInternal = app.getPath('userData');
            } catch (e) {
                logger.error('Failed to get userData path early:', e);
                // 대체 경로 또는 오류 처리
                // 예: launcherDirInternal = path.join(os.homedir(), '.my-app-default-path');
                throw new Error('Electron app is not ready to provide userData path.');
            }
        }
    }
    return launcherDirInternal;
};

const configPath = path.join(app.getPath('userData'), 'config.json');
const sysRoot = process.env.APPDATA || (process.platform == 'darwin' ? process.env.HOME + '/Library/Application Support' : process.env.HOME);
const dataPath = path.join(sysRoot, '.helioslauncher'); // dataPath 정의 추가
const configPathLEGACY = path.join(dataPath, 'config.json');

const DEFAULT_CONFIG = {
    settings: {
        game: {
            resWidth: 1280,
            resHeight: 720,
            fullscreen: false,
            autoConnect: true,
            launchDetached: true
        },
        launcher: {
            allowPrerelease: false,
            dataDirectory: dataPath
        }
    },
    newsCache: {
        date: null,
        content: null,
        dismissed: false
    },
    clientToken: null,
    selectedServer: null, // Resolved
    selectedAccount: null,
    authenticationDatabase: {},
    modConfigurations: [],
    javaConfig: {}
}

function validateKeySet(srcObj, destObj){
    if(srcObj == null){
        srcObj = {}
    }
    const validationBlacklist = ['authenticationDatabase', 'javaConfig']
    const keys = Object.keys(srcObj)
    for(let i=0; i<keys.length; i++){
        if(typeof destObj[keys[i]] === 'undefined'){
            destObj[keys[i]] = srcObj[keys[i]]
        } else if(typeof srcObj[keys[i]] === 'object' && srcObj[keys[i]] != null && !(srcObj[keys[i]] instanceof Array) && validationBlacklist.indexOf(keys[i]) === -1){
            destObj[keys[i]] = validateKeySet(srcObj[keys[i]], destObj[keys[i]])
        }
    }
    return destObj
}

exports.load = function(){
    let doLoad = true

    if(!fs.existsSync(configPath)){
        // Create all parent directories.
        fs.ensureDirSync(path.join(configPath, '..'))
        if(fs.existsSync(configPathLEGACY)){
            fs.moveSync(configPathLEGACY, configPath)
        } else {
            doLoad = false
            config = DEFAULT_CONFIG
            exports.save()
        }
    }
    if(doLoad){
        let doValidate = false
        try {
            config = JSON.parse(fs.readFileSync(configPath, 'UTF-8'))
            doValidate = true
        } catch (err){
            logger.error(err)
            logger.info('Configuration file contains malformed JSON or is corrupt.')
            logger.info('Generating a new configuration file.')
            fs.ensureDirSync(path.join(configPath, '..'))
            config = DEFAULT_CONFIG
            exports.save()
        }
        if(doValidate){
            config = validateKeySet(DEFAULT_CONFIG, config)
            exports.save()
        }
    }
    logger.info('Successfully Loaded')
}

exports.save = function(){
    fs.writeFileSync(configPath, JSON.stringify(config, null, 4), 'UTF-8')
}

exports.isLoaded = function(){
    return config != null;
};

exports.getSelectedAccount = function(){
    return config.authenticationDatabase[config.selectedAccount]
}

exports.addMicrosoftAuthAccount = function(uuid, accessToken, name, mcExpires, msAccessToken, msRefreshToken, msExpires) {
    config.selectedAccount = uuid
    config.authenticationDatabase[uuid] = {
        type: 'microsoft',
        accessToken,
        username: name.trim(),
        uuid: uuid.trim(),
        displayName: name.trim(),
        expiresAt: mcExpires,
        microsoft: {
            access_token: msAccessToken,
            refresh_token: msRefreshToken,
            expires_at: msExpires
        }
    }
    return config.authenticationDatabase[uuid]
}

exports.removeAuthAccount = function(uuid){
    if(config.authenticationDatabase[uuid] != null){
        delete config.authenticationDatabase[uuid]
        if(config.selectedAccount === uuid){
            const keys = Object.keys(config.authenticationDatabase)
            if(keys.length > 0){
                config.selectedAccount = keys[0]
            } else {
                config.selectedAccount = null
                config.clientToken = null
            }
        }
        return true
    }
    return false
}
