/* 工具箱（M21）HMAC 计算
 *
 * 设计目标：
 * - 纯算法、无 DOM 依赖
 * - 使用 Web Crypto API 实现 HMAC-MD5/SHA1/SHA256/SHA512
 * - 支持密钥格式：文本/Hex/Base64
 * - 支持输出格式：Hex/Base64
 */
(function (root, factory) {
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = factory();
    } else {
        root.DogToolboxM21Utils = factory();
    }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    function isNodeEnv() {
        return typeof process !== 'undefined' && process.versions && process.versions.node;
    }

    // ==================== 字节/编码工具 ====================
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

    function hexToBytes(hex) {
        const raw = String(hex ?? '').trim().replace(/\s+/g, '');
        if (!raw) return new Uint8Array(0);
        if (raw.length % 2 !== 0) throw new Error('非法 Hex：长度必须为偶数');
        if (!/^[0-9a-fA-F]+$/.test(raw)) throw new Error('非法 Hex：包含非十六进制字符');
        const out = new Uint8Array(raw.length / 2);
        for (let i = 0; i < raw.length; i += 2) {
            out[i / 2] = parseInt(raw.slice(i, i + 2), 16) & 0xff;
        }
        return out;
    }

    function base64ToBytes(b64) {
        let raw = String(b64 ?? '').trim().replace(/\s+/g, '');
        if (!raw) return new Uint8Array(0);
        const mod = raw.length % 4;
        if (mod === 2) raw += '==';
        else if (mod === 3) raw += '=';
        else if (mod === 1) throw new Error('非法 Base64：长度不合法');
        if (!/^[A-Za-z0-9+/=]+$/.test(raw)) throw new Error('非法 Base64：包含不支持的字符');

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

    function bytesToHex(bytes) {
        const u8 = bytes instanceof Uint8Array ? bytes : Uint8Array.from(bytes || []);
        let out = '';
        for (let i = 0; i < u8.length; i++) out += u8[i].toString(16).padStart(2, '0');
        return out;
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

    // ==================== 密钥解析 ====================
    function parseKey(keyText, keyFormat) {
        const format = String(keyFormat || 'text').toLowerCase();
        switch (format) {
            case 'hex':
                return hexToBytes(keyText);
            case 'base64':
                return base64ToBytes(keyText);
            case 'text':
            default:
                return utf8ToBytes(keyText);
        }
    }

    // ==================== HMAC 计算（Web Crypto API） ====================
    async function hmacWebCrypto(message, keyBytes, algorithm) {
        const subtle = typeof crypto !== 'undefined' && crypto.subtle
            ? crypto.subtle
            : (isNodeEnv() ? require('crypto').webcrypto.subtle : null);

        if (!subtle) {
            throw new Error('当前环境不支持 Web Crypto API');
        }

        const algoMap = {
            'md5': 'MD5',         // 注意：Web Crypto 不支持 MD5，需要回退
            'sha1': 'SHA-1',
            'sha-1': 'SHA-1',
            'sha256': 'SHA-256',
            'sha-256': 'SHA-256',
            'sha512': 'SHA-512',
            'sha-512': 'SHA-512'
        };

        const normalizedAlgo = String(algorithm || 'sha256').toLowerCase();
        const hashAlgo = algoMap[normalizedAlgo];

        if (!hashAlgo) {
            throw new Error(`不支持的算法：${algorithm}`);
        }

        // Web Crypto 不支持 HMAC-MD5，使用自定义实现
        if (normalizedAlgo === 'md5') {
            return hmacMd5(message, keyBytes);
        }

        const cryptoKey = await subtle.importKey(
            'raw',
            keyBytes,
            { name: 'HMAC', hash: hashAlgo },
            false,
            ['sign']
        );

        const msgBytes = typeof message === 'string' ? utf8ToBytes(message) : message;
        const signature = await subtle.sign('HMAC', cryptoKey, msgBytes);
        return new Uint8Array(signature);
    }

    // ==================== HMAC-MD5 自定义实现 ====================
    function md5(message) {
        const bytes = typeof message === 'string' ? utf8ToBytes(message) : Uint8Array.from(message);
        return md5Bytes(bytes);
    }

    function md5Bytes(bytes) {
        // MD5 常量
        const S = [
            7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
            5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
            4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
            6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21
        ];

        const K = new Uint32Array(64);
        for (let i = 0; i < 64; i++) {
            K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 0x100000000) >>> 0;
        }

        // 初始值
        let a0 = 0x67452301 >>> 0;
        let b0 = 0xEFCDAB89 >>> 0;
        let c0 = 0x98BADCFE >>> 0;
        let d0 = 0x10325476 >>> 0;

        // 预处理
        const originalLen = bytes.length;
        const bitLen = originalLen * 8;

        // 填充到 56 mod 64
        let padLen = (56 - (originalLen + 1) % 64 + 64) % 64 + 1;
        const padded = new Uint8Array(originalLen + padLen + 8);
        padded.set(bytes);
        padded[originalLen] = 0x80;

        // 附加长度（小端序 64 位）
        const lenOffset = originalLen + padLen;
        padded[lenOffset] = bitLen & 0xff;
        padded[lenOffset + 1] = (bitLen >>> 8) & 0xff;
        padded[lenOffset + 2] = (bitLen >>> 16) & 0xff;
        padded[lenOffset + 3] = (bitLen >>> 24) & 0xff;
        // 高 32 位（对于大文件，这里简化处理）
        padded[lenOffset + 4] = 0;
        padded[lenOffset + 5] = 0;
        padded[lenOffset + 6] = 0;
        padded[lenOffset + 7] = 0;

        // 处理每个 512 位块
        const view = new DataView(padded.buffer);
        for (let offset = 0; offset < padded.length; offset += 64) {
            const M = new Uint32Array(16);
            for (let j = 0; j < 16; j++) {
                M[j] = view.getUint32(offset + j * 4, true);
            }

            let A = a0, B = b0, C = c0, D = d0;

            for (let i = 0; i < 64; i++) {
                let F, g;
                if (i < 16) {
                    F = (B & C) | ((~B >>> 0) & D);
                    g = i;
                } else if (i < 32) {
                    F = (D & B) | ((~D >>> 0) & C);
                    g = (5 * i + 1) % 16;
                } else if (i < 48) {
                    F = B ^ C ^ D;
                    g = (3 * i + 5) % 16;
                } else {
                    F = C ^ (B | (~D >>> 0));
                    g = (7 * i) % 16;
                }

                F = (F + A + K[i] + M[g]) >>> 0;
                A = D;
                D = C;
                C = B;
                B = (B + ((F << S[i]) | (F >>> (32 - S[i])))) >>> 0;
            }

            a0 = (a0 + A) >>> 0;
            b0 = (b0 + B) >>> 0;
            c0 = (c0 + C) >>> 0;
            d0 = (d0 + D) >>> 0;
        }

        // 输出（小端序）
        const result = new Uint8Array(16);
        const resultView = new DataView(result.buffer);
        resultView.setUint32(0, a0, true);
        resultView.setUint32(4, b0, true);
        resultView.setUint32(8, c0, true);
        resultView.setUint32(12, d0, true);

        return result;
    }

    function hmacMd5(message, keyBytes) {
        const blockSize = 64;
        let key = keyBytes instanceof Uint8Array ? keyBytes : Uint8Array.from(keyBytes || []);

        // 如果 key 长度超过 blockSize，先进行 hash
        if (key.length > blockSize) {
            key = md5Bytes(key);
        }

        // 填充 key 到 blockSize
        const paddedKey = new Uint8Array(blockSize);
        paddedKey.set(key);

        // 计算 ipad 和 opad
        const ipad = new Uint8Array(blockSize);
        const opad = new Uint8Array(blockSize);
        for (let i = 0; i < blockSize; i++) {
            ipad[i] = paddedKey[i] ^ 0x36;
            opad[i] = paddedKey[i] ^ 0x5c;
        }

        // 计算 HMAC
        const msgBytes = typeof message === 'string' ? utf8ToBytes(message) : Uint8Array.from(message);
        const inner = new Uint8Array(blockSize + msgBytes.length);
        inner.set(ipad);
        inner.set(msgBytes, blockSize);
        const innerHash = md5Bytes(inner);

        const outer = new Uint8Array(blockSize + 16);
        outer.set(opad);
        outer.set(innerHash, blockSize);

        return md5Bytes(outer);
    }

    // ==================== 公开 API ====================
    async function hmac(message, key, options = {}) {
        const {
            algorithm = 'sha256',
            keyFormat = 'text',
            outputFormat = 'hex'
        } = options;

        const keyBytes = parseKey(key, keyFormat);
        const resultBytes = await hmacWebCrypto(message, keyBytes, algorithm);

        if (outputFormat === 'base64') {
            return bytesToBase64(resultBytes);
        }
        return bytesToHex(resultBytes);
    }

    async function hmacBatch(text, key, options = {}) {
        const lines = String(text ?? '').split(/\r?\n/);
        const results = [];
        for (const line of lines) {
            if (line === '') {
                results.push('');
            } else {
                results.push(await hmac(line, key, options));
            }
        }
        return results.join('\n');
    }

    // 同步版本（仅支持 MD5）
    function hmacSync(message, key, options = {}) {
        const {
            algorithm = 'md5',
            keyFormat = 'text',
            outputFormat = 'hex'
        } = options;

        if (algorithm.toLowerCase() !== 'md5') {
            throw new Error('同步模式仅支持 MD5 算法');
        }

        const keyBytes = parseKey(key, keyFormat);
        const resultBytes = hmacMd5(message, keyBytes);

        if (outputFormat === 'base64') {
            return bytesToBase64(resultBytes);
        }
        return bytesToHex(resultBytes);
    }

    return {
        hmac,
        hmacBatch,
        hmacSync,
        parseKey,
        bytesToHex,
        bytesToBase64
    };
});
