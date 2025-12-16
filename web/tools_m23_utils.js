/* 工具箱（M23）CSV 解析与生成
 *
 * 设计目标：
 * - 纯算法、无 DOM 依赖
 * - 支持 CSV 解析和生成
 * - 支持自定义分隔符、引号处理
 * - 支持 CSV-JSON 互转
 */
(function (root, factory) {
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = factory();
    } else {
        root.DogToolboxM23Utils = factory();
    }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    // 默认配置
    const DEFAULT_OPTIONS = {
        delimiter: ',',
        quote: '"',
        escape: '"',
        hasHeader: true,
        skipEmptyLines: true
    };

    /**
     * 解析 CSV 文本为二维数组或对象数组
     * @param {string} text - CSV 文本
     * @param {Object} options - 配置选项
     * @returns {Array} 解析结果
     */
    function parseCSV(text, options = {}) {
        const opts = { ...DEFAULT_OPTIONS, ...options };
        const { delimiter, quote, escape, hasHeader, skipEmptyLines } = opts;

        const lines = [];
        let currentLine = [];
        let currentField = '';
        let inQuote = false;
        let i = 0;

        while (i < text.length) {
            const char = text[i];
            const nextChar = text[i + 1];

            if (inQuote) {
                // 在引号内
                if (char === escape && nextChar === quote) {
                    // 转义的引号
                    currentField += quote;
                    i += 2;
                } else if (char === quote) {
                    // 引号结束
                    inQuote = false;
                    i++;
                } else {
                    currentField += char;
                    i++;
                }
            } else {
                // 在引号外
                if (char === quote) {
                    // 引号开始
                    inQuote = true;
                    i++;
                } else if (char === delimiter) {
                    // 字段分隔符
                    currentLine.push(currentField);
                    currentField = '';
                    i++;
                } else if (char === '\r' && nextChar === '\n') {
                    // Windows 换行符 \r\n
                    currentLine.push(currentField);
                    if (!skipEmptyLines || currentLine.some(f => f !== '')) {
                        lines.push(currentLine);
                    }
                    currentLine = [];
                    currentField = '';
                    i += 2;
                } else if (char === '\n' || char === '\r') {
                    // Unix/Mac 换行符
                    currentLine.push(currentField);
                    if (!skipEmptyLines || currentLine.some(f => f !== '')) {
                        lines.push(currentLine);
                    }
                    currentLine = [];
                    currentField = '';
                    i++;
                } else {
                    currentField += char;
                    i++;
                }
            }
        }

        // 处理最后一行
        if (currentField !== '' || currentLine.length > 0) {
            currentLine.push(currentField);
            if (!skipEmptyLines || currentLine.some(f => f !== '')) {
                lines.push(currentLine);
            }
        }

        // 如果有表头，转换为对象数组
        if (hasHeader && lines.length > 0) {
            const headers = lines[0];
            return lines.slice(1).map(row => {
                const obj = {};
                headers.forEach((header, index) => {
                    obj[header] = row[index] !== undefined ? row[index] : '';
                });
                return obj;
            });
        }

        return lines;
    }

    /**
     * 将数据转换为 CSV 字符串
     * @param {Array} data - 二维数组或对象数组
     * @param {Object} options - 配置选项
     * @returns {string} CSV 字符串
     */
    function stringifyCSV(data, options = {}) {
        const opts = { ...DEFAULT_OPTIONS, ...options };
        const { delimiter, quote, escape } = opts;

        if (!Array.isArray(data) || data.length === 0) {
            return '';
        }

        const lines = [];
        const isObjectArray = typeof data[0] === 'object' && !Array.isArray(data[0]);

        if (isObjectArray) {
            // 对象数组：提取表头
            const headers = Object.keys(data[0]);
            lines.push(headers.map(h => escapeField(h, delimiter, quote, escape)));

            data.forEach(row => {
                const line = headers.map(header => {
                    const value = row[header];
                    return escapeField(value !== undefined ? String(value) : '', delimiter, quote, escape);
                });
                lines.push(line);
            });
        } else {
            // 二维数组
            data.forEach(row => {
                const line = row.map(field => {
                    return escapeField(field !== undefined ? String(field) : '', delimiter, quote, escape);
                });
                lines.push(line);
            });
        }

        return lines.map(line => line.join(delimiter)).join('\n');
    }

    /**
     * 转义字段（如果包含特殊字符则用引号包裹）
     * @param {string} field - 字段内容
     * @param {string} delimiter - 分隔符
     * @param {string} quote - 引号字符
     * @param {string} escape - 转义字符
     * @returns {string} 转义后的字段
     */
    function escapeField(field, delimiter, quote, escape) {
        const fieldStr = String(field);

        // 如果字段包含分隔符、引号、换行符，则需要引号包裹
        const needsQuote = fieldStr.includes(delimiter) ||
                          fieldStr.includes(quote) ||
                          fieldStr.includes('\n') ||
                          fieldStr.includes('\r');

        if (!needsQuote) {
            return fieldStr;
        }

        // 转义引号
        const escaped = fieldStr.replace(new RegExp(quote, 'g'), escape + quote);
        return quote + escaped + quote;
    }

    /**
     * CSV 转 JSON
     * @param {string} csv - CSV 文本
     * @param {Object} options - 配置选项
     * @returns {string} JSON 字符串
     */
    function csvToJson(csv, options = {}) {
        const opts = { ...DEFAULT_OPTIONS, hasHeader: true, ...options };
        const data = parseCSV(csv, opts);
        return JSON.stringify(data, null, 2);
    }

    /**
     * JSON 转 CSV
     * @param {string|Array} json - JSON 字符串或数组
     * @param {Object} options - 配置选项
     * @returns {string} CSV 字符串
     */
    function jsonToCsv(json, options = {}) {
        let data;
        if (typeof json === 'string') {
            try {
                data = JSON.parse(json);
            } catch (e) {
                throw new Error('无效的 JSON 格式：' + e.message);
            }
        } else {
            data = json;
        }

        if (!Array.isArray(data)) {
            throw new Error('JSON 必须是数组格式');
        }

        return stringifyCSV(data, options);
    }

    /**
     * 表格排序：按指定列排序
     * @param {Array<Array>} data - 二维数组
     * @param {number} columnIndex - 列索引
     * @param {string} direction - 排序方向：'asc' 或 'desc'
     * @returns {Array<Array>} 排序后的新数组
     */
    function sortTable(data, columnIndex, direction = 'asc') {
        if (!Array.isArray(data) || data.length === 0) return data;

        const dir = direction === 'desc' ? -1 : 1;

        return [...data].sort((a, b) => {
            const va = a[columnIndex];
            const vb = b[columnIndex];

            // 尝试数字比较
            const na = Number(va);
            const nb = Number(vb);
            const bothNum = !isNaN(na) && !isNaN(nb);

            if (bothNum) {
                return (na - nb) * dir;
            }

            // 字符串比较
            const sa = va == null ? '' : String(va);
            const sb = vb == null ? '' : String(vb);
            return sa.localeCompare(sb) * dir;
        });
    }

    /**
     * 表格过滤：根据关键词过滤行
     * @param {Array<Array>} data - 二维数组
     * @param {string} filterText - 过滤关键词
     * @returns {Array<Array>} 过滤后的新数组
     */
    function filterTable(data, filterText) {
        if (!Array.isArray(data) || !filterText) return data;

        const keyword = filterText.toLowerCase();

        return data.filter(row =>
            row.some(cell => {
                const cellStr = cell == null ? '' : String(cell);
                return cellStr.toLowerCase().includes(keyword);
            })
        );
    }

    /**
     * 自动检测分隔符
     * @param {string} text - CSV 文本
     * @returns {string} 检测到的分隔符
     */
    function detectDelimiter(text) {
        const lines = String(text ?? '').split(/\r?\n/).filter(l => l.trim());
        if (lines.length === 0) return ',';

        const firstLine = lines[0];
        const candidates = [',', '\t', ';', '|'];
        const counts = {};

        for (const delim of candidates) {
            const escaped = delim.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            counts[delim] = (firstLine.match(new RegExp(escaped, 'g')) || []).length;
        }

        let maxCount = 0;
        let detected = ',';
        for (const delim of candidates) {
            if (counts[delim] > maxCount) {
                maxCount = counts[delim];
                detected = delim;
            }
        }

        return detected;
    }

    return {
        parseCSV,
        stringifyCSV,
        csvToJson,
        jsonToCsv,
        sortTable,
        filterTable,
        detectDelimiter
    };
});
