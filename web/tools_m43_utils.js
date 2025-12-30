/* 工具箱（M43）JWT 生成/验证 & JWK 管理工具
 *
 * 设计目标：
 * - 纯算法、无 DOM 依赖
 * - JWT 生成与验证（支持 HS256/RS256/ES256 等）
 * - JWK 解析、验证、转换
 * - 使用 Web Crypto API
 */
(function (root, factory) {
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = factory();
    } else {
        root.DogToolboxM43Utils = factory();
    }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    // ==================== Base64URL 编解码 ====================

    function base64UrlEncode(data) {
        let bytes;
        if (typeof data === 'string') {
            bytes = new TextEncoder().encode(data);
        } else if (data instanceof ArrayBuffer) {
            bytes = new Uint8Array(data);
        } else {
            bytes = data;
        }
        let binary = '';
        for (let i = 0; i < bytes.length; i++) {
            binary += String.fromCharCode(bytes[i]);
        }
        const base64 = btoa(binary);
        return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    }

    function base64UrlDecode(str) {
        let base64 = str.replace(/-/g, '+').replace(/_/g, '/');
        const pad = base64.length % 4;
        if (pad === 2) base64 += '==';
        else if (pad === 3) base64 += '=';
        const binary = atob(base64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
            bytes[i] = binary.charCodeAt(i);
        }
        return bytes;
    }

    function base64UrlDecodeToString(str) {
        return new TextDecoder().decode(base64UrlDecode(str));
    }

    // ==================== JWT 预设模板 ====================

    const JWT_PRESETS = {
        access_token: {
            name: 'Access Token',
            description: '标准访问令牌',
            claims: {
                iss: 'https://example.com',
                sub: 'user_id',
                aud: 'api.example.com',
                exp: 3600,
                iat: true,
                jti: true
            }
        },
        refresh_token: {
            name: 'Refresh Token',
            description: '刷新令牌（7天有效期）',
            claims: {
                iss: 'https://example.com',
                sub: 'user_id',
                exp: 604800,
                iat: true,
                jti: true,
                type: 'refresh'
            }
        },
        id_token: {
            name: 'ID Token (OIDC)',
            description: 'OpenID Connect ID Token',
            claims: {
                iss: 'https://example.com',
                sub: 'user_id',
                aud: 'client_id',
                exp: 3600,
                iat: true,
                nonce: '',
                auth_time: true,
                name: 'User Name',
                email: 'user@example.com'
            }
        },
        api_key: {
            name: 'API Key Token',
            description: 'API 密钥令牌（长期有效）',
            claims: {
                iss: 'https://example.com',
                sub: 'api_key_id',
                exp: 31536000,
                iat: true,
                scope: 'read write'
            }
        }
    };

    // ==================== 算法配置 ====================

    const ALGORITHMS = {
        HS256: { name: 'HMAC', hash: 'SHA-256', type: 'hmac' },
        HS384: { name: 'HMAC', hash: 'SHA-384', type: 'hmac' },
        HS512: { name: 'HMAC', hash: 'SHA-512', type: 'hmac' },
        RS256: { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256', type: 'rsa' },
        RS384: { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-384', type: 'rsa' },
        RS512: { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-512', type: 'rsa' },
        PS256: { name: 'RSA-PSS', hash: 'SHA-256', type: 'rsa-pss' },
        PS384: { name: 'RSA-PSS', hash: 'SHA-384', type: 'rsa-pss' },
        PS512: { name: 'RSA-PSS', hash: 'SHA-512', type: 'rsa-pss' },
        ES256: { name: 'ECDSA', hash: 'SHA-256', namedCurve: 'P-256', type: 'ecdsa' },
        ES384: { name: 'ECDSA', hash: 'SHA-384', namedCurve: 'P-384', type: 'ecdsa' },
        ES512: { name: 'ECDSA', hash: 'SHA-512', namedCurve: 'P-521', type: 'ecdsa' }
    };

    // ==================== 辅助函数 ====================

    function generateUUID() {
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
            const r = Math.random() * 16 | 0;
            return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
        });
    }

    function processPayloadClaims(payload) {
        const now = Math.floor(Date.now() / 1000);
        const processed = { ...payload };

        // 处理 iat
        if (processed.iat === true) {
            processed.iat = now;
        }

        // 处理 exp（如果是数字且小于一年的秒数，视为相对时间）
        if (typeof processed.exp === 'number' && processed.exp < 31536000) {
            processed.exp = now + processed.exp;
        }

        // 处理 nbf
        if (processed.nbf === true) {
            processed.nbf = now;
        }

        // 处理 jti
        if (processed.jti === true) {
            processed.jti = generateUUID();
        }

        // 处理 auth_time
        if (processed.auth_time === true) {
            processed.auth_time = now;
        }

        return processed;
    }

    // ==================== HMAC 签名 ====================

    async function signHmac(data, secret, algorithm) {
        const alg = ALGORITHMS[algorithm];
        const encoder = new TextEncoder();
        const keyData = encoder.encode(secret);
        const key = await crypto.subtle.importKey(
            'raw',
            keyData,
            { name: alg.name, hash: alg.hash },
            false,
            ['sign']
        );
        const signature = await crypto.subtle.sign(
            alg.name,
            key,
            encoder.encode(data)
        );
        return base64UrlEncode(signature);
    }

    async function verifyHmac(data, signature, secret, algorithm) {
        const alg = ALGORITHMS[algorithm];
        const encoder = new TextEncoder();
        const keyData = encoder.encode(secret);
        const key = await crypto.subtle.importKey(
            'raw',
            keyData,
            { name: alg.name, hash: alg.hash },
            false,
            ['verify']
        );
        const sigBytes = base64UrlDecode(signature);
        return await crypto.subtle.verify(
            alg.name,
            key,
            sigBytes,
            encoder.encode(data)
        );
    }

    // ==================== RSA 签名 ====================

    async function importRsaPrivateKey(pem, algorithm) {
        const alg = ALGORITHMS[algorithm];
        const pemContents = pem
            .replace(/-----BEGIN (RSA )?PRIVATE KEY-----/, '')
            .replace(/-----END (RSA )?PRIVATE KEY-----/, '')
            .replace(/\s/g, '');
        const binaryDer = atob(pemContents);
        const bytes = new Uint8Array(binaryDer.length);
        for (let i = 0; i < binaryDer.length; i++) {
            bytes[i] = binaryDer.charCodeAt(i);
        }
        return await crypto.subtle.importKey(
            'pkcs8',
            bytes,
            { name: alg.name, hash: alg.hash },
            false,
            ['sign']
        );
    }

    async function importRsaPublicKey(pem, algorithm) {
        const alg = ALGORITHMS[algorithm];
        const pemContents = pem
            .replace(/-----BEGIN PUBLIC KEY-----/, '')
            .replace(/-----END PUBLIC KEY-----/, '')
            .replace(/\s/g, '');
        const binaryDer = atob(pemContents);
        const bytes = new Uint8Array(binaryDer.length);
        for (let i = 0; i < binaryDer.length; i++) {
            bytes[i] = binaryDer.charCodeAt(i);
        }
        return await crypto.subtle.importKey(
            'spki',
            bytes,
            { name: alg.name, hash: alg.hash },
            false,
            ['verify']
        );
    }

    function getPssSaltLength(algorithm) {
        if (algorithm === 'PS384') return 48;
        if (algorithm === 'PS512') return 64;
        return 32;
    }

    async function signRsa(data, privateKeyPem, algorithm) {
        const alg = ALGORITHMS[algorithm];
        const key = await importRsaPrivateKey(privateKeyPem, algorithm);
        const encoder = new TextEncoder();
        const signParams = alg.type === 'rsa-pss'
            ? { name: alg.name, saltLength: getPssSaltLength(algorithm) }
            : alg.name;
        const signature = await crypto.subtle.sign(
            signParams,
            key,
            encoder.encode(data)
        );
        return base64UrlEncode(signature);
    }

    async function verifyRsa(data, signature, publicKeyPem, algorithm) {
        const alg = ALGORITHMS[algorithm];
        const key = await importRsaPublicKey(publicKeyPem, algorithm);
        const encoder = new TextEncoder();
        const sigBytes = base64UrlDecode(signature);
        const verifyParams = alg.type === 'rsa-pss'
            ? { name: alg.name, saltLength: getPssSaltLength(algorithm) }
            : alg.name;
        return await crypto.subtle.verify(
            verifyParams,
            key,
            sigBytes,
            encoder.encode(data)
        );
    }

    // ==================== ECDSA 签名 ====================

    async function importEcdsaPrivateKey(pem, algorithm) {
        const alg = ALGORITHMS[algorithm];
        const pemContents = pem
            .replace(/-----BEGIN (EC )?PRIVATE KEY-----/, '')
            .replace(/-----END (EC )?PRIVATE KEY-----/, '')
            .replace(/\s/g, '');
        const binaryDer = atob(pemContents);
        const bytes = new Uint8Array(binaryDer.length);
        for (let i = 0; i < binaryDer.length; i++) {
            bytes[i] = binaryDer.charCodeAt(i);
        }
        return await crypto.subtle.importKey(
            'pkcs8',
            bytes,
            { name: alg.name, namedCurve: alg.namedCurve },
            false,
            ['sign']
        );
    }

    async function importEcdsaPublicKey(pem, algorithm) {
        const alg = ALGORITHMS[algorithm];
        const pemContents = pem
            .replace(/-----BEGIN PUBLIC KEY-----/, '')
            .replace(/-----END PUBLIC KEY-----/, '')
            .replace(/\s/g, '');
        const binaryDer = atob(pemContents);
        const bytes = new Uint8Array(binaryDer.length);
        for (let i = 0; i < binaryDer.length; i++) {
            bytes[i] = binaryDer.charCodeAt(i);
        }
        return await crypto.subtle.importKey(
            'spki',
            bytes,
            { name: alg.name, namedCurve: alg.namedCurve },
            false,
            ['verify']
        );
    }

    async function signEcdsa(data, privateKeyPem, algorithm) {
        const alg = ALGORITHMS[algorithm];
        const key = await importEcdsaPrivateKey(privateKeyPem, algorithm);
        const encoder = new TextEncoder();
        const signature = await crypto.subtle.sign(
            { name: alg.name, hash: alg.hash },
            key,
            encoder.encode(data)
        );
        return base64UrlEncode(signature);
    }

    async function verifyEcdsa(data, signature, publicKeyPem, algorithm) {
        const alg = ALGORITHMS[algorithm];
        const key = await importEcdsaPublicKey(publicKeyPem, algorithm);
        const encoder = new TextEncoder();
        const sigBytes = base64UrlDecode(signature);
        return await crypto.subtle.verify(
            { name: alg.name, hash: alg.hash },
            key,
            sigBytes,
            encoder.encode(data)
        );
    }

    // ==================== JWT 生成 ====================

    /**
     * 生成 JWT
     * @param {object} payload - JWT payload
     * @param {string} secret - 密钥（HMAC）或私钥 PEM（RSA/ECDSA）
     * @param {object} options - 选项
     * @param {string} options.algorithm - 算法（默认 HS256）
     * @returns {Promise<{token: string, error: string|null}>}
     */
    async function generateJwt(payload, secret, options = {}) {
        const algorithm = options.algorithm || 'HS256';

        if (!ALGORITHMS[algorithm]) {
            return { token: '', error: `不支持的算法: ${algorithm}` };
        }

        if (!secret) {
            return { token: '', error: '密钥不能为空' };
        }

        try {
            const header = { alg: algorithm, typ: 'JWT' };
            const processedPayload = processPayloadClaims(payload);

            const headerB64 = base64UrlEncode(JSON.stringify(header));
            const payloadB64 = base64UrlEncode(JSON.stringify(processedPayload));
            const signingInput = `${headerB64}.${payloadB64}`;

            let signature;
            const alg = ALGORITHMS[algorithm];

            if (alg.type === 'hmac') {
                signature = await signHmac(signingInput, secret, algorithm);
            } else if (alg.type === 'rsa' || alg.type === 'rsa-pss') {
                signature = await signRsa(signingInput, secret, algorithm);
            } else if (alg.type === 'ecdsa') {
                signature = await signEcdsa(signingInput, secret, algorithm);
            }

            return { token: `${signingInput}.${signature}`, error: null };
        } catch (e) {
            return { token: '', error: e.message };
        }
    }

    // ==================== JWT 验证 ====================

    /**
     * 验证 JWT
     * @param {string} token - JWT token
     * @param {string} secret - 密钥（HMAC）或公钥 PEM（RSA/ECDSA）
     * @param {object} options - 选项
     * @param {string} options.algorithm - 期望的算法
     * @param {boolean} options.ignoreExpiration - 是否忽略过期检查
     * @returns {Promise<{valid: boolean, header: object, payload: object, error: string|null}>}
     */
    async function verifyJwt(token, secret, options = {}) {
        const result = { valid: false, header: null, payload: null, error: null };

        try {
            const parts = token.split('.');
            if (parts.length !== 3) {
                result.error = 'JWT 格式无效：应为三段式结构';
                return result;
            }

            const [headerB64, payloadB64, signature] = parts;
            const header = JSON.parse(base64UrlDecodeToString(headerB64));
            const payload = JSON.parse(base64UrlDecodeToString(payloadB64));

            result.header = header;
            result.payload = payload;

            const algorithm = options.algorithm || header.alg;
            if (!ALGORITHMS[algorithm]) {
                result.error = `不支持的算法: ${algorithm}`;
                return result;
            }

            if (options.algorithm && header.alg !== options.algorithm) {
                result.error = `算法不匹配：期望 ${options.algorithm}，实际 ${header.alg}`;
                return result;
            }

            if (!secret) {
                result.error = '密钥不能为空';
                return result;
            }

            const signingInput = `${headerB64}.${payloadB64}`;
            const alg = ALGORITHMS[algorithm];
            let isValid = false;

            if (alg.type === 'hmac') {
                isValid = await verifyHmac(signingInput, signature, secret, algorithm);
            } else if (alg.type === 'rsa' || alg.type === 'rsa-pss') {
                isValid = await verifyRsa(signingInput, signature, secret, algorithm);
            } else if (alg.type === 'ecdsa') {
                isValid = await verifyEcdsa(signingInput, signature, secret, algorithm);
            }

            if (!isValid) {
                result.error = '签名验证失败';
                return result;
            }

            // 检查过期
            if (!options.ignoreExpiration && payload.exp) {
                const now = Math.floor(Date.now() / 1000);
                if (payload.exp < now) {
                    result.error = 'Token 已过期';
                    result.valid = false;
                    return result;
                }
            }

            // 检查 nbf
            if (payload.nbf) {
                const now = Math.floor(Date.now() / 1000);
                if (payload.nbf > now) {
                    result.error = 'Token 尚未生效';
                    result.valid = false;
                    return result;
                }
            }

            result.valid = true;
            return result;
        } catch (e) {
            result.error = e.message;
            return result;
        }
    }

    // ==================== 密钥生成 ====================

    /**
     * 生成 HMAC 密钥
     * @param {number} bits - 密钥位数（默认 256）
     * @returns {string}
     */
    function generateHmacSecret(bits = 256) {
        const bytes = new Uint8Array(bits / 8);
        crypto.getRandomValues(bytes);
        return base64UrlEncode(bytes);
    }

    /**
     * 生成 RSA 密钥对
     * @param {string} algorithm - 算法（RS256/RS384/RS512/PS256/PS384/PS512）
     * @param {number} modulusLength - 模数长度（默认 2048）
     * @returns {Promise<{publicKey: string, privateKey: string, error: string|null}>}
     */
    async function generateRsaKeyPair(algorithm = 'RS256', modulusLength = 2048) {
        try {
            const alg = ALGORITHMS[algorithm];
            const keyPair = await crypto.subtle.generateKey(
                {
                    name: alg.name,
                    modulusLength,
                    publicExponent: new Uint8Array([1, 0, 1]),
                    hash: alg.hash
                },
                true,
                ['sign', 'verify']
            );

            const publicKeyDer = await crypto.subtle.exportKey('spki', keyPair.publicKey);
            const privateKeyDer = await crypto.subtle.exportKey('pkcs8', keyPair.privateKey);

            const publicKeyPem = `-----BEGIN PUBLIC KEY-----\n${arrayBufferToBase64(publicKeyDer, 64)}\n-----END PUBLIC KEY-----`;
            const privateKeyPem = `-----BEGIN PRIVATE KEY-----\n${arrayBufferToBase64(privateKeyDer, 64)}\n-----END PRIVATE KEY-----`;

            return { publicKey: publicKeyPem, privateKey: privateKeyPem, error: null };
        } catch (e) {
            return { publicKey: '', privateKey: '', error: e.message };
        }
    }

    /**
     * 生成 ECDSA 密钥对
     * @param {string} algorithm - 算法（ES256/ES384/ES512）
     * @returns {Promise<{publicKey: string, privateKey: string, error: string|null}>}
     */
    async function generateEcdsaKeyPair(algorithm = 'ES256') {
        try {
            const alg = ALGORITHMS[algorithm];
            const keyPair = await crypto.subtle.generateKey(
                {
                    name: alg.name,
                    namedCurve: alg.namedCurve
                },
                true,
                ['sign', 'verify']
            );

            const publicKeyDer = await crypto.subtle.exportKey('spki', keyPair.publicKey);
            const privateKeyDer = await crypto.subtle.exportKey('pkcs8', keyPair.privateKey);

            const publicKeyPem = `-----BEGIN PUBLIC KEY-----\n${arrayBufferToBase64(publicKeyDer, 64)}\n-----END PUBLIC KEY-----`;
            const privateKeyPem = `-----BEGIN PRIVATE KEY-----\n${arrayBufferToBase64(privateKeyDer, 64)}\n-----END PRIVATE KEY-----`;

            return { publicKey: publicKeyPem, privateKey: privateKeyPem, error: null };
        } catch (e) {
            return { publicKey: '', privateKey: '', error: e.message };
        }
    }

    function arrayBufferToBase64(buffer, lineLength = 0) {
        const bytes = new Uint8Array(buffer);
        let base64 = btoa(String.fromCharCode(...bytes));
        if (lineLength > 0) {
            const lines = [];
            for (let i = 0; i < base64.length; i += lineLength) {
                lines.push(base64.slice(i, i + lineLength));
            }
            base64 = lines.join('\n');
        }
        return base64;
    }

    // ==================== JWK 管理 ====================

    /**
     * 验证 JWK 格式
     * @param {object} jwk - JWK 对象
     * @returns {{valid: boolean, keyType: string, error: string|null}}
     */
    function validateJwk(jwk) {
        if (!jwk || typeof jwk !== 'object') {
            return { valid: false, keyType: '', error: 'JWK 必须是对象' };
        }

        if (!jwk.kty) {
            return { valid: false, keyType: '', error: '缺少 kty 字段' };
        }

        const kty = jwk.kty;
        if (!['RSA', 'EC', 'oct'].includes(kty)) {
            return { valid: false, keyType: '', error: `不支持的密钥类型: ${kty}` };
        }

        if (kty === 'RSA') {
            if (!jwk.n || !jwk.e) {
                return { valid: false, keyType: 'RSA', error: 'RSA JWK 缺少 n 或 e 字段' };
            }
        } else if (kty === 'EC') {
            if (!jwk.crv || !jwk.x || !jwk.y) {
                return { valid: false, keyType: 'EC', error: 'EC JWK 缺少 crv、x 或 y 字段' };
            }
        } else if (kty === 'oct') {
            if (!jwk.k) {
                return { valid: false, keyType: 'oct', error: 'oct JWK 缺少 k 字段' };
            }
        }

        const isPrivate = kty === 'RSA' ? !!jwk.d : kty === 'EC' ? !!jwk.d : false;
        return {
            valid: true,
            keyType: kty,
            isPrivate,
            error: null
        };
    }

    /**
     * 解析 JWKS
     * @param {string} jwksJson - JWKS JSON 字符串
     * @returns {{keys: Array, error: string|null}}
     */
    function parseJwks(jwksJson) {
        try {
            const jwks = JSON.parse(jwksJson);
            if (!jwks.keys || !Array.isArray(jwks.keys)) {
                return { keys: [], error: 'JWKS 必须包含 keys 数组' };
            }
            return { keys: jwks.keys, error: null };
        } catch (e) {
            return { keys: [], error: `解析 JWKS 失败: ${e.message}` };
        }
    }

    /**
     * JWK 转 PEM（仅支持公钥）
     * @param {object} jwk - JWK 对象
     * @returns {Promise<{pem: string, error: string|null}>}
     */
    async function jwkToPem(jwk) {
        try {
            const validation = validateJwk(jwk);
            if (!validation.valid) {
                return { pem: '', error: validation.error };
            }

            let algorithm;
            if (jwk.kty === 'RSA') {
                algorithm = { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' };
            } else if (jwk.kty === 'EC') {
                algorithm = { name: 'ECDSA', namedCurve: jwk.crv };
            } else {
                return { pem: '', error: 'oct 类型不支持转换为 PEM' };
            }

            const keyUsage = jwk.d ? ['sign'] : ['verify'];
            const format = jwk.d ? 'pkcs8' : 'spki';

            const key = await crypto.subtle.importKey('jwk', jwk, algorithm, true, keyUsage);
            const exported = await crypto.subtle.exportKey(format, key);

            const type = jwk.d ? 'PRIVATE KEY' : 'PUBLIC KEY';
            const pem = `-----BEGIN ${type}-----\n${arrayBufferToBase64(exported, 64)}\n-----END ${type}-----`;

            return { pem, error: null };
        } catch (e) {
            return { pem: '', error: e.message };
        }
    }

    // ==================== 导出 API ====================

    return {
        // JWT 生成与验证
        generateJwt,
        verifyJwt,

        // 密钥生成
        generateHmacSecret,
        generateRsaKeyPair,
        generateEcdsaKeyPair,

        // JWK 管理
        validateJwk,
        parseJwks,
        jwkToPem,

        // 预设
        getPresets: () => JWT_PRESETS,
        getPreset: (name) => JWT_PRESETS[name],

        // 算法信息
        getSupportedAlgorithms: () => Object.keys(ALGORITHMS),
        getAlgorithmInfo: (alg) => ALGORITHMS[alg],

        // 工具函数
        base64UrlEncode,
        base64UrlDecode,
        base64UrlDecodeToString
    };
});
