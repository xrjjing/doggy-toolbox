/* 工具箱（M31）Excel/CSV 转 JSON 工具
 *
 * 设计目标：
 * - 纯算法、无 DOM 依赖
 * - 支持 CSV/TSV 格式解析
 * - 支持表格数据与 JSON 互转
 * - 支持首行作为表头
 * - 支持指定列类型转换
 */
(function (root, factory) {
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = factory();
    } else {
        root.DogToolboxM31Utils = factory();
    }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    /**
     * 检测分隔符
     * @param {string} text - 表格文本
     * @returns {string} - 分隔符（',', '\t', ';' 等）
     */
    function detectDelimiter(text) {
        const lines = String(text ?? '').split(/\r?\n/).filter(l => l.trim());
        if (lines.length === 0) return ',';

        const firstLine = lines[0];
        const candidates = [',', '\t', ';', '|'];
        const counts = {};

        for (const delim of candidates) {
            counts[delim] = (firstLine.match(new RegExp(escapeRegex(delim), 'g')) || []).length;
        }

        // 选择出现次数最多的分隔符
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

    function escapeRegex(str) {
        return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    /**
     * 解析表格数据
     * @param {string} text - 表格文本
     * @param {string} format - 格式：'csv', 'tsv', 'auto'
     * @returns {Array<Array<string>>} - 二维数组
     */
    function parseTableData(text, format) {
        const raw = String(text ?? '').trim();
        if (!raw) return [];

        let delimiter = ',';
        if (format === 'tsv') {
            delimiter = '\t';
        } else if (format === 'csv') {
            delimiter = ',';
        } else {
            delimiter = detectDelimiter(raw);
        }

        const lines = raw.split(/\r?\n/);
        const result = [];

        for (const line of lines) {
            if (!line.trim()) continue;
            const row = parseCsvLine(line, delimiter);
            result.push(row);
        }

        return result;
    }

    /**
     * 解析单行 CSV（支持引号包裹）
     * @param {string} line - 单行文本
     * @param {string} delimiter - 分隔符
     * @returns {Array<string>} - 列数组
     */
    function parseCsvLine(line, delimiter) {
        const result = [];
        let current = '';
        let inQuote = false;
        let i = 0;

        while (i < line.length) {
            const char = line[i];
            const next = line[i + 1];

            if (inQuote) {
                if (char === '"') {
                    if (next === '"') {
                        // 转义的引号
                        current += '"';
                        i += 2;
                        continue;
                    } else {
                        // 引号结束
                        inQuote = false;
                        i++;
                        continue;
                    }
                } else {
                    current += char;
                    i++;
                }
            } else {
                if (char === '"') {
                    inQuote = true;
                    i++;
                } else if (char === delimiter) {
                    result.push(current);
                    current = '';
                    i++;
                } else {
                    current += char;
                    i++;
                }
            }
        }

        result.push(current);
        return result;
    }

    /**
     * 表格数据转 JSON
     * @param {Array<Array<string>>} data - 二维数组
     * @param {Object} options - 配置选项
     * @param {boolean} options.hasHeader - 首行是否为表头
     * @param {string} options.outputFormat - 输出格式：'array'（数组）或 'object'（对象）
     * @param {Object} options.columnTypes - 列类型映射，如 { '0': 'number', '1': 'string', '2': 'boolean' }
     * @returns {Array} - JSON 数组
     */
    function tableToJson(data, options) {
        const opts = Object.assign({
            hasHeader: true,
            outputFormat: 'object',
            columnTypes: {}
        }, options || {});

        if (!Array.isArray(data) || data.length === 0) {
            return [];
        }

        let headers = [];
        let rows = [];

        if (opts.hasHeader) {
            headers = data[0];
            rows = data.slice(1);
        } else {
            // 无表头时，使用列索引作为 key
            const colCount = Math.max(...data.map(row => row.length));
            headers = Array.from({ length: colCount }, (_, i) => `col${i}`);
            rows = data;
        }

        const result = [];

        for (const row of rows) {
            if (opts.outputFormat === 'array') {
                // 数组格式：直接返回行数组，应用类型转换
                const converted = row.map((cell, idx) => convertCellValue(cell, opts.columnTypes[String(idx)]));
                result.push(converted);
            } else {
                // 对象格式：使用表头作为 key
                const obj = {};
                headers.forEach((header, idx) => {
                    const value = row[idx] ?? '';
                    obj[header] = convertCellValue(value, opts.columnTypes[String(idx)]);
                });
                result.push(obj);
            }
        }

        return result;
    }

    /**
     * 转换单元格值
     * @param {string} value - 单元格值
     * @param {string} type - 目标类型：'string', 'number', 'boolean'
     * @returns {*} - 转换后的值
     */
    function convertCellValue(value, type) {
        const val = String(value ?? '').trim();

        if (type === 'number') {
            if (val === '') return null;
            const num = Number(val);
            if (isNaN(num)) return val; // 无法转换时保持原值
            return num;
        }

        if (type === 'boolean') {
            const lower = val.toLowerCase();
            if (lower === 'true' || lower === '1' || lower === 'yes') return true;
            if (lower === 'false' || lower === '0' || lower === 'no') return false;
            return val; // 无法转换时保持原值
        }

        return val;
    }

    /**
     * JSON 转表格数据
     * @param {Array} json - JSON 数组
     * @returns {Array<Array<string>>} - 二维数组
     */
    function jsonToTable(json) {
        if (!Array.isArray(json) || json.length === 0) {
            return [];
        }

        const first = json[0];

        if (Array.isArray(first)) {
            // 数组格式：直接返回
            return json.map(row => {
                if (Array.isArray(row)) {
                    return row.map(cell => String(cell ?? ''));
                }
                return [String(row)];
            });
        }

        if (typeof first === 'object' && first !== null) {
            // 对象格式：提取 keys 作为表头
            const keys = Object.keys(first);
            const headers = keys;
            const rows = [headers];

            for (const item of json) {
                const row = keys.map(key => {
                    const val = item[key];
                    if (val === null || val === undefined) return '';
                    return String(val);
                });
                rows.push(row);
            }

            return rows;
        }

        // 其他类型：按单列处理
        return json.map(item => [String(item ?? '')]);
    }

    /**
     * 表格数据转 CSV 文本
     * @param {Array<Array<string>>} data - 二维数组
     * @param {string} delimiter - 分隔符
     * @returns {string} - CSV 文本
     */
    function tableToCsv(data, delimiter) {
        const delim = delimiter || ',';
        const lines = [];

        for (const row of data) {
            const cells = row.map(cell => {
                const val = String(cell ?? '');
                // 包含分隔符、引号、换行符时需要引号包裹
                if (val.includes(delim) || val.includes('"') || val.includes('\n') || val.includes('\r')) {
                    return '"' + val.replace(/"/g, '""') + '"';
                }
                return val;
            });
            lines.push(cells.join(delim));
        }

        return lines.join('\n');
    }

    return {
        parseTableData,
        tableToJson,
        jsonToTable,
        detectDelimiter,
        tableToCsv
    };
});
