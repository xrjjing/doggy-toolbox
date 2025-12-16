/* 工具箱（M19）Unicode 编解码
 *
 * 设计目标：
 * - 纯算法、无 DOM 依赖，便于浏览器与 Node 环境复用与单元测试
 * - 支持 \uXXXX、\xXX、&#xXXXX;、&#NNNN; 等多种格式
 */
(function (root, factory) {
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = factory();
    } else {
        root.DogToolboxM19Utils = factory();
    }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    // 检测是否为 Node 环境
    function isNodeEnv() {
        return typeof process !== 'undefined' && process.versions && process.versions.node;
    }

    // ==================== Unicode 转义序列 (\uXXXX) ====================
    function unicodeEscape(text) {
        const s = String(text ?? '');
        let result = '';
        for (const char of s) {
            const code = char.codePointAt(0);
            if (code > 0xFFFF) {
                // 代理对处理（emoji 等）
                const high = Math.floor((code - 0x10000) / 0x400) + 0xD800;
                const low = ((code - 0x10000) % 0x400) + 0xDC00;
                result += '\\u' + high.toString(16).toUpperCase().padStart(4, '0');
                result += '\\u' + low.toString(16).toUpperCase().padStart(4, '0');
            } else {
                result += '\\u' + code.toString(16).toUpperCase().padStart(4, '0');
            }
        }
        return result;
    }

    function unicodeUnescape(text) {
        const s = String(text ?? '');
        // 匹配 \uXXXX 格式
        return s.replace(/\\u([0-9A-Fa-f]{4})/g, (_, hex) => {
            return String.fromCharCode(parseInt(hex, 16));
        });
    }

    // ==================== 十六进制转义 (\xXX) ====================
    function hexEscape(text) {
        const s = String(text ?? '');
        let result = '';
        const encoder = typeof TextEncoder !== 'undefined'
            ? new TextEncoder()
            : null;

        if (encoder) {
            const bytes = encoder.encode(s);
            for (const byte of bytes) {
                result += '\\x' + byte.toString(16).toUpperCase().padStart(2, '0');
            }
        } else if (isNodeEnv()) {
            // Node 环境回退
            const buf = Buffer.from(s, 'utf8');
            for (const byte of buf) {
                result += '\\x' + byte.toString(16).toUpperCase().padStart(2, '0');
            }
        } else {
            throw new Error('当前环境不支持 TextEncoder');
        }
        return result;
    }

    function hexUnescape(text) {
        const s = String(text ?? '');
        // 收集所有 \xXX 字节
        const bytes = [];
        let i = 0;
        while (i < s.length) {
            if (s[i] === '\\' && s[i + 1] === 'x' && i + 3 < s.length) {
                const hex = s.slice(i + 2, i + 4);
                if (/^[0-9A-Fa-f]{2}$/.test(hex)) {
                    bytes.push(parseInt(hex, 16));
                    i += 4;
                    continue;
                }
            }
            // 非 \xXX 序列，按 UTF-8 编码当前字符
            const char = s[i];
            const encoder = typeof TextEncoder !== 'undefined'
                ? new TextEncoder()
                : null;
            if (encoder) {
                for (const b of encoder.encode(char)) bytes.push(b);
            } else if (isNodeEnv()) {
                for (const b of Buffer.from(char, 'utf8')) bytes.push(b);
            } else {
                throw new Error('当前环境不支持 TextEncoder');
            }
            i++;
        }

        // 解码字节为 UTF-8 字符串
        const u8 = new Uint8Array(bytes);
        if (typeof TextDecoder !== 'undefined') {
            return new TextDecoder('utf-8', { fatal: false }).decode(u8);
        } else if (isNodeEnv()) {
            return Buffer.from(u8).toString('utf8');
        } else {
            throw new Error('当前环境不支持 TextDecoder');
        }
    }

    // ==================== HTML 实体编码 ====================
    function htmlEntityEncode(text, useHex = true) {
        const s = String(text ?? '');
        let result = '';
        for (const char of s) {
            const code = char.codePointAt(0);
            if (useHex) {
                result += '&#x' + code.toString(16).toUpperCase() + ';';
            } else {
                result += '&#' + code + ';';
            }
        }
        return result;
    }

    function htmlEntityDecode(text) {
        const s = String(text ?? '');
        // 匹配 &#xXXXX; 或 &#NNNN;
        return s.replace(/&#x([0-9A-Fa-f]+);|&#(\d+);/g, (_, hex, dec) => {
            const code = hex ? parseInt(hex, 16) : parseInt(dec, 10);
            return String.fromCodePoint(code);
        });
    }

    // ==================== 格式自动检测 ====================
    function detectFormat(text) {
        const s = String(text ?? '').trim();
        if (!s) return 'unknown';

        // 优先级：\uXXXX > \xXX > &#xXXXX; > &#NNNN; > plain
        if (/\\u[0-9A-Fa-f]{4}/.test(s)) return 'unicode';
        if (/\\x[0-9A-Fa-f]{2}/.test(s)) return 'hex';
        if (/&#x[0-9A-Fa-f]+;/.test(s)) return 'html_hex';
        if (/&#\d+;/.test(s)) return 'html_dec';
        return 'plain';
    }

    // ==================== 智能解码（自动检测格式） ====================
    function smartDecode(text) {
        const s = String(text ?? '');
        const format = detectFormat(s);

        switch (format) {
            case 'unicode':
                return { result: unicodeUnescape(s), format: 'Unicode (\\uXXXX)' };
            case 'hex':
                return { result: hexUnescape(s), format: 'Hex (\\xXX)' };
            case 'html_hex':
            case 'html_dec':
                return { result: htmlEntityDecode(s), format: 'HTML Entity' };
            default:
                return { result: s, format: '纯文本' };
        }
    }

    // ==================== 批量处理 ====================
    function batchEncode(text, format) {
        const lines = String(text ?? '').split(/\r?\n/);
        return lines.map(line => {
            if (!line) return '';
            switch (format) {
                case 'unicode':
                    return unicodeEscape(line);
                case 'hex':
                    return hexEscape(line);
                case 'html_hex':
                    return htmlEntityEncode(line, true);
                case 'html_dec':
                    return htmlEntityEncode(line, false);
                default:
                    return line;
            }
        }).join('\n');
    }

    function batchDecode(text, format) {
        const lines = String(text ?? '').split(/\r?\n/);
        return lines.map(line => {
            if (!line) return '';
            switch (format) {
                case 'unicode':
                    return unicodeUnescape(line);
                case 'hex':
                    return hexUnescape(line);
                case 'html_hex':
                case 'html_dec':
                case 'html':
                    return htmlEntityDecode(line);
                case 'auto':
                    return smartDecode(line).result;
                default:
                    return line;
            }
        }).join('\n');
    }

    // ==================== 完整编码（所有格式输出） ====================
    function encodeAll(text) {
        const s = String(text ?? '');
        return {
            unicode: unicodeEscape(s),
            hex: hexEscape(s),
            htmlHex: htmlEntityEncode(s, true),
            htmlDec: htmlEntityEncode(s, false)
        };
    }

    return {
        unicodeEscape,
        unicodeUnescape,
        hexEscape,
        hexUnescape,
        htmlEntityEncode,
        htmlEntityDecode,
        detectFormat,
        smartDecode,
        batchEncode,
        batchDecode,
        encodeAll
    };
});
