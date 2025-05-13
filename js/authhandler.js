
const ConfigManager = require('./confighandler');
const AUTH_MODE = { FULL: 0, MS_REFRESH: 1, MC_REFRESH: 2 }
const { AZURE_CLIENT_ID } = require('./ipc')
const { MicrosoftAuth, MicrosoftErrorCode } = require('helios-core/microsoft')
const { RestResponseStatus } = require('helios-core/common')

function calculateExpiryDate(nowMs, epiresInS) {
    return nowMs + ((epiresInS-10)*1000)
}

exports.addMicrosoftAccount = async function(authCode) {

    const fullAuth = await fullMicrosoftAuthFlow(authCode, AUTH_MODE.FULL)

    // Advance expiry by 10 seconds to avoid close calls.
    const now = new Date().getTime()

    const ret = ConfigManager.addMicrosoftAuthAccount(
        fullAuth.mcProfile.id,
        fullAuth.mcToken.access_token,
        fullAuth.mcProfile.name,
        calculateExpiryDate(now, fullAuth.mcToken.expires_in),
        fullAuth.accessToken.access_token,
        fullAuth.accessToken.refresh_token,
        calculateExpiryDate(now, fullAuth.accessToken.expires_in)
    )
    ConfigManager.save()

    return ret
}

exports.removeMicrosoftAccount = async function(uuid){
    try {
        ConfigManager.removeAuthAccount(uuid)
        ConfigManager.save()
        return Promise.resolve()
    } catch (err){
        log.error('Error while removing account', err)
        return Promise.reject(err)
    }
}

async function fullMicrosoftAuthFlow(entryCode, authMode) {
    try {

        let accessTokenRaw
        let accessToken
        if(authMode !== AUTH_MODE.MC_REFRESH) {
            const accessTokenResponse = await MicrosoftAuth.getAccessToken(entryCode, authMode === AUTH_MODE.MS_REFRESH, AZURE_CLIENT_ID)
            if(accessTokenResponse.responseStatus === RestResponseStatus.ERROR) {
                return Promise.reject(microsoftErrorDisplayable(accessTokenResponse.microsoftErrorCode))
            }
            accessToken = accessTokenResponse.data
            accessTokenRaw = accessToken.access_token
        } else {
            accessTokenRaw = entryCode
        }
        
        const xblResponse = await MicrosoftAuth.getXBLToken(accessTokenRaw)
        if(xblResponse.responseStatus === RestResponseStatus.ERROR) {
            return Promise.reject(microsoftErrorDisplayable(xblResponse.microsoftErrorCode))
        }
        const xstsResonse = await MicrosoftAuth.getXSTSToken(xblResponse.data)
        if(xstsResonse.responseStatus === RestResponseStatus.ERROR) {
            return Promise.reject(microsoftErrorDisplayable(xstsResonse.microsoftErrorCode))
        }
        const mcTokenResponse = await MicrosoftAuth.getMCAccessToken(xstsResonse.data)
        if(mcTokenResponse.responseStatus === RestResponseStatus.ERROR) {
            return Promise.reject(microsoftErrorDisplayable(mcTokenResponse.microsoftErrorCode))
        }
        const mcProfileResponse = await MicrosoftAuth.getMCProfile(mcTokenResponse.data.access_token)
        if(mcProfileResponse.responseStatus === RestResponseStatus.ERROR) {
            return Promise.reject(microsoftErrorDisplayable(mcProfileResponse.microsoftErrorCode))
        }
        return {
            accessToken,
            accessTokenRaw,
            xbl: xblResponse.data,
            xsts: xstsResonse.data,
            mcToken: mcTokenResponse.data,
            mcProfile: mcProfileResponse.data
        }
    } catch(err) {
        console.error(err)
        return Promise.reject(microsoftErrorDisplayable(MicrosoftErrorCode.UNKNOWN))
    }
}

/**
 * Microsoft Refresh Token을 사용하여 모든 관련 토큰을 갱신하고,
 * Minecraft 프로필 정보를 반환합니다.
 * 갱신된 정보는 ConfigManager에 저장합니다.
 * @param {string} uuid 갱신할 계정의 UUID
 * @param {string} msRefreshToken 저장된 Microsoft Refresh Token
 * @returns {Promise<{mcAccessToken: string, mcProfile: object, userType: string}>} 게임 실행에 필요한 정보
 */
exports.refreshTokensForLaunch = async function(uuid, msRefreshToken) {
    log.info(`Attempting to refresh tokens for UUID: ${uuid} using MS Refresh Token.`);
    if (!msRefreshToken) {
        log.error('Microsoft Refresh Token is missing for refreshTokensForLaunch.');
        throw new Error('Microsoft Refresh Token이 없어 토큰을 갱신할 수 없습니다.');
    }

    try {
        // 1. MS Refresh Token으로 새로운 MS Access Token 획득 (helios-core가 지원해야 함)
        // fullMicrosoftAuthFlow를 AUTH_MODE.MS_REFRESH와 함께 사용
        const refreshedAuthData = await fullMicrosoftAuthFlow(msRefreshToken, AUTH_MODE.MS_REFRESH);
        // refreshedAuthData 구조는 fullMicrosoftAuthFlow의 반환값과 동일해야 함
        // { accessToken, accessTokenRaw, xbl, xsts, mcToken, mcProfile }

        if (!refreshedAuthData || !refreshedAuthData.mcToken || !refreshedAuthData.mcProfile) {
            log.error('Failed to refresh tokens or retrieve MC profile during token refresh.');
            throw new Error('토큰 갱신 또는 Minecraft 프로필 조회에 실패했습니다.');
        }

        const now = new Date().getTime();

        // ConfigManager에 갱신된 토큰 정보 저장
        // ConfigManager.updateMicrosoftAuthAccount 함수가 필요할 수 있음.
        // 또는 기존 addMicrosoftAuthAccount를 사용하여 덮어쓰기 (만료 시간 등 재계산)
        ConfigManager.addMicrosoftAuthAccount( // 기존 계정 정보를 덮어쓰는 방식
            refreshedAuthData.mcProfile.id,
            refreshedAuthData.mcToken.access_token,
            refreshedAuthData.mcProfile.name,
            calculateExpiryDate(now, refreshedAuthData.mcToken.expires_in),
            refreshedAuthData.accessToken.access_token, // 새로 발급된 MS Access Token
            refreshedAuthData.accessToken.refresh_token, // 새로 발급된 MS Refresh Token (보통 이전과 동일하거나 새로 발급)
            calculateExpiryDate(now, refreshedAuthData.accessToken.expires_in)
        );
        // 선택된 계정이 이 계정이라면, 선택된 계정 정보도 업데이트 (ConfigManager 내부에서 처리되거나, 여기서 명시적 호출)
        // 예: if (ConfigManager.getSelectedAccount()?.uuid === uuid) ConfigManager.setSelectedAccount(uuid);
        await ConfigManager.save();
        log.info(`Tokens and profile for UUID: ${uuid} successfully refreshed and saved.`);

        return {
            mcAccessToken: refreshedAuthData.mcToken.access_token,
            mcProfile: refreshedAuthData.mcProfile, // name, id (uuid) 포함
            userType: 'msa'
        };

    } catch (error) {
        log.error(`Error during token refresh for UUID ${uuid}:`, error);
        // microsoftErrorDisplayable와 같은 헬퍼 함수가 있다면 사용
        const displayableError = error.isDisplayableError ? error : { title: '토큰 갱신 오류', desc: error.message || '알 수 없는 오류 발생' };
        throw displayableError; // 에러를 다시 던져서 호출한 쪽에서 처리
    }
};

// Microsoft 오류 코드를 사용자 친화적 메시지로 변환하는 헬퍼 (기존 코드에 있다면 사용)
function microsoftErrorDisplayable(errorCode) {
    // MicrosoftErrorCode에 따라 적절한 메시지 반환
    let title = 'Microsoft 인증 오류';
    let desc = `오류 코드: ${errorCode || MicrosoftErrorCode.UNKNOWN}`;
    // switch (errorCode) { ... }
    return { title, desc, isDisplayableError: true };
}