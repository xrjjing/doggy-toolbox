/* 工具箱（M38）文本排序/去重
 *
 * 设计目标：
 * - 按行排序（升序/降序/随机/自然排序）
 * - 去除重复行（保留首次/末次出现）
 * - 去除空行、首尾空白
 * - 行反转
 */
(function (root, factory) {
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = factory();
    } else {
        root.DogToolboxM38Utils = factory();
    }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    // 使用 Intl.Collator 进行自然排序（数字感知，支持 Unicode）
    const naturalCollator = typeof Intl !== 'undefined' && Intl.Collator
        ? new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })
        : null;

    /**
     * 自然排序比较函数（数字感知）
     * 优先使用 Intl.Collator，回退到手动实现
     */
    function naturalCompare(a, b) {
        if (naturalCollator) {
            return naturalCollator.compare(a, b);
        }
        // 回退实现
        const ax = [], bx = [];
        a.replace(/(\d+)|(\D+)/g, function(_, $1, $2) { ax.push([$1 || Infinity, $2 || '']); });
        b.replace(/(\d+)|(\D+)/g, function(_, $1, $2) { bx.push([$1 || Infinity, $2 || '']); });
        while (ax.length && bx.length) {
            const an = ax.shift();
            const bn = bx.shift();
            const nn = (an[0] - bn[0]) || an[1].localeCompare(bn[1]);
            if (nn) return nn;
        }
        return ax.length - bx.length;
    }

    /**
     * 处理文本行
     * @param {string} text - 输入文本
     * @param {object} options - 选项
     * @param {string} options.sort - 排序方式：'asc'|'desc'|'random'|'natural'|'none'
     * @param {boolean} options.unique - 是否去重
     * @param {boolean} options.keepFirst - 去重时保留首次出现（false 则保留末次）
     * @param {boolean} options.trimLines - 是否去除每行首尾空白
     * @param {boolean} options.removeEmpty - 是否去除空行（含仅空白字符的行）
     * @param {boolean} options.reverse - 是否反转行顺序
     * @param {boolean} options.caseSensitive - 去重时是否区分大小写
     * @returns {{lines: string[], stats: {originalCount: number, finalCount: number, emptyRemoved: number, duplicateRemoved: number}}}
     */
    function processLines(text, options = {}) {
        const {
            sort = 'none',
            unique = false,
            keepFirst = true,
            trimLines = false,
            removeEmpty = false,
            reverse = false,
            caseSensitive = true
        } = options;

        let lines = String(text || '').split(/\r?\n/);
        const originalCount = lines.length;
        let emptyRemoved = 0;
        let duplicateRemoved = 0;

        // 去除每行首尾空白
        if (trimLines) {
            lines = lines.map(line => line.trim());
        }

        // 去除空行（含仅空白字符的行）
        if (removeEmpty) {
            const beforeCount = lines.length;
            lines = lines.filter(line => line.trim().length > 0);
            emptyRemoved = beforeCount - lines.length;
        }

        // 去重
        if (unique) {
            const beforeCount = lines.length;
            if (keepFirst) {
                const seen = new Set();
                lines = lines.filter(line => {
                    const key = caseSensitive ? line : line.toLowerCase();
                    if (seen.has(key)) return false;
                    seen.add(key);
                    return true;
                });
            } else {
                const lastIndex = new Map();
                lines.forEach((line, i) => {
                    const key = caseSensitive ? line : line.toLowerCase();
                    lastIndex.set(key, i);
                });
                const keepIndices = new Set(lastIndex.values());
                lines = lines.filter((_, i) => keepIndices.has(i));
            }
            duplicateRemoved = beforeCount - lines.length;
        }

        // 排序
        switch (sort) {
            case 'asc':
                lines.sort((a, b) => a.localeCompare(b));
                break;
            case 'desc':
                lines.sort((a, b) => b.localeCompare(a));
                break;
            case 'natural':
                lines.sort(naturalCompare);
                break;
            case 'random':
                for (let i = lines.length - 1; i > 0; i--) {
                    const j = Math.floor(Math.random() * (i + 1));
                    [lines[i], lines[j]] = [lines[j], lines[i]];
                }
                break;
        }

        // 反转
        if (reverse) {
            lines.reverse();
        }

        return {
            lines,
            stats: {
                originalCount,
                finalCount: lines.length,
                emptyRemoved,
                duplicateRemoved
            }
        };
    }

    /**
     * 添加行号
     */
    function addLineNumbers(text, options = {}) {
        const { start = 1, separator = ': ', padZero = false } = options;
        const lines = String(text || '').split(/\r?\n/);
        const maxDigits = String(start + lines.length - 1).length;

        return lines.map((line, i) => {
            let num = String(start + i);
            if (padZero) num = num.padStart(maxDigits, '0');
            return num + separator + line;
        }).join('\n');
    }

    /**
     * 移除行号
     */
    function removeLineNumbers(text) {
        const lines = String(text || '').split(/\r?\n/);
        return lines.map(line => line.replace(/^\s*\d+[\s.:)\]]+/, '')).join('\n');
    }

    return {
        processLines,
        addLineNumbers,
        removeLineNumbers,
        naturalCompare
    };
});
