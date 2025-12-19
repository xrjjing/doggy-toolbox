/* 工具箱（M36）HTML 实体编解码
 *
 * 设计目标：
 * - 纯算法、无 DOM 依赖，便于浏览器与 Node 环境复用与单元测试
 * - 支持命名实体、十进制、十六进制三种模式
 */
(function (root, factory) {
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = factory();
    } else {
        root.DogToolboxM36Utils = factory();
    }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    // 常用 HTML 命名实体映射（字符 → 实体名）
    // 使用 Unicode 码点避免编辑器字符显示问题
    const CHAR_TO_NAMED = {
        '&': 'amp',
        '<': 'lt',
        '>': 'gt',
        '"': 'quot',      // U+0022 ASCII 双引号
        "'": 'apos',      // U+0027 ASCII 单引号
        '\u00A0': 'nbsp', // 不间断空格（非普通空格）
        '\u00A9': 'copy', // ©
        '\u00AE': 'reg',  // ®
        '\u2122': 'trade', // ™
        '\u20AC': 'euro', // €
        '\u00A3': 'pound', // £
        '\u00A5': 'yen',  // ¥
        '\u00A2': 'cent', // ¢
        '\u00A7': 'sect', // §
        '\u00B0': 'deg',  // °
        '\u00B1': 'plusmn', // ±
        '\u00D7': 'times', // ×
        '\u00F7': 'divide', // ÷
        '\u00B6': 'para', // ¶
        '\u2022': 'bull', // •
        '\u2026': 'hellip', // …
        '\u2013': 'ndash', // –
        '\u2014': 'mdash', // —
        '\u2018': 'lsquo', // ' 左单引号
        '\u2019': 'rsquo', // ' 右单引号
        '\u201C': 'ldquo', // " 左双引号
        '\u201D': 'rdquo', // " 右双引号
        '\u00AB': 'laquo', // «
        '\u00BB': 'raquo', // »
        '\u2190': 'larr', // ←
        '\u2192': 'rarr', // →
        '\u2191': 'uarr', // ↑
        '\u2193': 'darr', // ↓
        '\u2194': 'harr', // ↔
        '\u2660': 'spades', // ♠
        '\u2663': 'clubs', // ♣
        '\u2665': 'hearts', // ♥
        '\u2666': 'diams', // ♦
        '\u221E': 'infin', // ∞
        '\u221A': 'radic', // √
        '\u2211': 'sum',  // ∑
        '\u220F': 'prod', // ∏
        '\u222B': 'int',  // ∫
        '\u2248': 'asymp', // ≈
        '\u2260': 'ne',   // ≠
        '\u2264': 'le',   // ≤
        '\u2265': 'ge',   // ≥
        '\u03B1': 'alpha', // α
        '\u03B2': 'beta', // β
        '\u03B3': 'gamma', // γ
        '\u03B4': 'delta', // δ
        '\u03B5': 'epsilon', // ε
        '\u03C0': 'pi',   // π
        '\u03C3': 'sigma', // σ
        '\u03C4': 'tau',  // τ
        '\u03C9': 'omega', // ω
        '\u03A9': 'Omega', // Ω
    };

    // 反向映射（实体名 → 字符）
    const NAMED_TO_CHAR = {};
    for (const char in CHAR_TO_NAMED) {
        NAMED_TO_CHAR[CHAR_TO_NAMED[char]] = char;
    }

    // 需要强制编码的基础字符（防止 XSS）
    const MUST_ENCODE = new Set(['&', '<', '>', '"', "'"]);

    // Unicode 最大有效码点
    const MAX_CODEPOINT = 0x10FFFF;

    // 检查码点是否有效（排除代理项区间）
    function isValidCodePoint(code) {
        return Number.isFinite(code) &&
               code >= 0 &&
               code <= MAX_CODEPOINT &&
               !(code >= 0xD800 && code <= 0xDFFF); // 排除代理项
    }

    /**
     * HTML 实体编码
     * @param {string} text - 输入文本
     * @param {object} options - 配置项
     * @param {string} options.mode - 编码模式：'named' | 'decimal' | 'hex'
     * @param {boolean} options.encodeAll - 是否编码所有非 ASCII 字符
     * @returns {string}
     */
    function encodeHtmlEntities(text, options = {}) {
        const s = String(text ?? '');
        const mode = options.mode || 'named';
        const encodeAll = !!options.encodeAll;

        let result = '';
        for (const char of s) {
            const code = char.codePointAt(0);

            // 判断是否需要编码
            const mustEncode = MUST_ENCODE.has(char);
            const hasNamed = Object.prototype.hasOwnProperty.call(CHAR_TO_NAMED, char);
            const isNonAscii = code > 127;
            const shouldEncode = mustEncode || (encodeAll && isNonAscii) || (hasNamed && char !== '\u00A0');

            // 普通空格不编码，只有 &nbsp; 对应的不间断空格才编码
            if (!shouldEncode) {
                result += char;
                continue;
            }

            // 根据模式选择编码方式
            if (mode === 'named' && hasNamed) {
                result += '&' + CHAR_TO_NAMED[char] + ';';
            } else if (mode === 'hex') {
                result += '&#x' + code.toString(16).toUpperCase() + ';';
            } else {
                // decimal 或 named 模式下无命名实体时
                result += '&#' + code + ';';
            }
        }
        return result;
    }

    /**
     * HTML 实体解码
     * @param {string} text - 包含 HTML 实体的文本
     * @returns {string}
     */
    function decodeHtmlEntities(text) {
        const s = String(text ?? '');
        if (!s) return '';

        // 支持 &#xHHHH; &#XHHHH; &#DDDD; &name;
        return s.replace(/&(#[xX]?)?([a-zA-Z0-9]+);/g, (match, prefix, value) => {
            if (prefix === '#x' || prefix === '#X') {
                // 十六进制数字实体
                if (!/^[0-9a-fA-F]+$/.test(value)) return match;
                const code = parseInt(value, 16);
                if (isValidCodePoint(code)) {
                    try {
                        return String.fromCodePoint(code);
                    } catch (e) {
                        return match;
                    }
                }
            } else if (prefix === '#') {
                // 十进制数字实体
                if (!/^[0-9]+$/.test(value)) return match;
                const code = parseInt(value, 10);
                if (isValidCodePoint(code)) {
                    try {
                        return String.fromCodePoint(code);
                    } catch (e) {
                        return match;
                    }
                }
            } else {
                // 命名实体
                if (Object.prototype.hasOwnProperty.call(NAMED_TO_CHAR, value)) {
                    return NAMED_TO_CHAR[value];
                }
                // 尝试小写匹配
                const lower = value.toLowerCase();
                if (Object.prototype.hasOwnProperty.call(NAMED_TO_CHAR, lower)) {
                    return NAMED_TO_CHAR[lower];
                }
            }
            // 无法识别，原样返回
            return match;
        });
    }

    /**
     * 获取支持的命名实体列表
     * @returns {Array<{char: string, name: string, decimal: number, hex: string}>}
     */
    function getNamedEntities() {
        const list = [];
        for (const char in CHAR_TO_NAMED) {
            const code = char.codePointAt(0);
            list.push({
                char,
                name: CHAR_TO_NAMED[char],
                decimal: code,
                hex: code.toString(16).toUpperCase()
            });
        }
        return list;
    }

    return {
        encodeHtmlEntities,
        decodeHtmlEntities,
        getNamedEntities
    };
});
