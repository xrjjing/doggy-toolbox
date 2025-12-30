/* 工具箱（M2）通用算法工具：Base64 / UUID / 命名转换
 *
 * 设计目标：
 * - 纯算法、无 DOM 依赖，便于在浏览器与 Node 环境复用与单元测试
 * - 输入输出统一按 UTF-8 处理
 */
(function (root, factory) {
    // UMD：浏览器挂到 window；Node 通过 module.exports 导出
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = factory();
    } else {
        root.DogToolboxM2Utils = factory();
    }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    function isNodeEnv() {
        return typeof process !== 'undefined' && process.versions && process.versions.node;
    }

    function getWebCrypto() {
        // 浏览器/Node(含 Web Crypto) 兼容
        if (typeof crypto !== 'undefined') return crypto;
        if (isNodeEnv()) {
            try {
                // eslint-disable-next-line global-require
                const nodeCrypto = require('crypto');
                return nodeCrypto.webcrypto;
            } catch (e) {
                return null;
            }
        }
        return null;
    }

    function utf8ToBytes(text) {
        if (typeof TextEncoder !== 'undefined') {
            return new TextEncoder().encode(String(text ?? ''));
        }
        if (isNodeEnv()) {
            return Uint8Array.from(Buffer.from(String(text ?? ''), 'utf8'));
        }
        // 兜底：最差情况只处理 ASCII
        const s = String(text ?? '');
        const arr = new Uint8Array(s.length);
        for (let i = 0; i < s.length; i++) arr[i] = s.charCodeAt(i) & 0xff;
        return arr;
    }

    function bytesToUtf8(bytes) {
        const u8 = bytes instanceof Uint8Array ? bytes : Uint8Array.from(bytes || []);
        if (typeof TextDecoder !== 'undefined') {
            // fatal=true：遇到非法 UTF-8 直接抛错，便于前端提示
            return new TextDecoder('utf-8', { fatal: true }).decode(u8);
        }
        if (isNodeEnv()) {
            return Buffer.from(u8).toString('utf8');
        }
        let s = '';
        for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]);
        return s;
    }

    function bytesToBase64(bytes) {
        const u8 = bytes instanceof Uint8Array ? bytes : Uint8Array.from(bytes || []);
        if (typeof btoa === 'function') {
            let binary = '';
            const chunkSize = 0x8000;
            for (let i = 0; i < u8.length; i += chunkSize) {
                const chunk = u8.subarray(i, i + chunkSize);
                binary += String.fromCharCode.apply(null, Array.from(chunk));
            }
            return btoa(binary);
        }
        if (isNodeEnv()) {
            return Buffer.from(u8).toString('base64');
        }
        throw new Error('当前环境不支持 Base64 编码');
    }

    function normalizeBase64Input(input) {
        const raw = String(input ?? '');
        const stripped = raw.replace(/\s+/g, '');
        if (!stripped) return '';
        // base64 字符集校验（支持标准 base64，不包含 base64url）
        if (!/^[A-Za-z0-9+/=]+$/.test(stripped)) {
            throw new Error('非法 Base64：包含不支持的字符');
        }
        // 自动补齐 padding
        const mod = stripped.length % 4;
        if (mod === 1) {
            throw new Error('非法 Base64：长度不合法');
        }
        if (mod === 2) return stripped + '==';
        if (mod === 3) return stripped + '=';
        return stripped;
    }

    function base64ToBytes(base64Text) {
        const normalized = normalizeBase64Input(base64Text);
        if (!normalized) return new Uint8Array(0);

        if (typeof atob === 'function') {
            const binary = atob(normalized);
            const bytes = new Uint8Array(binary.length);
            for (let i = 0; i < binary.length; i++) {
                bytes[i] = binary.charCodeAt(i) & 0xff;
            }
            return bytes;
        }
        if (isNodeEnv()) {
            // Buffer 对非法输入容错较多，已在 normalizeBase64Input 做严格校验
            return Uint8Array.from(Buffer.from(normalized, 'base64'));
        }
        throw new Error('当前环境不支持 Base64 解码');
    }

    function base64EncodeTextUtf8(text) {
        return bytesToBase64(utf8ToBytes(text));
    }

    function base64DecodeToTextUtf8(base64Text) {
        return bytesToUtf8(base64ToBytes(base64Text));
    }

    function generateUuidV4() {
        const c = getWebCrypto();
        if (!c) throw new Error('当前环境不支持安全随机数（crypto）');
        if (typeof c.randomUUID === 'function') {
            return c.randomUUID();
        }
        if (typeof c.getRandomValues !== 'function') {
            throw new Error('当前环境不支持 getRandomValues');
        }
        const bytes = new Uint8Array(16);
        c.getRandomValues(bytes);
        // 版本号：0100
        bytes[6] = (bytes[6] & 0x0f) | 0x40;
        // 变体：10xx
        bytes[8] = (bytes[8] & 0x3f) | 0x80;
        const hex = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
        return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    }

    function splitWords(input) {
        const raw = String(input ?? '').trim();
        if (!raw) return [];
        // 统一分隔符为空格，再做 camel/pascal 拆分
        const normalized = raw.replace(/[_\-]+/g, ' ').replace(/\s+/g, ' ');
        const parts = normalized.split(' ').filter(Boolean);
        const words = [];
        // 兼容：USER_ID / userID / UserIDNumber / user2Age 等
        const pattern = /[A-Z]+(?=[A-Z][a-z]|[0-9]|$)|[A-Z]?[a-z]+|[0-9]+/g;
        for (const part of parts) {
            const matches = part.match(pattern);
            if (matches) words.push(...matches);
        }
        return words;
    }

    function isAcronym(word) {
        const w = String(word ?? '');
        return w.length > 1 && w === w.toUpperCase() && w !== w.toLowerCase();
    }

    function titleize(word) {
        const w = String(word ?? '');
        if (!w) return '';
        if (isAcronym(w)) return w;
        const lower = w.toLowerCase();
        return lower.charAt(0).toUpperCase() + lower.slice(1);
    }

    function toNamingFormats(input) {
        const words = splitWords(input);
        if (!words.length) {
            return {
                space: '',
                camelSpace: '',
                kebab: '',
                snakeUpper: '',
                pascal: '',
                camel: '',
                snake: ''
            };
        }

        const lowerWords = words.map(w => String(w).toLowerCase());
        const upperWords = words.map(w => String(w).toUpperCase());

        const pascal = words.map(titleize).join('');
        const camel = lowerWords[0] + words.slice(1).map(titleize).join('');

        return {
            space: lowerWords.join(' '),
            camelSpace: words.map(titleize).join(' '),
            kebab: lowerWords.join('-'),
            snakeUpper: upperWords.join('_'),
            pascal,
            camel,
            snake: lowerWords.join('_')
        };
    }

    /**
     * 检测解码后内容的类型
     * @param {string} decoded - 解码后的文本
     * @returns {{type: string, confidence: number, targetTool: string|null}}
     */
    function detectBase64ContentType(decoded) {
        const text = String(decoded ?? '').trim();
        if (!text) {
            return { type: 'empty', confidence: 1, targetTool: null };
        }

        // JSON 检测
        if ((text.startsWith('{') && text.endsWith('}')) ||
            (text.startsWith('[') && text.endsWith(']'))) {
            try {
                JSON.parse(text);
                return { type: 'json', confidence: 0.95, targetTool: 'tool-json' };
            } catch (e) {
                // 可能是格式不正确的 JSON
            }
        }

        // URL 检测
        if (/^https?:\/\//i.test(text)) {
            return { type: 'url', confidence: 0.9, targetTool: 'tool-url' };
        }

        // HTML 检测
        if (/^<!DOCTYPE\s+html/i.test(text) || /^<html[\s>]/i.test(text) ||
            /<\/?(?:div|span|p|a|img|table|form|input|button|head|body|script|style)\b/i.test(text)) {
            return { type: 'html', confidence: 0.85, targetTool: 'tool-html-entity' };
        }

        // XML 检测
        if (/^<\?xml\s/i.test(text) || /^<[a-z_][\w\-.:]*[\s>]/i.test(text)) {
            return { type: 'xml', confidence: 0.8, targetTool: null };
        }

        // JWT 检测 (header.payload.signature)
        if (/^eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(text)) {
            return { type: 'jwt', confidence: 0.95, targetTool: 'tool-jwt' };
        }

        // 图片 magic bytes 检测 (解码后的二进制)
        // PNG: 0x89 0x50 0x4E 0x47 -> \x89PNG
        // JPEG: 0xFF 0xD8 0xFF
        // GIF: GIF87a 或 GIF89a
        if (text.startsWith('\x89PNG') || text.startsWith('\xFF\xD8\xFF') ||
            text.startsWith('GIF87a') || text.startsWith('GIF89a')) {
            return { type: 'image', confidence: 0.95, targetTool: 'tool-img-base64' };
        }

        // 纯文本
        return { type: 'text', confidence: 0.5, targetTool: null };
    }

    /**
     * 检测输入是否为 Base64 编码
     * @param {string} text - 输入文本
     * @returns {{isBase64: boolean, confidence: number}}
     */
    function detectBase64Encoded(text) {
        const s = String(text ?? '').trim();
        if (!s) return { isBase64: false, confidence: 0 };

        // 长度检查：Base64 编码后长度是 4 的倍数（含 padding）
        const stripped = s.replace(/\s+/g, '');
        if (stripped.length < 4) return { isBase64: false, confidence: 0.1 };

        // 字符集检查
        if (!/^[A-Za-z0-9+/=]+$/.test(stripped)) {
            return { isBase64: false, confidence: 0 };
        }

        // padding 检查
        const padMatch = stripped.match(/=+$/);
        const padLen = padMatch ? padMatch[0].length : 0;
        if (padLen > 2) return { isBase64: false, confidence: 0.2 };

        // 长度模 4 检查
        if ((stripped.length - padLen) % 4 !== 0 && stripped.length % 4 !== 0) {
            return { isBase64: false, confidence: 0.3 };
        }

        // 尝试解码验证
        try {
            base64ToBytes(stripped);
            // 高置信度：长度合理、字符集正确、可解码
            const confidence = stripped.length > 20 ? 0.9 : 0.7;
            return { isBase64: true, confidence };
        } catch (e) {
            return { isBase64: false, confidence: 0.2 };
        }
    }

    return {
        base64EncodeTextUtf8,
        base64DecodeToTextUtf8,
        generateUuidV4,
        toNamingFormats,
        detectBase64ContentType,
        detectBase64Encoded,
        // 仅供测试/调试
        _splitWords: splitWords
    };
});

