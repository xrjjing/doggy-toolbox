/* 工具箱（M20）RSA 非对称加密
 *
 * 设计目标：
 * - 纯算法、无 DOM 依赖
 * - 使用 Web Crypto API 实现 RSA 加解密
 * - 支持 RSA-OAEP 加密模式
 * - 支持密钥生成、导入/导出（PEM 格式）
 */
(function (root, factory) {
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = factory();
    } else {
        root.DogToolboxM20Utils = factory();
    }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    function isNodeEnv() {
        return typeof process !== 'undefined' && process.versions && process.versions.node;
    }

    function getSubtle() {
        if (typeof crypto !== 'undefined' && crypto.subtle) {
            return crypto.subtle;
        }
        if (isNodeEnv()) {
            return require('crypto').webcrypto.subtle;
        }
        throw new Error('当前环境不支持 Web Crypto API');
    }

    // ==================== 编码工具 ====================
    function utf8ToBytes(text) {
        const s = String(text ?? '');
        if (typeof TextEncoder !== 'undefined') {
            return new TextEncoder().encode(s);
        }
        if (isNodeEnv()) {
            return Uint8Array.from(Buffer.from(s, 'utf8'));
        }
        throw new Error('当前环境不支持 UTF-8 编码');
    }

    function bytesToUtf8(bytes) {
        const u8 = bytes instanceof Uint8Array ? bytes : Uint8Array.from(bytes || []);
        if (typeof TextDecoder !== 'undefined') {
            return new TextDecoder('utf-8').decode(u8);
        }
        if (isNodeEnv()) {
            return Buffer.from(u8).toString('utf8');
        }
        throw new Error('当前环境不支持 UTF-8 解码');
    }

    function bytesToBase64(bytes) {
        const u8 = bytes instanceof Uint8Array ? bytes : Uint8Array.from(bytes || []);
        if (typeof btoa === 'function') {
            let binary = '';
            for (let i = 0; i < u8.length; i++) binary += String.fromCharCode(u8[i]);
            return btoa(binary);
        }
        if (isNodeEnv()) {
            return Buffer.from(u8).toString('base64');
        }
        throw new Error('当前环境不支持 Base64 编码');
    }

    function base64ToBytes(b64) {
        let raw = String(b64 ?? '').trim();
        if (!raw) return new Uint8Array(0);
        // 补齐 padding
        const mod = raw.length % 4;
        if (mod === 2) raw += '==';
        else if (mod === 3) raw += '=';

        if (typeof atob === 'function') {
            const binary = atob(raw);
            const out = new Uint8Array(binary.length);
            for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i) & 0xff;
            return out;
        }
        if (isNodeEnv()) {
            return Uint8Array.from(Buffer.from(raw, 'base64'));
        }
        throw new Error('当前环境不支持 Base64 解码');
    }

    // ==================== PEM 解析/生成 ====================
    function pemToBytes(pem, type) {
        const typeStr = type === 'public' ? 'PUBLIC KEY' : 'PRIVATE KEY';
        const regex = new RegExp(`-----BEGIN ${typeStr}-----([\\s\\S]+?)-----END ${typeStr}-----`);
        const match = pem.match(regex);
        if (!match) {
            throw new Error(`无效的 PEM 格式：未找到 ${typeStr}`);
        }
        const b64 = match[1].replace(/[\r\n\s]/g, '');
        return base64ToBytes(b64);
    }

    function bytesToPem(bytes, type) {
        const typeStr = type === 'public' ? 'PUBLIC KEY' : 'PRIVATE KEY';
        const b64 = bytesToBase64(bytes);
        const lines = [];
        for (let i = 0; i < b64.length; i += 64) {
            lines.push(b64.slice(i, i + 64));
        }
        return `-----BEGIN ${typeStr}-----\n${lines.join('\n')}\n-----END ${typeStr}-----`;
    }

    // ==================== 密钥生成 ====================
    async function generateKeyPair(modulusLength = 2048) {
        const subtle = getSubtle();
        const keyPair = await subtle.generateKey(
            {
                name: 'RSA-OAEP',
                modulusLength: modulusLength,
                publicExponent: new Uint8Array([1, 0, 1]), // 65537
                hash: 'SHA-256'
            },
            true,
            ['encrypt', 'decrypt']
        );

        const publicKeyData = await subtle.exportKey('spki', keyPair.publicKey);
        const privateKeyData = await subtle.exportKey('pkcs8', keyPair.privateKey);

        return {
            publicKey: bytesToPem(new Uint8Array(publicKeyData), 'public'),
            privateKey: bytesToPem(new Uint8Array(privateKeyData), 'private')
        };
    }

    // ==================== 密钥导入 ====================
    async function importPublicKey(pem) {
        const subtle = getSubtle();
        const keyData = pemToBytes(pem, 'public');
        return await subtle.importKey(
            'spki',
            keyData,
            { name: 'RSA-OAEP', hash: 'SHA-256' },
            true,
            ['encrypt']
        );
    }

    async function importPrivateKey(pem) {
        const subtle = getSubtle();
        const keyData = pemToBytes(pem, 'private');
        return await subtle.importKey(
            'pkcs8',
            keyData,
            { name: 'RSA-OAEP', hash: 'SHA-256' },
            true,
            ['decrypt']
        );
    }

    // ==================== 加密/解密 ====================
    async function encrypt(plainText, publicKeyPem, outputFormat = 'base64') {
        const subtle = getSubtle();
        const publicKey = await importPublicKey(publicKeyPem);
        const plainBytes = utf8ToBytes(plainText);
        const encrypted = await subtle.encrypt(
            { name: 'RSA-OAEP' },
            publicKey,
            plainBytes
        );
        const result = new Uint8Array(encrypted);
        if (outputFormat === 'hex') {
            return Array.from(result).map(b => b.toString(16).padStart(2, '0')).join('');
        }
        return bytesToBase64(result);
    }

    async function decrypt(cipherText, privateKeyPem, inputFormat = 'base64') {
        const subtle = getSubtle();
        const privateKey = await importPrivateKey(privateKeyPem);

        let cipherBytes;
        if (inputFormat === 'hex') {
            const hex = cipherText.replace(/\s/g, '');
            if (hex.length % 2 !== 0) throw new Error('无效的 Hex 格式');
            cipherBytes = new Uint8Array(hex.length / 2);
            for (let i = 0; i < hex.length; i += 2) {
                cipherBytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
            }
        } else {
            cipherBytes = base64ToBytes(cipherText);
        }

        const decrypted = await subtle.decrypt(
            { name: 'RSA-OAEP' },
            privateKey,
            cipherBytes
        );
        return bytesToUtf8(new Uint8Array(decrypted));
    }

    // ==================== 密钥验证 ====================
    function validatePublicKey(pem) {
        try {
            pemToBytes(pem, 'public');
            return { valid: true, error: null };
        } catch (e) {
            return { valid: false, error: e.message };
        }
    }

    function validatePrivateKey(pem) {
        try {
            pemToBytes(pem, 'private');
            return { valid: true, error: null };
        } catch (e) {
            return { valid: false, error: e.message };
        }
    }

    // ==================== 获取密钥信息 ====================
    async function getPublicKeyInfo(pem) {
        try {
            const subtle = getSubtle();
            const key = await importPublicKey(pem);
            const exported = await subtle.exportKey('jwk', key);
            return {
                algorithm: exported.alg || 'RSA-OAEP',
                modulusLength: exported.n ? Math.ceil(exported.n.length * 6 / 8) * 8 : null,
                exponent: exported.e || null
            };
        } catch (e) {
            return { error: e.message };
        }
    }

    return {
        generateKeyPair,
        encrypt,
        decrypt,
        importPublicKey,
        importPrivateKey,
        validatePublicKey,
        validatePrivateKey,
        getPublicKeyInfo,
        pemToBytes,
        bytesToPem
    };
});
