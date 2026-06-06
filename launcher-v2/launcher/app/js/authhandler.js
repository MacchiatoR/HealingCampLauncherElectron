// authhandler.js
const ConfigManager = require('./confighandler');
const AUTH_MODE = { FULL: 0, MS_REFRESH: 1, MC_REFRESH: 2 };
const { AZURE_CLIENT_ID } = require('./ipc'); // main.js에서 가져오거나, 별도 파일로 관리
const { MicrosoftAuth, MicrosoftErrorCode } = require('helios-core/microsoft');
const { RestResponseStatus } = require('helios-core/common');

// main.js의 log 객체를 사용하거나, 여기서 LoggerUtil 사용
// const { LoggerUtil } = require('helios-core');
// const logger = LoggerUtil.getLogger('AuthHandler');
// 또는 main.js의 log 객체를 모듈 인자로 받거나, 전역으로 공유 (덜 추천)
const log = { // 임시 로거
    info: (message, ...args) => console.log(`[AuthHandler] [INFO] ${new Date().toISOString()} ${message}`, ...args),
    error: (message, ...args) => console.error(`[AuthHandler] [ERROR] ${new Date().toISOString()} ${message}`, ...args),
};


function calculateExpiryDate(nowMs, expiresInS) {
    return nowMs + ((expiresInS - 60) * 1000); // 60초 마진
}

async function fullMicrosoftAuthFlow(entryCode, authMode) {
    // ... (이전 제공 코드와 동일) ...
    try {
        log.info(`Starting fullMicrosoftAuthFlow with mode: ${authMode}`);
        let accessTokenRaw; // MS Access Token (XBL용)
        let fullMsAccessTokenObject; // MS Access Token 응답 전체 (refresh_token 포함)

        if (authMode !== AUTH_MODE.MC_REFRESH) { // MC_REFRESH는 Minecraft 토큰만 갱신 시도 (현재 미사용 시나리오)
            log.info(`Requesting MS Access Token. Entry code type: ${authMode === AUTH_MODE.MS_REFRESH ? 'Refresh Token' : 'Auth Code'}`);
            const accessTokenResponse = await MicrosoftAuth.getAccessToken(entryCode, authMode === AUTH_MODE.MS_REFRESH, AZURE_CLIENT_ID);
            if (accessTokenResponse.responseStatus === RestResponseStatus.ERROR || !accessTokenResponse.data) {
                log.error('Failed to get MS Access Token:', accessTokenResponse.microsoftErrorCode, accessTokenResponse.message);
                return Promise.reject(microsoftErrorDisplayable(accessTokenResponse.microsoftErrorCode || MicrosoftErrorCode.AUTHENTICATION_ERROR));
            }
            fullMsAccessTokenObject = accessTokenResponse.data; // { access_token, refresh_token, expires_in, ... }
            accessTokenRaw = fullMsAccessTokenObject.access_token;
            log.info('MS Access Token acquired.');
        } else {
            // AUTH_MODE.MC_REFRESH의 경우, entryCode가 이미 유효한 MS Access Token이라고 가정
            // 이 모드는 현재 refreshTokensForLaunch에서 직접 사용되지 않음
            accessTokenRaw = entryCode;
            log.info('Using provided entryCode as MS Access Token for MC_REFRESH mode.');
        }

        if (!accessTokenRaw) {
            log.error('MS Access Token (accessTokenRaw) is undefined before XBL request.');
            return Promise.reject(microsoftErrorDisplayable(MicrosoftErrorCode.XBL_AUTHENTICATION_ERROR, "MS Access Token이 없습니다."));
        }
        
        log.info('Requesting XBL Token...');
        const xblResponse = await MicrosoftAuth.getXBLToken(accessTokenRaw);
        if (xblResponse.responseStatus === RestResponseStatus.ERROR || !xblResponse.data) {
            log.error('Failed to get XBL Token:', xblResponse.microsoftErrorCode, xblResponse.message);
            return Promise.reject(microsoftErrorDisplayable(xblResponse.microsoftErrorCode || MicrosoftErrorCode.XBL_AUTHENTICATION_ERROR));
        }
        log.info('XBL Token acquired.');

        log.info('Requesting XSTS Token...');
        const xstsResponse = await MicrosoftAuth.getXSTSToken(xblResponse.data); // XSTS는 XBL 토큰 객체 전체를 받을 수 있음
        if (xstsResponse.responseStatus === RestResponseStatus.ERROR || !xstsResponse.data) {
            log.error('Failed to get XSTS Token:', xstsResponse.microsoftErrorCode, xstsResponse.message);
            return Promise.reject(microsoftErrorDisplayable(xstsResponse.microsoftErrorCode || MicrosoftErrorCode.XSTS_AUTHENTICATION_ERROR));
        }
        log.info('XSTS Token acquired.');

        log.info('Requesting MC Access Token...');
        const mcTokenResponse = await MicrosoftAuth.getMCAccessToken(xstsResponse.data); // XSTS 토큰 객체 전체
        if (mcTokenResponse.responseStatus === RestResponseStatus.ERROR || !mcTokenResponse.data) {
            log.error('Failed to get MC Access Token:', mcTokenResponse.microsoftErrorCode, mcTokenResponse.message);
            return Promise.reject(microsoftErrorDisplayable(mcTokenResponse.microsoftErrorCode || MicrosoftErrorCode.MC_AUTHENTICATION_ERROR));
        }
        log.info('MC Access Token acquired.');

        log.info('Requesting MC Profile...');
        const mcProfileResponse = await MicrosoftAuth.getMCProfile(mcTokenResponse.data.access_token);
        if (mcProfileResponse.responseStatus === RestResponseStatus.ERROR || !mcProfileResponse.data) {
            log.error('Failed to get MC Profile:', mcProfileResponse.microsoftErrorCode, mcProfileResponse.message);
            return Promise.reject(microsoftErrorDisplayable(mcProfileResponse.microsoftErrorCode || MicrosoftErrorCode.MC_PROFILE_ERROR));
        }
        log.info('MC Profile acquired:', mcProfileResponse.data.name);

        return {
            // fullMsAccessTokenObject는 AUTH_MODE.FULL 또는 MS_REFRESH일 때만 존재
            // AUTH_MODE.MC_REFRESH 에서는 accessToken (MS 토큰 객체)가 없음
            accessToken: fullMsAccessTokenObject, // Microsoft Access Token 객체 (refresh_token 포함 가능)
            // accessTokenRaw: accessTokenRaw, // XBL 요청에 사용된 MS Access Token 문자열 (디버깅용)
            xbl: xblResponse.data,
            xsts: xstsResponse.data,
            mcToken: mcTokenResponse.data,     // { access_token, expires_in, username, roles, token_type }
            mcProfile: mcProfileResponse.data // { id, name, skins, capes }
        };
    } catch(err) {
        log.error('Unhandled error in fullMicrosoftAuthFlow:', err);
        return Promise.reject(microsoftErrorDisplayable(MicrosoftErrorCode.UNKNOWN, err.message));
    }
}


exports.addMicrosoftAccount = async function(authCode) {
    log.info('Attempting to add Microsoft account with auth code...');
    const fullAuth = await fullMicrosoftAuthFlow(authCode, AUTH_MODE.FULL);
    const now = Date.now();

    // mcProfile.id (UUID), mcToken.access_token (MC용), mcProfile.name
    // fullAuth.accessToken (MS용 객체) -> access_token, refresh_token, expires_in
    const savedAccount = ConfigManager.addMicrosoftAuthAccount(
        fullAuth.mcProfile.id,
        fullAuth.mcToken.access_token,
        fullAuth.mcProfile.name,
        calculateExpiryDate(now, fullAuth.mcToken.expires_in),
        fullAuth.accessToken.access_token,    // MS Access Token
        fullAuth.accessToken.refresh_token,   // MS Refresh Token
        calculateExpiryDate(now, fullAuth.accessToken.expires_in) // MS Access Token 만료 시간
    );
    ConfigManager.setSelectedAccount(fullAuth.mcProfile.id); // 명시적으로 선택
    await ConfigManager.save();
    log.info(`Microsoft account ${fullAuth.mcProfile.name} added and selected.`);
    return savedAccount; // ConfigManager에서 반환된 객체 사용
};

exports.removeMicrosoftAccount = async function(uuid) {
    ConfigManager.removeAuthAccount(uuid);
    await ConfigManager.save();
};

exports.refreshTokensForLaunch = async function(uuid, msRefreshToken) {
    log.info(`Attempting to refresh tokens for UUID: ${uuid} using MS Refresh Token.`);
    if (!msRefreshToken) {
        log.error('Microsoft Refresh Token is missing for refreshTokensForLaunch.');
        throw microsoftErrorDisplayable(MicrosoftErrorCode.NEEDS_RELOGIN, 'Microsoft Refresh Token이 없어 토큰을 갱신할 수 없습니다. 다시 로그인해주세요.');
    }

    try {
        // AUTH_MODE.MS_REFRESH를 사용하여 MS Access Token을 먼저 갱신하고,
        // 그 토큰으로 나머지(XBL, XSTS, MC) 토큰을 순차적으로 갱신.
        const refreshedAuthData = await fullMicrosoftAuthFlow(msRefreshToken, AUTH_MODE.MS_REFRESH);

        if (!refreshedAuthData || !refreshedAuthData.mcToken || !refreshedAuthData.mcProfile || !refreshedAuthData.accessToken) {
            log.error('Failed to fully refresh tokens or retrieve necessary data during token refresh.');
            throw microsoftErrorDisplayable(MicrosoftErrorCode.UNKNOWN, '토큰 갱신 중 필요한 모든 데이터를 얻지 못했습니다.');
        }

        const now = Date.now();
        ConfigManager.addMicrosoftAuthAccount(
            refreshedAuthData.mcProfile.id,
            refreshedAuthData.mcToken.access_token,
            refreshedAuthData.mcProfile.name,
            calculateExpiryDate(now, refreshedAuthData.mcToken.expires_in),
            refreshedAuthData.accessToken.access_token,
            refreshedAuthData.accessToken.refresh_token, // 새 리프레시 토큰 (또는 기존 것)
            calculateExpiryDate(now, refreshedAuthData.accessToken.expires_in)
        );
        // 선택된 계정이 이 계정이라면, setSelectedAccount는 이미 addMicrosoftAuthAccount에서 처리될 수 있음
        // (또는 명시적으로 호출: ConfigManager.setSelectedAccount(refreshedAuthData.mcProfile.id);)
        await ConfigManager.save();
        log.info(`Tokens and profile for UUID: ${uuid} successfully refreshed and saved.`);

        return {
            mcAccessToken: refreshedAuthData.mcToken.access_token,
            mcProfileName: refreshedAuthData.mcProfile.name, // 이름도 반환
            mcProfileId: refreshedAuthData.mcProfile.id,     // UUID도 반환
            userType: 'msa'
        };

    } catch (error) {
        log.error(`Error during token refresh for UUID ${uuid}:`, error);
        // error가 이미 displayableError 형태일 수 있음
        const displayableError = error.isDisplayableError ? error : microsoftErrorDisplayable(MicrosoftErrorCode.UNKNOWN, error.message);
        throw displayableError;
    }
};

function microsoftErrorDisplayable(errorCode, customMessage) {
    let title = 'Microsoft 인증 오류';
    let desc = customMessage || `오류 코드: ${errorCode || MicrosoftErrorCode.UNKNOWN}`;
    // 여기에 MicrosoftErrorCode에 따른 상세 메시지 추가 가능
    // switch (errorCode) {
    //     case MicrosoftErrorCode.USER_CANCELLED: desc = "사용자가 인증을 취소했습니다."; break;
    //     // ...
    // }
    return { title, desc, isDisplayableError: true, errorCode };
}
