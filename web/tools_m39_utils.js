/* 工具箱（M39）TOML 格式化/验证
 *
 * 设计目标：
 * - TOML 解析与验证
 * - TOML 格式化与美化
 * - TOML ↔ JSON 互转
 */
(function (root, factory) {
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = factory();
    } else {
        root.DogToolboxM39Utils = factory();
    }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    // TOML 值类型
    const TOML_TYPES = {
        STRING: 'string',
        INTEGER: 'integer',
        FLOAT: 'float',
        BOOLEAN: 'boolean',
        DATETIME: 'datetime',
        ARRAY: 'array',
        TABLE: 'table'
    };

    /**
     * 移除行内注释（不在字符串内的 #）
     */
    function stripInlineComment(line) {
        let inString = false;
        let stringChar = '';
        let escaped = false;

        for (let i = 0; i < line.length; i++) {
            const ch = line[i];

            if (escaped) {
                escaped = false;
                continue;
            }

            if (ch === '\\' && inString) {
                escaped = true;
                continue;
            }

            if (!inString && (ch === '"' || ch === "'")) {
                // 检查是否是多行字符串开头
                if (line.slice(i, i + 3) === '"""' || line.slice(i, i + 3) === "'''") {
                    // 多行字符串，跳过（简化处理：假设单行内闭合）
                    const quote3 = line.slice(i, i + 3);
                    const endIdx = line.indexOf(quote3, i + 3);
                    if (endIdx > i) {
                        i = endIdx + 2;
                        continue;
                    }
                }
                inString = true;
                stringChar = ch;
            } else if (inString && ch === stringChar) {
                inString = false;
            } else if (!inString && ch === '#') {
                return line.slice(0, i);
            }
        }
        return line;
    }

    /**
     * 简易 TOML 解析器
     * 支持基本类型、表、数组、内联表
     */
    function parseTOML(input) {
        const lines = String(input || '').split(/\r?\n/);
        const result = {};
        let currentTable = result;
        let currentPath = [];
        let lineNum = 0;

        for (const rawLine of lines) {
            lineNum++;
            // 移除行内注释（不在字符串内的 #）
            const line = stripInlineComment(rawLine).trim();

            // 跳过空行和纯注释行
            if (!line || line.startsWith('#')) continue;

            // 表头 [table] 或 [[array]]
            if (line.startsWith('[')) {
                const isArray = line.startsWith('[[');
                const match = isArray
                    ? line.match(/^\[\[(.+)\]\]$/)
                    : line.match(/^\[(.+)\]$/);

                if (!match) {
                    throw new SyntaxError(`行 ${lineNum}: 无效的表头格式`);
                }

                const path = parseTablePath(match[1], lineNum);
                currentPath = path;

                if (isArray) {
                    // 数组表
                    let target = result;
                    for (let i = 0; i < path.length - 1; i++) {
                        const key = path[i];
                        if (!(key in target)) target[key] = {};
                        target = target[key];
                        if (Array.isArray(target)) target = target[target.length - 1];
                    }
                    const lastKey = path[path.length - 1];
                    if (!(lastKey in target)) target[lastKey] = [];
                    if (!Array.isArray(target[lastKey])) {
                        throw new SyntaxError(`行 ${lineNum}: '${lastKey}' 不是数组`);
                    }
                    const newObj = {};
                    target[lastKey].push(newObj);
                    currentTable = newObj;
                } else {
                    // 普通表
                    let target = result;
                    for (const key of path) {
                        if (!(key in target)) target[key] = {};
                        target = target[key];
                        if (Array.isArray(target)) target = target[target.length - 1];
                    }
                    currentTable = target;
                }
                continue;
            }

            // 键值对
            const eqIdx = line.indexOf('=');
            if (eqIdx === -1) {
                throw new SyntaxError(`行 ${lineNum}: 缺少 '=' 符号`);
            }

            const keyPart = line.slice(0, eqIdx).trim();
            const valuePart = line.slice(eqIdx + 1).trim();

            if (!keyPart) {
                throw new SyntaxError(`行 ${lineNum}: 缺少键名`);
            }

            const keyResult = parseKey(keyPart, lineNum);
            const value = parseValue(valuePart, lineNum);

            // 支持点分键（仅限裸键，引号键不拆分）
            if (keyResult.isDotted) {
                const parts = keyResult.key.split('.');
                let target = currentTable;
                for (let i = 0; i < parts.length - 1; i++) {
                    const part = parts[i];
                    if (!(part in target)) target[part] = {};
                    target = target[part];
                }
                target[parts[parts.length - 1]] = value;
            } else {
                currentTable[keyResult.key] = value;
            }
        }

        return result;
    }

    function parseTablePath(pathStr, lineNum) {
        const parts = [];
        let current = '';
        let inQuote = false;
        let quoteChar = '';

        for (let i = 0; i < pathStr.length; i++) {
            const ch = pathStr[i];
            if (inQuote) {
                if (ch === quoteChar) {
                    inQuote = false;
                    parts.push(current);
                    current = '';
                } else {
                    current += ch;
                }
            } else if (ch === '"' || ch === "'") {
                inQuote = true;
                quoteChar = ch;
            } else if (ch === '.') {
                if (current.trim()) {
                    parts.push(current.trim());
                    current = '';
                }
            } else {
                current += ch;
            }
        }
        if (current.trim()) parts.push(current.trim());
        if (parts.length === 0) {
            throw new SyntaxError(`行 ${lineNum}: 空表名`);
        }
        return parts;
    }

    function parseKey(keyStr, lineNum) {
        const s = keyStr.trim();
        // 引号键：保持原样，不拆分点号
        if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
            return { key: s.slice(1, -1), isDotted: false };
        }
        // 裸键：验证格式，允许点分键
        if (!/^[A-Za-z0-9_\-.]+$/.test(s) && !s.includes('.')) {
            throw new SyntaxError(`行 ${lineNum}: 无效的键名 '${s}'`);
        }
        return { key: s, isDotted: s.includes('.') };
    }

    function parseValue(valueStr, lineNum) {
        const s = valueStr.trim();

        // 布尔值
        if (s === 'true') return true;
        if (s === 'false') return false;

        // 字符串（基本、字面量、多行暂不完整支持）
        if (s.startsWith('"""') || s.startsWith("'''")) {
            const quote = s.slice(0, 3);
            const endIdx = s.lastIndexOf(quote);
            if (endIdx <= 2) throw new SyntaxError(`行 ${lineNum}: 未闭合的多行字符串`);
            return s.slice(3, endIdx);
        }
        if (s.startsWith('"')) {
            const endIdx = s.lastIndexOf('"');
            if (endIdx === 0) throw new SyntaxError(`行 ${lineNum}: 未闭合的字符串`);
            return parseBasicString(s.slice(1, endIdx), lineNum);
        }
        if (s.startsWith("'")) {
            const endIdx = s.lastIndexOf("'");
            if (endIdx === 0) throw new SyntaxError(`行 ${lineNum}: 未闭合的字符串`);
            return s.slice(1, endIdx); // 字面量字符串不转义
        }

        // 数组
        if (s.startsWith('[')) {
            return parseArray(s, lineNum);
        }

        // 内联表
        if (s.startsWith('{')) {
            return parseInlineTable(s, lineNum);
        }

        // 日期时间（简化处理）
        if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
            const d = new Date(s);
            if (!isNaN(d.getTime())) return s; // 保持字符串形式
        }

        // 数字
        const numMatch = s.match(/^([+-]?)(\d+(?:_\d+)*)(\.(\d+(?:_\d+)*))?([eE][+-]?\d+)?$/);
        if (numMatch) {
            const cleaned = s.replace(/_/g, '');
            return cleaned.includes('.') || cleaned.includes('e') || cleaned.includes('E')
                ? parseFloat(cleaned)
                : parseInt(cleaned, 10);
        }

        // 特殊浮点
        if (s === 'inf' || s === '+inf') return Infinity;
        if (s === '-inf') return -Infinity;
        if (s === 'nan' || s === '+nan' || s === '-nan') return NaN;

        // 十六进制、八进制、二进制
        if (/^0x[0-9a-fA-F_]+$/.test(s)) return parseInt(s.replace(/_/g, ''), 16);
        if (/^0o[0-7_]+$/.test(s)) return parseInt(s.replace(/_/g, '').slice(2), 8);
        if (/^0b[01_]+$/.test(s)) return parseInt(s.replace(/_/g, '').slice(2), 2);

        throw new SyntaxError(`行 ${lineNum}: 无法解析的值 '${s}'`);
    }

    function parseBasicString(str, lineNum) {
        return str.replace(/\\(.)/g, (_, ch) => {
            switch (ch) {
                case 'n': return '\n';
                case 't': return '\t';
                case 'r': return '\r';
                case '\\': return '\\';
                case '"': return '"';
                default: return ch;
            }
        });
    }

    function parseArray(str, lineNum) {
        const s = str.trim();
        if (!s.endsWith(']')) throw new SyntaxError(`行 ${lineNum}: 数组未闭合`);
        const inner = s.slice(1, -1).trim();
        if (!inner) return [];

        const items = [];
        let depth = 0;
        let current = '';
        let inString = false;
        let stringChar = '';

        for (let i = 0; i < inner.length; i++) {
            const ch = inner[i];
            if (inString) {
                current += ch;
                if (ch === stringChar && inner[i - 1] !== '\\') inString = false;
            } else if (ch === '"' || ch === "'") {
                inString = true;
                stringChar = ch;
                current += ch;
            } else if (ch === '[' || ch === '{') {
                depth++;
                current += ch;
            } else if (ch === ']' || ch === '}') {
                depth--;
                current += ch;
            } else if (ch === ',' && depth === 0) {
                const trimmed = current.trim();
                if (trimmed) items.push(parseValue(trimmed, lineNum));
                current = '';
            } else {
                current += ch;
            }
        }
        const trimmed = current.trim();
        if (trimmed) items.push(parseValue(trimmed, lineNum));

        return items;
    }

    function parseInlineTable(str, lineNum) {
        const s = str.trim();
        if (!s.endsWith('}')) throw new SyntaxError(`行 ${lineNum}: 内联表未闭合`);
        const inner = s.slice(1, -1).trim();
        if (!inner) return {};

        const result = {};
        // 使用状态机分割，处理嵌套结构和字符串内的逗号
        const pairs = splitByTopLevelComma(inner);

        for (const pair of pairs) {
            const trimmedPair = pair.trim();
            if (!trimmedPair) continue;
            const eqIdx = trimmedPair.indexOf('=');
            if (eqIdx === -1) continue;
            const keyResult = parseKey(trimmedPair.slice(0, eqIdx).trim(), lineNum);
            const value = parseValue(trimmedPair.slice(eqIdx + 1).trim(), lineNum);
            result[keyResult.key] = value;
        }

        return result;
    }

    /**
     * 按顶层逗号分割（处理嵌套结构和字符串）
     */
    function splitByTopLevelComma(str) {
        const parts = [];
        let depth = 0;
        let current = '';
        let inString = false;
        let stringChar = '';

        for (let i = 0; i < str.length; i++) {
            const ch = str[i];
            if (inString) {
                current += ch;
                if (ch === stringChar && str[i - 1] !== '\\') inString = false;
            } else if (ch === '"' || ch === "'") {
                inString = true;
                stringChar = ch;
                current += ch;
            } else if (ch === '[' || ch === '{') {
                depth++;
                current += ch;
            } else if (ch === ']' || ch === '}') {
                depth--;
                current += ch;
            } else if (ch === ',' && depth === 0) {
                parts.push(current);
                current = '';
            } else {
                current += ch;
            }
        }
        if (current) parts.push(current);
        return parts;
    }

    /**
     * 将对象序列化为 TOML 格式
     */
    function stringifyTOML(obj, indent = 0) {
        if (typeof obj !== 'object' || obj === null) {
            throw new TypeError('输入必须是对象');
        }

        const lines = [];
        const tables = [];
        const spaces = '    '.repeat(indent);

        // 先处理简单键值对
        for (const [key, value] of Object.entries(obj)) {
            if (value === null || value === undefined) continue;

            if (typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date)) {
                tables.push([key, value]);
            } else if (Array.isArray(value) && value.length > 0 && typeof value[0] === 'object' && !Array.isArray(value[0])) {
                tables.push([key, value]);
            } else {
                lines.push(`${formatKey(key)} = ${formatValue(value)}`);
            }
        }

        // 再处理表
        for (const [key, value] of tables) {
            if (Array.isArray(value)) {
                // 数组表
                for (const item of value) {
                    lines.push('');
                    lines.push(`[[${formatKey(key)}]]`);
                    const subLines = stringifyTOML(item, 0).split('\n');
                    lines.push(...subLines.filter(l => l.trim()));
                }
            } else {
                // 普通表
                lines.push('');
                lines.push(`[${formatKey(key)}]`);
                const subLines = stringifyTOML(value, 0).split('\n');
                lines.push(...subLines.filter(l => l.trim()));
            }
        }

        return lines.join('\n');
    }

    function formatKey(key) {
        if (/^[A-Za-z0-9_-]+$/.test(key)) {
            return key;
        }
        return `"${escapeString(key)}"`;
    }

    function formatValue(value) {
        if (typeof value === 'string') {
            return `"${escapeString(value)}"`;
        }
        if (typeof value === 'number') {
            if (Number.isNaN(value)) return 'nan';
            if (!Number.isFinite(value)) return value > 0 ? 'inf' : '-inf';
            return String(value);
        }
        if (typeof value === 'boolean') {
            return value ? 'true' : 'false';
        }
        if (value instanceof Date) {
            return value.toISOString();
        }
        if (Array.isArray(value)) {
            const items = value.map(v => formatValue(v));
            return `[${items.join(', ')}]`;
        }
        if (typeof value === 'object' && value !== null) {
            const pairs = Object.entries(value)
                .filter(([_, v]) => v !== null && v !== undefined)
                .map(([k, v]) => `${formatKey(k)} = ${formatValue(v)}`);
            return `{ ${pairs.join(', ')} }`;
        }
        return String(value);
    }

    function escapeString(str) {
        return str
            .replace(/\\/g, '\\\\')
            .replace(/"/g, '\\"')
            .replace(/\n/g, '\\n')
            .replace(/\r/g, '\\r')
            .replace(/\t/g, '\\t');
    }

    /**
     * 验证 TOML 语法
     */
    function validateTOML(input) {
        try {
            parseTOML(input);
            return { valid: true, error: null };
        } catch (e) {
            return { valid: false, error: e.message || String(e) };
        }
    }

    /**
     * TOML 转 JSON
     */
    function tomlToJSON(toml, indent = 2) {
        const obj = parseTOML(toml);
        return JSON.stringify(obj, null, indent);
    }

    /**
     * JSON 转 TOML
     */
    function jsonToTOML(json) {
        const obj = typeof json === 'string' ? JSON.parse(json) : json;
        return stringifyTOML(obj);
    }

    /**
     * 格式化 TOML
     */
    function formatTOML(input) {
        const obj = parseTOML(input);
        return stringifyTOML(obj);
    }

    return {
        parse: parseTOML,
        stringify: stringifyTOML,
        validate: validateTOML,
        toJSON: tomlToJSON,
        fromJSON: jsonToTOML,
        format: formatTOML,
        TYPES: TOML_TYPES
    };
});
