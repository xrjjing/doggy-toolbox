/* 工具箱（M41）JSON Path 查询
 *
 * 设计目标：
 * - JSONPath 表达式查询
 * - 支持标准 JSONPath 语法
 * - 高亮匹配路径
 */
(function (root, factory) {
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = factory();
    } else {
        root.DogToolboxM41Utils = factory();
    }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    /**
     * JSONPath 查询
     * 支持语法:
     * - $ : 根对象
     * - .key / ['key'] : 属性访问
     * - [n] : 数组索引
     * - [*] : 所有元素
     * - ..key : 递归下降
     * - [start:end] : 数组切片
     * - [?(@.field == value)] : 过滤表达式
     */
    function query(data, path) {
        if (!path || typeof path !== 'string') {
            return { results: [], paths: [], error: 'JSONPath 表达式不能为空' };
        }

        const trimmedPath = path.trim();
        if (!trimmedPath.startsWith('$')) {
            return { results: [], paths: [], error: 'JSONPath 必须以 $ 开头' };
        }

        try {
            const results = [];
            const paths = [];
            const visited = new WeakSet();  // 循环引用保护
            _evaluate(data, trimmedPath.slice(1), '$', results, paths, visited);
            return { results, paths, error: null };
        } catch (e) {
            return { results: [], paths: [], error: e.message || String(e) };
        }
    }

    function _evaluate(data, path, currentPath, results, paths, visited) {
        if (!path || path === '') {
            results.push(data);
            paths.push(currentPath);
            return;
        }

        // 循环引用检测
        if (typeof data === 'object' && data !== null) {
            if (visited.has(data)) {
                return;  // 跳过已访问的对象
            }
            visited.add(data);
        }

        // 递归下降 ..
        if (path.startsWith('..')) {
            const rest = path.slice(2);
            const match = rest.match(/^([a-zA-Z_][a-zA-Z0-9_]*|\*)/);
            if (match) {
                const key = match[1];
                const remaining = rest.slice(key.length);
                // 递归下降需要独立的 visited 集合，因为需要遍历整个树
                const descendVisited = new WeakSet();
                _recursiveDescend(data, key, currentPath, remaining, results, paths, descendVisited);
            }
            return;
        }

        // 点号属性访问 .key
        if (path.startsWith('.')) {
            const rest = path.slice(1);

            // 通配符 .*
            if (rest.startsWith('*')) {
                if (typeof data === 'object' && data !== null) {
                    const remaining = rest.slice(1);
                    if (Array.isArray(data)) {
                        data.forEach((item, i) => {
                            _evaluate(item, remaining, `${currentPath}[${i}]`, results, paths, visited);
                        });
                    } else {
                        Object.keys(data).forEach(key => {
                            _evaluate(data[key], remaining, `${currentPath}.${key}`, results, paths, visited);
                        });
                    }
                }
                return;
            }

            // 普通属性
            const match = rest.match(/^([a-zA-Z_][a-zA-Z0-9_]*)/);
            if (match) {
                const key = match[1];
                const remaining = rest.slice(key.length);
                if (typeof data === 'object' && data !== null && key in data) {
                    _evaluate(data[key], remaining, `${currentPath}.${key}`, results, paths, visited);
                }
            }
            return;
        }

        // 括号访问 [...]
        if (path.startsWith('[')) {
            const closeIdx = _findMatchingBracket(path, 0);
            if (closeIdx === -1) {
                throw new Error('未闭合的括号');
            }

            const inner = path.slice(1, closeIdx);
            const remaining = path.slice(closeIdx + 1);

            // 通配符 [*]
            if (inner === '*') {
                if (Array.isArray(data)) {
                    data.forEach((item, i) => {
                        _evaluate(item, remaining, `${currentPath}[${i}]`, results, paths, visited);
                    });
                } else if (typeof data === 'object' && data !== null) {
                    Object.keys(data).forEach(key => {
                        _evaluate(data[key], remaining, `${currentPath}['${key}']`, results, paths, visited);
                    });
                }
                return;
            }

            // 过滤表达式 [?(...)]
            if (inner.startsWith('?(') && inner.endsWith(')')) {
                const filterExpr = inner.slice(2, -1);
                if (Array.isArray(data)) {
                    data.forEach((item, i) => {
                        if (_evaluateFilter(item, filterExpr)) {
                            _evaluate(item, remaining, `${currentPath}[${i}]`, results, paths, visited);
                        }
                    });
                }
                return;
            }

            // 切片 [start:end]
            if (inner.includes(':')) {
                const [startStr, endStr] = inner.split(':');
                if (Array.isArray(data)) {
                    // 校验切片参数
                    const start = startStr ? parseInt(startStr, 10) : 0;
                    const end = endStr ? parseInt(endStr, 10) : data.length;
                    if ((startStr && !Number.isFinite(start)) || (endStr && !Number.isFinite(end))) {
                        throw new Error(`无效的切片参数: [${inner}]`);
                    }
                    const slice = data.slice(start, end);
                    slice.forEach((item, i) => {
                        _evaluate(item, remaining, `${currentPath}[${start + i}]`, results, paths, visited);
                    });
                }
                return;
            }

            // 数字索引 [n]
            if (/^-?\d+$/.test(inner)) {
                const idx = parseInt(inner, 10);
                if (Array.isArray(data)) {
                    const actualIdx = idx < 0 ? data.length + idx : idx;
                    if (actualIdx >= 0 && actualIdx < data.length) {
                        _evaluate(data[actualIdx], remaining, `${currentPath}[${actualIdx}]`, results, paths, visited);
                    }
                }
                return;
            }

            // 字符串键 ['key'] 或 ["key"]
            const keyMatch = inner.match(/^['"](.+)['"]$/);
            if (keyMatch) {
                const key = keyMatch[1];
                if (typeof data === 'object' && data !== null && key in data) {
                    _evaluate(data[key], remaining, `${currentPath}['${key}']`, results, paths, visited);
                }
                return;
            }

            // 多索引 [0,1,2]
            if (inner.includes(',')) {
                const indices = inner.split(',').map(s => s.trim());
                indices.forEach(idx => {
                    if (/^-?\d+$/.test(idx)) {
                        const i = parseInt(idx, 10);
                        if (Array.isArray(data) && i >= 0 && i < data.length) {
                            _evaluate(data[i], remaining, `${currentPath}[${i}]`, results, paths, visited);
                        }
                    }
                });
                return;
            }
        }
    }

    function _recursiveDescend(data, key, currentPath, remaining, results, paths, visited) {
        if (typeof data !== 'object' || data === null) return;

        // 循环引用检测
        if (visited.has(data)) return;
        visited.add(data);

        // 检查当前层
        if (key === '*') {
            if (Array.isArray(data)) {
                data.forEach((item, i) => {
                    _evaluate(item, remaining, `${currentPath}[${i}]`, results, paths, visited);
                });
            } else {
                Object.keys(data).forEach(k => {
                    _evaluate(data[k], remaining, `${currentPath}.${k}`, results, paths, visited);
                });
            }
        } else if (key in data) {
            _evaluate(data[key], remaining, `${currentPath}.${key}`, results, paths, visited);
        }

        // 递归子节点
        if (Array.isArray(data)) {
            data.forEach((item, i) => {
                _recursiveDescend(item, key, `${currentPath}[${i}]`, remaining, results, paths, visited);
            });
        } else {
            Object.keys(data).forEach(k => {
                _recursiveDescend(data[k], key, `${currentPath}.${k}`, remaining, results, paths, visited);
            });
        }
    }

    function _findMatchingBracket(str, start) {
        let depth = 0;
        let inString = false;
        let stringChar = '';

        for (let i = start; i < str.length; i++) {
            const ch = str[i];
            if (inString) {
                if (ch === stringChar && str[i - 1] !== '\\') {
                    inString = false;
                }
            } else if (ch === '"' || ch === "'") {
                inString = true;
                stringChar = ch;
            } else if (ch === '[') {
                depth++;
            } else if (ch === ']') {
                depth--;
                if (depth === 0) return i;
            }
        }
        return -1;
    }

    function _evaluateFilter(item, expr) {
        // 简化过滤器：支持 @.field == value, @.field > value 等
        // 注意：>=/<= 必须在 >/<  之前匹配
        const match = expr.match(/^@\.([a-zA-Z_][a-zA-Z0-9_]*)\s*(==|!=|>=|<=|>|<)\s*(.+)$/);
        if (!match) return false;

        const [, field, op, valueStr] = match;
        if (typeof item !== 'object' || item === null || !(field in item)) {
            return false;
        }

        const fieldValue = item[field];
        let compareValue;

        // 解析比较值
        if (valueStr === 'true') compareValue = true;
        else if (valueStr === 'false') compareValue = false;
        else if (valueStr === 'null') compareValue = null;
        else if (/^-?\d+(\.\d+)?$/.test(valueStr)) compareValue = parseFloat(valueStr);
        else if ((valueStr.startsWith('"') && valueStr.endsWith('"')) ||
                 (valueStr.startsWith("'") && valueStr.endsWith("'"))) {
            compareValue = valueStr.slice(1, -1);
        } else {
            compareValue = valueStr;
        }

        switch (op) {
            case '==': return fieldValue === compareValue;
            case '!=': return fieldValue !== compareValue;
            case '>': return fieldValue > compareValue;
            case '<': return fieldValue < compareValue;
            case '>=': return fieldValue >= compareValue;
            case '<=': return fieldValue <= compareValue;
            default: return false;
        }
    }

    /**
     * 获取示例 JSONPath 表达式
     */
    function getExamples() {
        return [
            { path: '$', desc: '根对象' },
            { path: '$.store.book', desc: '属性访问' },
            { path: '$.store.book[0]', desc: '数组第一个元素' },
            { path: '$.store.book[-1]', desc: '数组最后一个元素' },
            { path: '$.store.book[*]', desc: '数组所有元素' },
            { path: '$.store.book[0:2]', desc: '数组切片' },
            { path: '$..author', desc: '递归查找 author' },
            { path: '$.store.book[?(@.price < 10)]', desc: '过滤: price < 10' },
            { path: '$.store.*', desc: 'store 下所有属性' },
        ];
    }

    /**
     * 获取示例 JSON 数据
     */
    function getSampleData() {
        return {
            store: {
                book: [
                    { category: 'reference', author: 'Nigel Rees', title: 'Sayings of the Century', price: 8.95 },
                    { category: 'fiction', author: 'Evelyn Waugh', title: 'Sword of Honour', price: 12.99 },
                    { category: 'fiction', author: 'Herman Melville', title: 'Moby Dick', price: 8.99 },
                    { category: 'fiction', author: 'J. R. R. Tolkien', title: 'The Lord of the Rings', price: 22.99 }
                ],
                bicycle: { color: 'red', price: 19.95 }
            }
        };
    }

    return {
        query,
        getExamples,
        getSampleData,
    };
});
