/* 工具箱（M22）Markdown 预览
 *
 * 设计目标：
 * - 纯算法、无 DOM 依赖
 * - 不依赖外部库，纯 JavaScript 实现
 * - 支持常用 Markdown 语法
 */
(function (root, factory) {
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = factory();
    } else {
        root.DogToolboxM22Utils = factory();
    }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    // ==================== HTML 转义 ====================
    function escapeHtml(text) {
        const map = {
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#39;'
        };
        return String(text ?? '').replace(/[&<>"']/g, (m) => map[m]);
    }

    // ==================== Markdown 解析 ====================
    function parseMarkdown(text) {
        const lines = String(text ?? '').split('\n');
        const blocks = [];
        let i = 0;

        while (i < lines.length) {
            const line = lines[i];

            // 空行
            if (!line.trim()) {
                i++;
                continue;
            }

            // 代码块（```）
            if (line.trim().startsWith('```')) {
                const codeBlock = [];
                const lang = line.trim().slice(3).trim();
                i++;
                while (i < lines.length && !lines[i].trim().startsWith('```')) {
                    codeBlock.push(lines[i]);
                    i++;
                }
                i++; // 跳过结束的 ```
                blocks.push({
                    type: 'code',
                    lang: lang || '',
                    content: codeBlock.join('\n')
                });
                continue;
            }

            // 表格（以 | 开头并且包含 |）
            if (line.trim().startsWith('|') && line.includes('|')) {
                const tableRows = [];
                while (i < lines.length && lines[i].trim().startsWith('|')) {
                    tableRows.push(lines[i]);
                    i++;
                }
                blocks.push({
                    type: 'table',
                    rows: tableRows
                });
                continue;
            }

            // 标题（#）
            const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
            if (headingMatch) {
                blocks.push({
                    type: 'heading',
                    level: headingMatch[1].length,
                    text: headingMatch[2]
                });
                i++;
                continue;
            }

            // 水平线（--- 或 *** 或 ___）
            if (/^(\-{3,}|\*{3,}|_{3,})$/.test(line.trim())) {
                blocks.push({ type: 'hr' });
                i++;
                continue;
            }

            // 引用（>）
            if (line.trim().startsWith('>')) {
                const quoteLines = [];
                while (i < lines.length && lines[i].trim().startsWith('>')) {
                    quoteLines.push(lines[i].trim().slice(1).trim());
                    i++;
                }
                blocks.push({
                    type: 'blockquote',
                    text: quoteLines.join('\n')
                });
                continue;
            }

            // 无序列表（- 或 * 或 +）
            if (/^[\-\*\+]\s/.test(line.trim())) {
                const listItems = [];
                while (i < lines.length && /^[\-\*\+]\s/.test(lines[i].trim())) {
                    listItems.push(lines[i].trim().slice(2));
                    i++;
                }
                blocks.push({
                    type: 'ul',
                    items: listItems
                });
                continue;
            }

            // 有序列表（1. 或 2. 等）
            if (/^\d+\.\s/.test(line.trim())) {
                const listItems = [];
                while (i < lines.length && /^\d+\.\s/.test(lines[i].trim())) {
                    listItems.push(lines[i].trim().replace(/^\d+\.\s/, ''));
                    i++;
                }
                blocks.push({
                    type: 'ol',
                    items: listItems
                });
                continue;
            }

            // 段落
            const paraLines = [];
            while (i < lines.length && lines[i].trim() &&
                   !lines[i].trim().startsWith('#') &&
                   !lines[i].trim().startsWith('```') &&
                   !lines[i].trim().startsWith('>') &&
                   !/^[\-\*\+]\s/.test(lines[i].trim()) &&
                   !/^\d+\.\s/.test(lines[i].trim()) &&
                   !/^(\-{3,}|\*{3,}|_{3,})$/.test(lines[i].trim()) &&
                   !lines[i].trim().startsWith('|')) {
                paraLines.push(lines[i]);
                i++;
            }
            if (paraLines.length > 0) {
                blocks.push({
                    type: 'paragraph',
                    text: paraLines.join(' ')
                });
            }
        }

        return blocksToHtml(blocks);
    }

    // ==================== 行内元素解析 ====================
    function parseInline(text) {
        let result = escapeHtml(text);

        // 图片 ![alt](url)
        result = result.replace(/!\[([^\]]*)\]\(([^\)]+)\)/g, (_, alt, url) => {
            return `<img src="${escapeHtml(url)}" alt="${escapeHtml(alt)}" />`;
        });

        // 链接 [text](url)
        result = result.replace(/\[([^\]]+)\]\(([^\)]+)\)/g, (_, text, url) => {
            let safeUrl = escapeHtml(url);
            // 过滤 javascript: 协议，防止 XSS
            if (safeUrl.trim().toLowerCase().startsWith('javascript:')) {
                safeUrl = '#unsafe-url-removed';
            }
            return `<a href="${safeUrl}">${escapeHtml(text)}</a>`;
        });

        // 行内代码 `code`
        result = result.replace(/`([^`]+)`/g, (_, code) => {
            return `<code>${escapeHtml(code)}</code>`;
        });

        // 粗体 **text** 或 __text__
        result = result.replace(/\*\*([^\*]+)\*\*/g, '<strong>$1</strong>');
        result = result.replace(/__([^_]+)__/g, '<strong>$1</strong>');

        // 斜体 *text* 或 _text_
        result = result.replace(/\*([^\*]+)\*/g, '<em>$1</em>');
        result = result.replace(/_([^_]+)_/g, '<em>$1</em>');

        return result;
    }

    // ==================== 块转换为 HTML ====================
    function blocksToHtml(blocks) {
        return blocks.map(block => {
            switch (block.type) {
                case 'heading':
                    return `<h${block.level}>${parseInline(block.text)}</h${block.level}>`;

                case 'paragraph':
                    return `<p>${parseInline(block.text)}</p>`;

                case 'code':
                    const lang = block.lang ? ` class="language-${escapeHtml(block.lang)}"` : '';
                    return `<pre><code${lang}>${escapeHtml(block.content)}</code></pre>`;

                case 'blockquote':
                    return `<blockquote>${parseInline(block.text)}</blockquote>`;

                case 'ul':
                    const ulItems = block.items.map(item => `<li>${parseInline(item)}</li>`).join('');
                    return `<ul>${ulItems}</ul>`;

                case 'ol':
                    const olItems = block.items.map(item => `<li>${parseInline(item)}</li>`).join('');
                    return `<ol>${olItems}</ol>`;

                case 'hr':
                    return '<hr />';

                case 'table':
                    return renderTable(block.rows);

                default:
                    return '';
            }
        }).join('\n');
    }

    // ==================== 表格渲染 ====================
    function renderTable(rows) {
        if (rows.length === 0) return '';

        const parsedRows = rows.map(row => {
            return row.split('|')
                .map(cell => cell.trim())
                .filter((_, i, arr) => i > 0 && i < arr.length - 1);
        });

        if (parsedRows.length === 0) return '';

        // 第一行是表头
        const headerCells = parsedRows[0].map(cell =>
            `<th>${parseInline(cell)}</th>`
        ).join('');
        const header = `<thead><tr>${headerCells}</tr></thead>`;

        // 跳过分隔行（如果存在）
        let bodyStartIndex = 1;
        if (parsedRows.length > 1 && /^[\-:\s\|]+$/.test(rows[1])) {
            bodyStartIndex = 2;
        }

        // 表格内容
        const bodyRows = parsedRows.slice(bodyStartIndex).map(cells => {
            const bodyCells = cells.map(cell =>
                `<td>${parseInline(cell)}</td>`
            ).join('');
            return `<tr>${bodyCells}</tr>`;
        }).join('');
        const body = bodyRows ? `<tbody>${bodyRows}</tbody>` : '';

        return `<table>${header}${body}</table>`;
    }

    // ==================== 导出为 HTML ====================
    function exportAsHtml(markdownText, options = {}) {
        const title = options.title || '导出的 Markdown 文档';
        const styles = options.styles || getDefaultStyles();
        const renderedContent = parseMarkdown(markdownText);

        return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${escapeHtml(title)}</title>
    <style>
${styles}
    </style>
</head>
<body>
    <div class="markdown-content">
${renderedContent}
    </div>
</body>
</html>`;
    }

    // ==================== 默认样式 ====================
    function getDefaultStyles() {
        return `        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;
            line-height: 1.6;
            color: #333;
            max-width: 800px;
            margin: 0 auto;
            padding: 20px;
            background-color: #fff;
        }
        .markdown-content {
            word-wrap: break-word;
        }
        h1, h2, h3, h4, h5, h6 {
            margin-top: 24px;
            margin-bottom: 16px;
            font-weight: 600;
            line-height: 1.25;
        }
        h1 { font-size: 2em; border-bottom: 1px solid #eaecef; padding-bottom: 0.3em; }
        h2 { font-size: 1.5em; border-bottom: 1px solid #eaecef; padding-bottom: 0.3em; }
        h3 { font-size: 1.25em; }
        h4 { font-size: 1em; }
        h5 { font-size: 0.875em; }
        h6 { font-size: 0.85em; color: #6a737d; }
        p { margin-top: 0; margin-bottom: 16px; }
        a { color: #0366d6; text-decoration: none; }
        a:hover { text-decoration: underline; }
        code {
            padding: 0.2em 0.4em;
            margin: 0;
            font-size: 85%;
            background-color: rgba(27, 31, 35, 0.05);
            border-radius: 3px;
            font-family: 'SF Mono', Monaco, 'Courier New', monospace;
        }
        pre {
            padding: 16px;
            overflow: auto;
            font-size: 85%;
            line-height: 1.45;
            background-color: #f6f8fa;
            border-radius: 6px;
            margin-bottom: 16px;
        }
        pre code {
            display: inline;
            padding: 0;
            margin: 0;
            overflow: visible;
            line-height: inherit;
            background-color: transparent;
            border: 0;
        }
        blockquote {
            padding: 0 1em;
            color: #6a737d;
            border-left: 0.25em solid #dfe2e5;
            margin: 0 0 16px 0;
        }
        ul, ol {
            padding-left: 2em;
            margin-top: 0;
            margin-bottom: 16px;
        }
        li + li { margin-top: 0.25em; }
        table {
            border-spacing: 0;
            border-collapse: collapse;
            margin-bottom: 16px;
            width: 100%;
        }
        table th, table td {
            padding: 6px 13px;
            border: 1px solid #dfe2e5;
        }
        table th {
            font-weight: 600;
            background-color: #f6f8fa;
        }
        table tr:nth-child(2n) {
            background-color: #f6f8fa;
        }
        hr {
            height: 0.25em;
            padding: 0;
            margin: 24px 0;
            background-color: #e1e4e8;
            border: 0;
        }
        img {
            max-width: 100%;
            box-sizing: content-box;
        }
        strong { font-weight: 600; }
        em { font-style: italic; }`;
    }

    // ==================== 导出 API ====================
    return {
        parseMarkdown: parseMarkdown,
        escapeHtml: escapeHtml,
        exportAsHtml: exportAsHtml
    };
});
