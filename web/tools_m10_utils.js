/* 工具箱（M10）JSON 格式化工具
 *
 * 设计目标：
 * - 纯算法、无 DOM 依赖
 * - JSON 格式化/压缩/校验/排序/转义
 */
(function (root, factory) {
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = factory();
    } else {
        root.DogToolboxM10Utils = factory();
    }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    /**
     * 格式化 JSON（保持原始键顺序）
     * @param {string} text - JSON 字符串
     * @param {number|string} indent - 缩进（2/4/'\t'）
     * @returns {{result: string, error: string|null, line: number|null}}
     */
    function formatJson(text, indent) {
        const s = String(text ?? '').trim();
        if (!s) return { result: '', error: null, line: null };

        try {
            // 使用自定义序列化以保持原始键顺序
            const indentVal = indent === 'tab' ? '\t' : (parseInt(String(indent), 10) || 2);
            const result = formatJsonPreserveOrder(s, indentVal);
            return { result: result, error: null, line: null };
        } catch (e) {
            const lineInfo = extractErrorLine(e.message, s);
            return { result: '', error: e.message, line: lineInfo };
        }
    }

    /**
     * 保持原始键顺序的 JSON 格式化
     * JavaScript 的 JSON.parse 对于数字键会自动排序，这里通过正则解析保持原始顺序
     */
    function formatJsonPreserveOrder(jsonStr, indent) {
        // 先验证 JSON 有效性
        JSON.parse(jsonStr);

        // 使用字符级别的解析来保持原始顺序
        let pos = 0;
        const len = jsonStr.length;

        function skipWhitespace() {
            while (pos < len && /\s/.test(jsonStr[pos])) pos++;
        }

        function parseValue(depth) {
            skipWhitespace();
            if (pos >= len) throw new Error('Unexpected end of JSON');

            const ch = jsonStr[pos];
            if (ch === '{') return parseObject(depth);
            if (ch === '[') return parseArray(depth);
            if (ch === '"') return parseString();
            if (ch === '-' || (ch >= '0' && ch <= '9')) return parseNumber();
            if (jsonStr.slice(pos, pos + 4) === 'true') { pos += 4; return 'true'; }
            if (jsonStr.slice(pos, pos + 5) === 'false') { pos += 5; return 'false'; }
            if (jsonStr.slice(pos, pos + 4) === 'null') { pos += 4; return 'null'; }
            throw new Error('Unexpected character: ' + ch);
        }

        function parseString() {
            const start = pos;
            pos++; // skip opening quote
            while (pos < len) {
                if (jsonStr[pos] === '\\') {
                    pos += 2; // skip escape sequence
                } else if (jsonStr[pos] === '"') {
                    pos++;
                    return jsonStr.slice(start, pos);
                } else {
                    pos++;
                }
            }
            throw new Error('Unterminated string');
        }

        function parseNumber() {
            const start = pos;
            if (jsonStr[pos] === '-') pos++;
            while (pos < len && jsonStr[pos] >= '0' && jsonStr[pos] <= '9') pos++;
            if (pos < len && jsonStr[pos] === '.') {
                pos++;
                while (pos < len && jsonStr[pos] >= '0' && jsonStr[pos] <= '9') pos++;
            }
            if (pos < len && (jsonStr[pos] === 'e' || jsonStr[pos] === 'E')) {
                pos++;
                if (pos < len && (jsonStr[pos] === '+' || jsonStr[pos] === '-')) pos++;
                while (pos < len && jsonStr[pos] >= '0' && jsonStr[pos] <= '9') pos++;
            }
            return jsonStr.slice(start, pos);
        }

        function parseObject(depth) {
            const indentStr = typeof indent === 'string' ? indent : ' '.repeat(indent);
            const currentIndent = indentStr.repeat(depth);
            const nextIndent = indentStr.repeat(depth + 1);

            pos++; // skip {
            skipWhitespace();

            if (jsonStr[pos] === '}') {
                pos++;
                return '{}';
            }

            const pairs = [];
            while (true) {
                skipWhitespace();
                const key = parseString();
                skipWhitespace();
                if (jsonStr[pos] !== ':') throw new Error('Expected : after key');
                pos++;
                const value = parseValue(depth + 1);
                pairs.push(nextIndent + key + ': ' + value);

                skipWhitespace();
                if (jsonStr[pos] === '}') {
                    pos++;
                    break;
                }
                if (jsonStr[pos] !== ',') throw new Error('Expected , or }');
                pos++;
            }

            return '{\n' + pairs.join(',\n') + '\n' + currentIndent + '}';
        }

        function parseArray(depth) {
            const indentStr = typeof indent === 'string' ? indent : ' '.repeat(indent);
            const currentIndent = indentStr.repeat(depth);
            const nextIndent = indentStr.repeat(depth + 1);

            pos++; // skip [
            skipWhitespace();

            if (jsonStr[pos] === ']') {
                pos++;
                return '[]';
            }

            const items = [];
            while (true) {
                const value = parseValue(depth + 1);
                items.push(nextIndent + value);

                skipWhitespace();
                if (jsonStr[pos] === ']') {
                    pos++;
                    break;
                }
                if (jsonStr[pos] !== ',') throw new Error('Expected , or ]');
                pos++;
            }

            return '[\n' + items.join(',\n') + '\n' + currentIndent + ']';
        }

        return parseValue(0);
    }

    /**
     * 压缩 JSON（移除空白）
     * @param {string} text - JSON 字符串
     * @returns {{result: string, error: string|null, line: number|null}}
     */
    function minifyJson(text) {
        const s = String(text ?? '').trim();
        if (!s) return { result: '', error: null, line: null };

        try {
            const obj = JSON.parse(s);
            return { result: JSON.stringify(obj), error: null, line: null };
        } catch (e) {
            const lineInfo = extractErrorLine(e.message, s);
            return { result: '', error: e.message, line: lineInfo };
        }
    }

    /**
     * 校验 JSON
     * @param {string} text - JSON 字符串
     * @returns {{valid: boolean, error: string|null, line: number|null}}
     */
    function validateJson(text) {
        const s = String(text ?? '').trim();
        if (!s) return { valid: true, error: null, line: null };

        try {
            JSON.parse(s);
            return { valid: true, error: null, line: null };
        } catch (e) {
            const lineInfo = extractErrorLine(e.message, s);
            return { valid: false, error: e.message, line: lineInfo };
        }
    }

    /**
     * 从错误消息中提取行号
     */
    function extractErrorLine(message, text) {
        const posMatch = message.match(/position\s+(\d+)/i);
        if (posMatch) {
            const pos = parseInt(posMatch[1], 10);
            return positionToLine(text, pos);
        }

        const lineMatch = message.match(/line\s+(\d+)/i);
        if (lineMatch) {
            return parseInt(lineMatch[1], 10);
        }

        return null;
    }

    /**
     * 字符位置转行号
     */
    function positionToLine(text, pos) {
        if (!text || pos < 0) return 1;
        const before = text.substring(0, pos);
        return (before.match(/\n/g) || []).length + 1;
    }

    /**
     * 尝试修复常见 JSON 错误
     * @param {string} text - 可能格式不正确的 JSON
     * @returns {string} 尝试修复后的字符串
     */
    function tryFixJson(text) {
        let s = String(text ?? '').trim();
        if (!s) return s;

        // 移除尾部逗号
        s = s.replace(/,(\s*[}\]])/g, '$1');

        // 修复单引号为双引号
        s = s.replace(/'([^'\\]*(\\.[^'\\]*)*)'/g, '"$1"');

        return s;
    }

    /**
     * 对 JSON 对象的键进行递归排序
     * @param {string} text - JSON 字符串
     * @param {string} order - 排序方式: 'asc' 升序, 'desc' 降序
     * @param {number|string} indent - 缩进
     * @returns {{result: string, error: string|null}}
     */
    function sortJsonFields(text, order, indent) {
        const s = String(text ?? '').trim();
        if (!s) return { result: '', error: null };

        try {
            const obj = JSON.parse(s);
            const sorted = sortObjectKeys(obj, order === 'desc');
            const indentVal = indent === 'tab' ? '\t' : (parseInt(String(indent), 10) || 2);
            return { result: JSON.stringify(sorted, null, indentVal), error: null };
        } catch (e) {
            return { result: '', error: e.message };
        }
    }

    /**
     * 递归排序对象的键
     */
    function sortObjectKeys(obj, desc) {
        if (obj === null || typeof obj !== 'object') {
            return obj;
        }

        if (Array.isArray(obj)) {
            return obj.map(item => sortObjectKeys(item, desc));
        }

        const keys = Object.keys(obj).sort((a, b) => {
            return desc ? b.localeCompare(a) : a.localeCompare(b);
        });

        const sorted = {};
        for (const key of keys) {
            sorted[key] = sortObjectKeys(obj[key], desc);
        }
        return sorted;
    }

    /**
     * 转义 JSON 字符串（用于嵌入其他字符串中）
     * @param {string} text - JSON 字符串
     * @returns {{result: string, error: string|null}}
     */
    function escapeJson(text) {
        const s = String(text ?? '');
        if (!s) return { result: '', error: null };

        try {
            // 先验证是否为有效 JSON
            JSON.parse(s);
            // 转义：将整个 JSON 作为字符串值进行转义
            const escaped = JSON.stringify(s);
            // 移除外层引号
            return { result: escaped.slice(1, -1), error: null };
        } catch (e) {
            // 即使不是有效 JSON，也进行字符串转义
            const escaped = JSON.stringify(s);
            return { result: escaped.slice(1, -1), error: null };
        }
    }

    /**
     * 反转义 JSON 字符串
     * @param {string} text - 已转义的字符串
     * @returns {{result: string, error: string|null}}
     */
    function unescapeJson(text) {
        const s = String(text ?? '');
        if (!s) return { result: '', error: null };

        try {
            // 添加引号使其成为有效的 JSON 字符串，然后解析
            const unescaped = JSON.parse('"' + s + '"');
            return { result: unescaped, error: null };
        } catch (e) {
            return { result: '', error: '反转义失败: ' + e.message };
        }
    }

    /**
     * 复制文本到剪贴板
     * @param {string} text - 要复制的文本
     * @returns {Promise<boolean>}
     */
    async function copyToClipboard(text) {
        try {
            await navigator.clipboard.writeText(text);
            return true;
        } catch (e) {
            // 降级方案
            const textarea = document.createElement('textarea');
            textarea.value = text;
            textarea.style.position = 'fixed';
            textarea.style.opacity = '0';
            document.body.appendChild(textarea);
            textarea.select();
            const success = document.execCommand('copy');
            document.body.removeChild(textarea);
            return success;
        }
    }

    return {
        formatJson,
        minifyJson,
        validateJson,
        tryFixJson,
        sortJsonFields,
        escapeJson,
        unescapeJson,
        copyToClipboard,
        extractErrorLine,
        positionToLine
    };
});
