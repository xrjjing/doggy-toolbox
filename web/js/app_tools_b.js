/*
 * 文件总览：工具页脚本分包 B。
 *
 * 服务页面包含：URL、进制、Unicode、HMAC、RSA、字符统计、密码生成、JSON、数据格式转换、文本排序/去重、正则测试等。
 *
 * 常见规律：
 * - initXxxTool() 负责绑定页面事件和首屏状态；
 * - updateXxxTool() 负责把输入重新计算到结果区；
 * - clear/copy 函数对应页面上的局部按钮。
 *
 * 排查建议：先根据页面 id 找到对应 section，再顺着 init/update/copy 三类函数阅读。
 */

// ==================== 工具函数 ====================
// 这里放多个工具共用的复制能力，是大量“复制结果”按钮的共同底层实现。
// 通常调用链是：页面上的“复制”按钮 → copyXxxOutput()/copyField()/copyCommand() → copyToolText()/copyToClipboard()。
// 如果用户反馈“按钮点了没反应”，先看这里是否成功走到 Clipboard API，再看 fallbackCopyText() 有没有被浏览器环境拦住。
function copyToClipboard(text) {
    const value = String(text ?? '');
    if (!value) return Promise.resolve(false);

    // 优先使用 Clipboard API（pywebview/本地 file:// 环境可能不可用）
    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
        return navigator.clipboard.writeText(value)
            .then(() => true)
            .catch(() => Promise.resolve(fallbackCopyText(value)));
    }

    return Promise.resolve(fallbackCopyText(value));
}

// 复制兜底方案。
// 当前端运行在 pywebview、本地 file://、旧版浏览器等环境时，Clipboard API 可能不可用，
// 这里会临时创建隐藏 textarea 并执行 document.execCommand('copy')。
function fallbackCopyText(text) {
    try {
        const ta = document.createElement('textarea');
        ta.value = String(text ?? '');
        ta.setAttribute('readonly', '');
        ta.style.position = 'fixed';
        ta.style.top = '-1000px';
        ta.style.left = '-1000px';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        ta.setSelectionRange(0, ta.value.length);
        const ok = document.execCommand && document.execCommand('copy');
        document.body.removeChild(ta);
        return !!ok;
    } catch (e) {
        return false;
    }
}

// openModal, closeModal, escapeHtml, escapeAttr 已移至 app_state.js（最早加载）

function copyField(btn, text) {
    copyToolText(btn, text);
}

// 命令类结果的复制入口。
// 页面位置：像 URL / cURL / SQL / 其它命令生成页里的“复制命令”按钮，最终通常都会走到这里。
function copyCommand(btn, text) {
    copyToolText(btn, text);
}

// ==================== 工具箱：URL 编解码（M8） ====================
// 对应 tool-url 页面：输入、模式切换、历史记录和结果输出都在这一段。
const URL_HISTORY_KEY = 'url_history';
const URL_HISTORY_MAX = 20;

/**
 * URL 工具初始化入口。
 *
 * 页面位置：
 * - tool-url 页主输入框；
 * - “编码 / 解码”模式按钮；
 * - 批量处理开关；
 * - 下方历史记录列表。
 *
 * 负责内容：
 * 1. 给输入框绑定实时计算事件；
 * 2. 给批量开关绑定刷新事件；
 * 3. 启用拖拽文件到输入框；
 * 4. 设置默认模式为 encode；
 * 5. 首屏渲染历史记录。
 *
 * 排障建议：
 * - 如果 URL 页一打开就完全没有任何联动，先看这里是否被页面初始化链调用。
 */
function initUrlTool() {
    const inputEl = document.getElementById('url-input');
    if (!inputEl) return;
    inputEl.addEventListener('input', updateUrlTool);
    document.getElementById('url-batch')?.addEventListener('change', updateUrlTool);

    // 拖拽支持
    initUrlDragDrop(inputEl);

    setUrlMode('encode');

    // 渲染历史记录
    renderUrlHistory();
}

// URL 输入框的拖拽上传支持。
// 用户把文本文件拖到输入区时，会读取文件内容并自动尝试识别应使用“编码”还是“解码”模式。
function initUrlDragDrop(textarea) {
    if (!textarea) return;

    textarea.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.stopPropagation();
        textarea.classList.add('drag-over');
    });

    textarea.addEventListener('dragleave', (e) => {
        e.preventDefault();
        e.stopPropagation();
        textarea.classList.remove('drag-over');
    });

    textarea.addEventListener('drop', (e) => {
        e.preventDefault();
        e.stopPropagation();
        textarea.classList.remove('drag-over');

        const files = e.dataTransfer?.files;
        if (files && files.length > 0) {
            readFileAsTextUrl(files[0], (text) => {
                textarea.value = text;
                autoDetectUrlMode(text);
                updateUrlTool();
            });
        }
    });
}

// 把拖入的文件读成文本。
// 这里属于 URL 工具“输入区”的辅助入口；如果拖文件无效，优先看文件大小限制和 FileReader 回调是否触发。
function readFileAsTextUrl(file, callback) {
    if (!file) return;
    const MAX_SIZE = 1024 * 1024;
    if (file.size > MAX_SIZE) {
        showToast?.('文件过大，最大支持 1MB', 'error');
        return;
    }
    const reader = new FileReader();
    reader.onload = (e) => callback(e.target.result);
    reader.onerror = () => showToast?.('文件读取失败', 'error');
    reader.readAsText(file);
}

// 根据拖入/粘贴的内容自动判断当前更像“已编码 URL”还是“普通文本”。
// 这是改善外行用户体验的自动分流逻辑：识别到像 %E4%BD%A0 这种内容时，会自动切到解码模式。
function autoDetectUrlMode(text) {
    if (!window.DogToolboxM8Utils?.detectUrlEncoded) return;
    const detection = window.DogToolboxM8Utils.detectUrlEncoded(text);
    if (detection.isUrlEncoded && detection.confidence >= 0.6) {
        setUrlMode('decode');
        showToast?.('检测到 URL 编码，已切换到解码模式', 'info');
    }
}

// 切换 URL 工具的工作模式。
// 页面按钮“编码 / 解码”点下去后会进这里；它既负责按钮高亮，也会立刻触发主计算函数刷新结果区。
function setUrlMode(mode) {
    if (mode !== 'encode' && mode !== 'decode') return;
    urlMode = mode;
    document.getElementById('url-encode-btn')?.classList.toggle('active', urlMode === 'encode');
    document.getElementById('url-decode-btn')?.classList.toggle('active', urlMode === 'decode');
    updateUrlTool();
}

/**
 * URL 工具主计算入口。
 *
 * 页面位置：
 * - 输入区：#url-input
 * - 输出区：#url-output
 * - 错误提示区：#url-errors
 * - 批量模式开关：#url-batch
 *
 * 负责内容：
 * 1. 读取当前 encode / decode 模式；
 * 2. 判断是否是单条处理还是批量逐行处理；
 * 3. 调用 window.DogToolboxM8Utils 中的 URL 编解码能力；
 * 4. 把结果写回输出区；
 * 5. 把批量解码中的局部错误渲染到错误区；
 * 6. 在“单条成功处理”时保存到历史记录。
 *
 * 排障建议：
 * - 输入有值但输出为空：先看这里有没有提前 return；
 * - 页面提示“工具模块未加载”：继续检查 tools_m8_utils.js 是否成功注入；
 * - 历史记录不更新：继续看 saveUrlHistory()。
 */
function updateUrlTool() {
    const inputEl = document.getElementById('url-input');
    const outputEl = document.getElementById('url-output');
    const errorsEl = document.getElementById('url-errors');
    const batchEl = document.getElementById('url-batch');
    if (!inputEl || !outputEl || !errorsEl) return;

    errorsEl.innerHTML = '';
    outputEl.value = '';

    const inputText = inputEl.value ?? '';
    if (inputText.length === 0) return;

    if (!window.DogToolboxM8Utils) {
        errorsEl.innerHTML = '<div>⚠ 工具模块未加载：tools_m8_utils.js</div>';
        return;
    }

    const batch = !!batchEl?.checked;

    try {
        let outputText = '';
        if (urlMode === 'encode') {
            outputText = batch
                ? window.DogToolboxM8Utils.urlEncodeBatch(inputText)
                : window.DogToolboxM8Utils.urlEncode(inputText);
        } else {
            if (batch) {
                const result = window.DogToolboxM8Utils.urlDecodeBatch(inputText);
                outputText = result.result;
                if (result.errors && result.errors.length) {
                    errorsEl.innerHTML = result.errors.map(e => `<div>⚠ ${escapeHtml(e)}</div>`).join('');
                }
            } else {
                outputText = window.DogToolboxM8Utils.urlDecode(inputText);
            }
        }
        outputEl.value = outputText;

        // 保存历史记录
        if (outputText && !batch) {
            saveUrlHistory(inputText, outputText, urlMode);
        }
    } catch (e) {
        outputEl.value = '';
        errorsEl.innerHTML = `<div>⚠ ${escapeHtml(e?.message || String(e))}</div>`;
    }
}

/**
 * 清空 URL 工具当前工作区。
 *
 * 页面上的“清空”按钮会走这里。
 * 只清理当前这一轮的输入、输出、错误提示，不会动历史记录列表。
 *
 * 如果你发现“清空”后下面历史还在，这是正常设计；历史区要单独走 clearUrlHistory()。
 */
function clearUrlTool() {
    const inputEl = document.getElementById('url-input');
    const outputEl = document.getElementById('url-output');
    const errorsEl = document.getElementById('url-errors');
    if (inputEl) inputEl.value = '';
    if (outputEl) outputEl.value = '';
    if (errorsEl) errorsEl.innerHTML = '';
}

/**
 * 复制 URL 输出区内容。
 *
 * 页面按钮位置：tool-url 输出框旁边的“复制结果”按钮。
 * 这里只负责取值和转发，真正的复制提示、按钮状态反馈由公共 copyToolText() 完成。
 */
function copyUrlOutput(btn) {
    const outputEl = document.getElementById('url-output');
    const text = outputEl?.value || '';
    copyToolText(btn, text);
}

/**
 * 保存 URL 工具历史记录。
 *
 * 设计意图：
 * - 只记录单条、成功的处理结果；
 * - 不记录批量处理，避免历史列表被大段文本污染；
 * - 相同输入 + 相同模式的旧记录会被顶到最前面，而不是无限重复堆积。
 *
 * 存储位置：
 * - 浏览器本地 localStorage
 * - key 为 URL_HISTORY_KEY
 */
function saveUrlHistory(input, output, mode) {
    if (!input?.trim() || !output?.trim()) return;
    try {
        const raw = localStorage.getItem(URL_HISTORY_KEY);
        const data = raw ? JSON.parse(raw) : { entries: [] };
        const entry = {
            input: input.slice(0, 200),
            output: output.slice(0, 200),
            mode,
            timestamp: Date.now()
        };
        data.entries = data.entries.filter(e => !(e.input === entry.input && e.mode === entry.mode));
        data.entries.unshift(entry);
        if (data.entries.length > URL_HISTORY_MAX) {
            data.entries = data.entries.slice(0, URL_HISTORY_MAX);
        }
        localStorage.setItem(URL_HISTORY_KEY, JSON.stringify(data));
        renderUrlHistory();
    } catch (e) { /* ignore */ }
}

// 从 localStorage 读取 URL 历史记录。
// 如果历史区为空但你确认以前用过，先看这里是否解析失败或本地存储被清掉。
function loadUrlHistory() {
    try {
        const raw = localStorage.getItem(URL_HISTORY_KEY);
        return raw ? JSON.parse(raw).entries || [] : [];
    } catch (e) {
        return [];
    }
}

/**
 * 渲染 URL 工具下方的历史记录列表。
 *
 * 页面位置：tool-url 页底部历史区。
 * 每一项都是一个可点击的小块，展示：
 * - 当时是“编码”还是“解码”；
 * - 输入内容摘要；
 * - 时间文案。
 *
 * 点击后会进入 applyUrlHistory()，把当时的输入和模式一起恢复回来。
 */
function renderUrlHistory() {
    const container = document.getElementById('url-history');
    if (!container) return;

    const entries = loadUrlHistory();
    if (!entries.length) {
        container.innerHTML = '<div class="history-empty">暂无历史记录</div>';
        return;
    }

    container.innerHTML = entries.map((e, i) => `
        <div class="history-item" onclick="applyUrlHistory(${i})">
            <span class="history-mode">${e.mode === 'encode' ? '编码' : '解码'}</span>
            <span class="history-text">${escapeHtml(e.input.slice(0, 50))}${e.input.length > 50 ? '...' : ''}</span>
            <span class="history-time">${formatUrlHistoryTime(e.timestamp)}</span>
        </div>
    `).join('');
}

/**
 * 点击某条 URL 历史记录后的回填入口。
 *
 * 用户在历史区点某一条时：
 * 1. 把当时的输入文本放回输入框；
 * 2. 恢复 encode / decode 模式；
 * 3. 借由 setUrlMode() 自动重新计算输出区。
 *
 * 如果出现“点击历史记录没反应”，优先看 renderUrlHistory() 生成的 onclick 是否正确，再看这里。
 */
function applyUrlHistory(index) {
    const entries = loadUrlHistory();
    const entry = entries[index];
    if (!entry) return;

    const inputEl = document.getElementById('url-input');
    if (inputEl) inputEl.value = entry.input;
    setUrlMode(entry.mode);
}

// 清空 URL 历史记录列表。
// 注意：这里只删 localStorage 中的历史，不影响当前页面上的输入/输出框内容。
function clearUrlHistory() {
    localStorage.removeItem(URL_HISTORY_KEY);
    renderUrlHistory();
    showToast?.('历史记录已清空', 'info');
}

/**
 * 历史时间格式化。
 *
 * 这是纯显示层函数，不参与任何编解码逻辑。
 * 它只把时间戳转换成更适合普通用户阅读的文案，
 * 比如“刚刚 / 5 分钟前 / 3/31”。
 */
function formatUrlHistoryTime(ts) {
    const d = new Date(ts);
    const now = new Date();
    const diff = now - d;
    if (diff < 60000) return '刚刚';
    if (diff < 3600000) return `${Math.floor(diff / 60000)} 分钟前`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)} 小时前`;
    return `${d.getMonth() + 1}/${d.getDate()}`;
}

// ==================== 工具箱：进制转换（M8） ====================
// 对应 tool-radix 页面，负责不同数字进制之间的联动转换。
// 页面块通常包含：输入框、来源进制选择、自动检测提示、四个输出框（二/八/十/十六进制）。
function initRadixTool() {
    const inputEl = document.getElementById('radix-input');
    if (!inputEl) return;
    inputEl.addEventListener('input', updateRadixTool);
    document.getElementById('radix-from')?.addEventListener('change', updateRadixTool);
    updateRadixTool();
}

// 进制转换主计算入口。
// 用户在输入框输入数字，或者切换“来源进制”下拉框时，都会重新走这里。
// 负责内容：尝试识别输入属于哪种进制，再把结果同步写到 4 个结果框。
function updateRadixTool() {
    const inputEl = document.getElementById('radix-input');
    const fromEl = document.getElementById('radix-from');
    const detectEl = document.getElementById('radix-detect');
    const errorsEl = document.getElementById('radix-errors');
    const outBin = document.getElementById('radix-out-bin');
    const outOct = document.getElementById('radix-out-oct');
    const outDec = document.getElementById('radix-out-dec');
    const outHex = document.getElementById('radix-out-hex');
    if (!inputEl || !fromEl || !errorsEl || !outBin || !outOct || !outDec || !outHex) return;

    errorsEl.innerHTML = '';
    if (detectEl) detectEl.textContent = '';
    outBin.value = '';
    outOct.value = '';
    outDec.value = '';
    outHex.value = '';

    const inputText = String(inputEl.value ?? '').trim();
    if (!inputText) return;

    if (!window.DogToolboxM8Utils) {
        errorsEl.innerHTML = '<div>⚠ 工具模块未加载：tools_m8_utils.js</div>';
        return;
    }

    const fromRadix = fromEl.value === 'auto' ? null : parseInt(fromEl.value, 10);

    try {
        const result = window.DogToolboxM8Utils.convertToAllRadix(inputText, fromRadix);
        outBin.value = result.bin || '';
        outOct.value = result.oct || '';
        outDec.value = result.dec || '';
        outHex.value = result.hex || '';

        if (detectEl && result.detectedRadix) {
            const radixNames = { 2: '二进制', 8: '八进制', 10: '十进制', 16: '十六进制' };
            detectEl.textContent = `检测为：${radixNames[result.detectedRadix] || result.detectedRadix + ' 进制'}`;
        }
    } catch (e) {
        errorsEl.innerHTML = `<div>⚠ ${escapeHtml(e?.message || String(e))}</div>`;
    }
}

// 清空进制转换工具。
// 除了输入框，还会把“检测为：十六进制”这种辅助提示一并清空。
function clearRadixTool() {
    const inputEl = document.getElementById('radix-input');
    const detectEl = document.getElementById('radix-detect');
    const errorsEl = document.getElementById('radix-errors');
    const outBin = document.getElementById('radix-out-bin');
    const outOct = document.getElementById('radix-out-oct');
    const outDec = document.getElementById('radix-out-dec');
    const outHex = document.getElementById('radix-out-hex');
    if (inputEl) inputEl.value = '';
    if (detectEl) detectEl.textContent = '';
    if (errorsEl) errorsEl.innerHTML = '';
    if (outBin) outBin.value = '';
    if (outOct) outOct.value = '';
    if (outDec) outDec.value = '';
    if (outHex) outHex.value = '';
}

// 复制某个进制结果框的值。
// type 决定复制哪一个输出框，适合从 HTML 按钮上直接按类型复用。
function copyRadixOutput(btn, type) {
    const idMap = { bin: 'radix-out-bin', oct: 'radix-out-oct', dec: 'radix-out-dec', hex: 'radix-out-hex' };
    const el = document.getElementById(idMap[type]);
    const text = el?.value || '';
    copyToolText(btn, text);
}

// ==================== 工具箱：Unicode 编解码（M19） ====================
// 对应 tool-unicode 页面，围绕文本转义/反转义做即时结果更新。

// Unicode 工具初始化入口。
// 页面位置：tool-unicode 页的主输入区、编码/解码切换按钮、格式下拉框。
// 默认会进入编码模式，确保首屏按钮状态和输入区逻辑一致。
function initUnicodeTool() {
    const inputEl = document.getElementById('unicode-input');
    if (!inputEl) return;
    inputEl.addEventListener('input', updateUnicodeTool);
    setUnicodeMode('encode');
}

// 切换 Unicode 工具的编码/解码模式。
// 除了按钮高亮，这里还负责控制“编码格式区”和“解码格式区”谁显示、谁隐藏。
function setUnicodeMode(mode) {
    if (mode !== 'encode' && mode !== 'decode') return;
    unicodeMode = mode;
    document.getElementById('unicode-encode-btn')?.classList.toggle('active', mode === 'encode');
    document.getElementById('unicode-decode-btn')?.classList.toggle('active', mode === 'decode');

    const encodeFormat = document.getElementById('unicode-encode-format');
    const decodeFormat = document.getElementById('unicode-format-row');
    if (encodeFormat) encodeFormat.style.display = mode === 'encode' ? '' : 'none';
    if (decodeFormat) decodeFormat.style.display = mode === 'decode' ? '' : 'none';

    updateUnicodeTool();
}

// Unicode 工具主计算入口。
// 页面位置：输入区、输出区、错误区、自动检测区。
// 负责内容：读取当前模式、格式选择、批量开关，执行转义/反转义并把结果回填到输出框。
// 排障建议：如果自动检测没显示结果，先看 format 是否为 auto，再看 detectFormat() 是否返回可识别类型。
function updateUnicodeTool() {
    const inputEl = document.getElementById('unicode-input');
    const outputEl = document.getElementById('unicode-output');
    const errorsEl = document.getElementById('unicode-errors');
    const detectEl = document.getElementById('unicode-detect');
    const batchEl = document.getElementById('unicode-batch');
    if (!inputEl || !outputEl || !errorsEl) return;

    errorsEl.innerHTML = '';
    if (detectEl) detectEl.textContent = '';

    const inputText = inputEl.value ?? '';
    if (inputText.length === 0) {
        outputEl.value = '';
        return;
    }

    if (!window.DogToolboxM19Utils) {
        errorsEl.innerHTML = '<div>工具模块未加载：tools_m19_utils.js</div>';
        return;
    }

    const batch = !!batchEl?.checked;

    try {
        if (unicodeMode === 'encode') {
            const format = document.getElementById('unicode-format')?.value || 'unicode';
            outputEl.value = batch
                ? window.DogToolboxM19Utils.batchEncode(inputText, format)
                : encodeByFormat(inputText, format);
        } else {
            const format = document.getElementById('unicode-decode-format')?.value || 'auto';
            if (format === 'auto' && detectEl) {
                const detected = window.DogToolboxM19Utils.detectFormat(inputText.split(/\r?\n/)[0] || '');
                const formatNames = {
                    unicode: '\\uXXXX',
                    hex: '\\xXX',
                    html_hex: 'HTML Hex',
                    html_dec: 'HTML Dec',
                    plain: '纯文本',
                    unknown: '未知'
                };
                detectEl.textContent = `检测：${formatNames[detected] || detected}`;
            }
            outputEl.value = batch
                ? window.DogToolboxM19Utils.batchDecode(inputText, format)
                : decodeByFormat(inputText, format);
        }
    } catch (e) {
        outputEl.value = '';
        errorsEl.innerHTML = `<div>${escapeHtml(e?.message || String(e))}</div>`;
    }
}

// 编码模式下的格式分发器。
// 它本身不管页面，只负责把“当前选的是 unicode / hex / html_hex / html_dec”映射到正确算法。
function encodeByFormat(text, format) {
    const M19 = window.DogToolboxM19Utils;
    switch (format) {
        case 'unicode':
            return M19.unicodeEscape(text);
        case 'hex':
            return M19.hexEscape(text);
        case 'html_hex':
            return M19.htmlEntityEncode(text, true);
        case 'html_dec':
            return M19.htmlEntityEncode(text, false);
        default:
            return text;
    }
}

// 解码模式下的格式分发器。
// auto 模式会走 smartDecode()；如果用户说“明明粘贴了转义内容却没解出来”，这里是重点排查点。
function decodeByFormat(text, format) {
    const M19 = window.DogToolboxM19Utils;
    switch (format) {
        case 'unicode':
            return M19.unicodeUnescape(text);
        case 'hex':
            return M19.hexUnescape(text);
        case 'html':
            return M19.htmlEntityDecode(text);
        case 'auto':
            return M19.smartDecode(text).result;
        default:
            return text;
    }
}

// 清空 Unicode 工具所有展示区域。
// 包括输入、输出、报错，以及“检测：\\uXXXX”这类辅助提示。
function clearUnicodeTool() {
    const inputEl = document.getElementById('unicode-input');
    const outputEl = document.getElementById('unicode-output');
    const errorsEl = document.getElementById('unicode-errors');
    const detectEl = document.getElementById('unicode-detect');
    if (inputEl) inputEl.value = '';
    if (outputEl) outputEl.value = '';
    if (errorsEl) errorsEl.innerHTML = '';
    if (detectEl) detectEl.textContent = '';
}

// 复制 Unicode 工具输出区内容。
function copyUnicodeOutput(btn) {
    const outputEl = document.getElementById('unicode-output');
    const text = outputEl?.value || '';
    copyToolText(btn, text);
}

// ==================== 工具箱：HMAC 计算（M21） ====================
// 对应 tool-hmac 页面，主要处理消息、密钥和算法切换。
// 页面块通常包含：消息输入区、密钥输入区、算法下拉框、密钥格式/输出格式切换、结果区。
function initHmacTool() {
    const inputEl = document.getElementById('hmac-input');
    if (!inputEl) return;
    inputEl.addEventListener('input', updateHmacTool);
    document.getElementById('hmac-key')?.addEventListener('input', updateHmacTool);
    document.getElementById('hmac-algo')?.addEventListener('change', updateHmacTool);
    document.getElementById('hmac-key-format')?.addEventListener('change', updateHmacTool);
    document.getElementById('hmac-output-format')?.addEventListener('change', updateHmacTool);
    document.getElementById('hmac-batch')?.addEventListener('change', updateHmacTool);
    updateHmacTool();
}

// HMAC 工具主计算入口。
// 只要消息、密钥、算法、输出格式等任一控件变化，都会重新走这里。
// 负责内容：收集页面表单参数，调用异步 HMAC 工具模块，输出摘要结果。
// 排障建议：结果不刷新时先看这里是否提前 return，例如消息或密钥为空时会直接停止计算。
async function updateHmacTool() {
    const inputEl = document.getElementById('hmac-input');
    const outputEl = document.getElementById('hmac-output');
    const errorsEl = document.getElementById('hmac-errors');
    const keyEl = document.getElementById('hmac-key');
    const algoEl = document.getElementById('hmac-algo');
    const keyFormatEl = document.getElementById('hmac-key-format');
    const outputFormatEl = document.getElementById('hmac-output-format');
    const batchEl = document.getElementById('hmac-batch');

    if (!inputEl || !outputEl || !errorsEl) return;
    errorsEl.innerHTML = '';
    outputEl.value = '';

    if (!window.DogToolboxM21Utils) {
        errorsEl.innerHTML = '<div>⚠ 工具模块未加载：tools_m21_utils.js</div>';
        return;
    }

    const message = inputEl.value ?? '';
    const key = keyEl?.value ?? '';
    if (!message.trim() || !key.trim()) return;

    const algorithm = algoEl?.value || 'sha256';
    const keyFormat = keyFormatEl?.value || 'text';
    const outputFormat = outputFormatEl?.value || 'hex';
    const batch = !!batchEl?.checked;

    try {
        if (batch) {
            const result = await window.DogToolboxM21Utils.hmacBatch(message, key, {
                algorithm, keyFormat, outputFormat
            });
            outputEl.value = result;
        } else {
            const result = await window.DogToolboxM21Utils.hmac(message, key, {
                algorithm, keyFormat, outputFormat
            });
            outputEl.value = result;
        }
    } catch (e) {
        errorsEl.innerHTML = `<div>⚠ ${escapeHtml(e?.message || String(e))}</div>`;
    }
}

// 清空 HMAC 页面。
// 只清当前页面表单，不会改动算法下拉或格式下拉的默认选项。
function clearHmacTool() {
    const inputEl = document.getElementById('hmac-input');
    const outputEl = document.getElementById('hmac-output');
    const errorsEl = document.getElementById('hmac-errors');
    const keyEl = document.getElementById('hmac-key');
    if (inputEl) inputEl.value = '';
    if (outputEl) outputEl.value = '';
    if (errorsEl) errorsEl.innerHTML = '';
    if (keyEl) keyEl.value = '';
}

// 复制 HMAC 输出区内容。
function copyHmacOutput(btn) {
    const outputEl = document.getElementById('hmac-output');
    const text = outputEl?.value || '';
    copyToolText(btn, text);
}

// ==================== 工具箱：RSA 加解密（M20） ====================
// 对应 tool-rsa 页面，是一组表单参数较多、最适合重点复核注释的工具。

// RSA 工具初始化入口。
// 页面首次进入时，会默认切到“加密”模式，并同步刷新顶部提示文案。
function initRsaTool() {
    setRsaMode('encrypt');
    updateRsaKeyHint();
}

// 切换 RSA 的“加密 / 解密”工作模式。
// 页面上两个主按钮点下去后会进这里；它会同时改标题、placeholder、输出区语义和错误区状态。
function setRsaMode(mode) {
    if (mode !== 'encrypt' && mode !== 'decrypt') return;
    rsaMode = mode;
    document.getElementById('rsa-encrypt-btn')?.classList.toggle('active', rsaMode === 'encrypt');
    document.getElementById('rsa-decrypt-btn')?.classList.toggle('active', rsaMode === 'decrypt');

    const inputHeader = document.getElementById('rsa-input-header');
    const outputHeader = document.getElementById('rsa-output-header');
    const inputEl = document.getElementById('rsa-input');
    const outputEl = document.getElementById('rsa-output');

    if (rsaMode === 'encrypt') {
        if (inputHeader) inputHeader.textContent = '输入（明文）';
        if (outputHeader) outputHeader.textContent = '输出（密文）';
        if (inputEl) inputEl.placeholder = '输入明文...';
        if (outputEl) outputEl.placeholder = '加密结果...';
    } else {
        if (inputHeader) inputHeader.textContent = '输入（密文）';
        if (outputHeader) outputHeader.textContent = '输出（明文）';
        if (inputEl) inputEl.placeholder = '输入密文（Base64/Hex）...';
        if (outputEl) outputEl.placeholder = '解密结果...';
    }

    const errorsEl = document.getElementById('rsa-errors');
    if (errorsEl) errorsEl.innerHTML = '';
    if (outputEl) outputEl.value = '';
}

// 更新 RSA 页面的配置提示条。
// 页面位置：密钥尺寸下拉框附近的说明文字，用来告诉用户当前实际要生成的是哪种 RSA 配置。
function updateRsaKeyHint() {
    const hintEl = document.getElementById('rsa-key-hint');
    const keysizeEl = document.getElementById('rsa-keysize');
    if (!hintEl) return;
    const keysize = keysizeEl?.value || '2048';
    hintEl.textContent = `当前配置：${keysize} 位 RSA-OAEP (SHA-256)`;
}

// 生成 RSA 公私钥对。
// 页面按钮“生成密钥”点下去会走这里；生成完成后会自动回填公钥区、私钥区，并立即触发合法性校验。
async function generateRsaKeyPair() {
    const errorsEl = document.getElementById('rsa-errors');
    const pubkeyEl = document.getElementById('rsa-pubkey');
    const privkeyEl = document.getElementById('rsa-privkey');
    const keysizeEl = document.getElementById('rsa-keysize');

    if (!pubkeyEl || !privkeyEl) return;
    if (errorsEl) errorsEl.innerHTML = '';

    if (!window.DogToolboxM20Utils) {
        if (errorsEl) errorsEl.innerHTML = '<div>⚠ 工具模块未加载：tools_m20_utils.js</div>';
        return;
    }

    const keysize = parseInt(keysizeEl?.value || '2048', 10);

    try {
        const keyPair = await window.DogToolboxM20Utils.generateKeyPair(keysize);
        pubkeyEl.value = keyPair.publicKey;
        privkeyEl.value = keyPair.privateKey;
        validateRsaKeys();
    } catch (e) {
        if (errorsEl) errorsEl.innerHTML = `<div>⚠ ${escapeHtml(e?.message || String(e))}</div>`;
    }
}

// 校验用户输入的公钥 / 私钥是否合法。
// 这是 RSA 页“密钥输入区”的即时校验逻辑：通过给外层 group 切换样式类，提示当前密钥是否格式正确。
// 如果用户说“为什么公钥框突然变红/变绿”，就是这里在控制。
function validateRsaKeys() {
    if (!window.DogToolboxM20Utils) return;

    const pubkeyEl = document.getElementById('rsa-pubkey');
    const privkeyEl = document.getElementById('rsa-privkey');
    const pubGroup = document.getElementById('rsa-pubkey-group');
    const privGroup = document.getElementById('rsa-privkey-group');

    if (pubkeyEl && pubGroup) {
        const pubText = pubkeyEl.value.trim();
        if (pubText) {
            const result = window.DogToolboxM20Utils.validatePublicKey(pubText);
            pubGroup.classList.toggle('key-valid', result.valid);
            pubGroup.classList.toggle('key-invalid', !result.valid);
        } else {
            pubGroup.classList.remove('key-valid', 'key-invalid');
        }
    }

    if (privkeyEl && privGroup) {
        const privText = privkeyEl.value.trim();
        if (privText) {
            const result = window.DogToolboxM20Utils.validatePrivateKey(privText);
            privGroup.classList.toggle('key-valid', result.valid);
            privGroup.classList.toggle('key-invalid', !result.valid);
        } else {
            privGroup.classList.remove('key-valid', 'key-invalid');
        }
    }
}

// RSA 主执行入口。
// 页面上的“开始加密 / 开始解密”按钮应该最终进入这里。
// 负责内容：读取输入区、公钥/私钥区、输出格式下拉框，根据当前模式调用 encrypt/decrypt 并回填结果。
// 排障建议：RSA 页面出问题时优先看这里，因为它串起了所有输入校验和真正的加解密调用。
async function runRsaTool() {
    const inputEl = document.getElementById('rsa-input');
    const outputEl = document.getElementById('rsa-output');
    const errorsEl = document.getElementById('rsa-errors');
    const pubkeyEl = document.getElementById('rsa-pubkey');
    const privkeyEl = document.getElementById('rsa-privkey');
    const formatEl = document.getElementById('rsa-output-format');

    if (!inputEl || !outputEl || !errorsEl) return;
    errorsEl.innerHTML = '';
    outputEl.value = '';

    if (!window.DogToolboxM20Utils) {
        errorsEl.innerHTML = '<div>⚠ 工具模块未加载：tools_m20_utils.js</div>';
        return;
    }

    const inputText = inputEl.value.trim();
    if (!inputText) {
        errorsEl.innerHTML = '<div>⚠ 请输入内容</div>';
        return;
    }

    const format = formatEl?.value || 'base64';

    try {
        if (rsaMode === 'encrypt') {
            const pubkey = pubkeyEl?.value?.trim();
            if (!pubkey) {
                errorsEl.innerHTML = '<div>⚠ 请输入公钥</div>';
                return;
            }
            const encrypted = await window.DogToolboxM20Utils.encrypt(inputText, pubkey, format);
            outputEl.value = encrypted;
        } else {
            const privkey = privkeyEl?.value?.trim();
            if (!privkey) {
                errorsEl.innerHTML = '<div>⚠ 请输入私钥</div>';
                return;
            }
            const decrypted = await window.DogToolboxM20Utils.decrypt(inputText, privkey, format);
            outputEl.value = decrypted;
        }
    } catch (e) {
        errorsEl.innerHTML = `<div>⚠ ${escapeHtml(e?.message || String(e))}</div>`;
    }
}

// 清空 RSA 页面。
// 会同时清除密钥合法性高亮，避免用户误以为旧密钥状态仍然有效。
function clearRsaTool() {
    const inputEl = document.getElementById('rsa-input');
    const outputEl = document.getElementById('rsa-output');
    const errorsEl = document.getElementById('rsa-errors');
    const pubkeyEl = document.getElementById('rsa-pubkey');
    const privkeyEl = document.getElementById('rsa-privkey');
    const pubGroup = document.getElementById('rsa-pubkey-group');
    const privGroup = document.getElementById('rsa-privkey-group');

    if (inputEl) inputEl.value = '';
    if (outputEl) outputEl.value = '';
    if (errorsEl) errorsEl.innerHTML = '';
    if (pubkeyEl) pubkeyEl.value = '';
    if (privkeyEl) privkeyEl.value = '';
    if (pubGroup) pubGroup.classList.remove('key-valid', 'key-invalid');
    if (privGroup) privGroup.classList.remove('key-valid', 'key-invalid');
}

// 复制 RSA 输出区内容。
function copyRsaOutput(btn) {
    const outputEl = document.getElementById('rsa-output');
    const text = outputEl?.value || '';
    copyToolText(btn, text);
}

// ==================== 工具箱：字符统计（M8） ====================
// 对应 tool-charcount 页面，输入后即时统计字符、单词、行数等结果。
// 这是典型“输入区 + 统计卡片区”的轻量工具，几乎所有结果都由 updateCharCountTool() 统一刷新。
function initCharCountTool() {
    const inputEl = document.getElementById('charcount-input');
    if (!inputEl) return;
    inputEl.addEventListener('input', updateCharCountTool);
    updateCharCountTool();
}

// 字符统计主刷新函数。
// 负责把输入文本转换为字符数、去空格字符数、字节数、行数、中文数、英文词数等多个统计卡片值。
function updateCharCountTool() {
    const inputEl = document.getElementById('charcount-input');
    const charsEl = document.getElementById('charcount-chars');
    const charsNoSpaceEl = document.getElementById('charcount-chars-nospace');
    const bytesEl = document.getElementById('charcount-bytes');
    const linesEl = document.getElementById('charcount-lines');
    const chineseEl = document.getElementById('charcount-chinese');
    const wordsEl = document.getElementById('charcount-words');
    if (!inputEl) return;

    const text = inputEl.value ?? '';

    if (!window.DogToolboxM8Utils) {
        if (charsEl) charsEl.textContent = '0';
        if (charsNoSpaceEl) charsNoSpaceEl.textContent = '0';
        if (bytesEl) bytesEl.textContent = '0';
        if (linesEl) linesEl.textContent = '0';
        if (chineseEl) chineseEl.textContent = '0';
        if (wordsEl) wordsEl.textContent = '0';
        return;
    }

    const stats = window.DogToolboxM8Utils.charStats(text);
    if (charsEl) charsEl.textContent = String(stats.charCount);
    if (charsNoSpaceEl) charsNoSpaceEl.textContent = String(stats.charCountNoSpace);
    if (bytesEl) bytesEl.textContent = String(stats.byteCount);
    if (linesEl) linesEl.textContent = String(stats.lineCount);
    if (chineseEl) chineseEl.textContent = String(stats.chineseCount);
    if (wordsEl) wordsEl.textContent = String(stats.englishWordCount);
}

// 清空字符统计输入区，并顺带把所有统计结果归零。
function clearCharCountTool() {
    const inputEl = document.getElementById('charcount-input');
    if (inputEl) inputEl.value = '';
    updateCharCountTool();
}

// ==================== 工具箱：密码生成器（M9） ====================
// 对应 tool-password 页面，围绕规则配置生成随机密码并回填结果区。
// 页面块一般包含：长度滑杆、长度数字框、字符类型复选框、数量输入、结果区、强度条。
function initPasswordTool() {
    const sliderEl = document.getElementById('password-length-slider');
    const numberEl = document.getElementById('password-length');
    if (!sliderEl || !numberEl) return;
    syncPasswordLength('slider');
}

// 同步密码长度的滑杆和数字输入框。
// 外行用户常会疑惑“为什么拖滑杆数字会变 / 改数字滑杆又跳回来”，就是这里在做双向同步和范围兜底。
function syncPasswordLength(source) {
    const sliderEl = document.getElementById('password-length-slider');
    const numberEl = document.getElementById('password-length');
    if (!sliderEl || !numberEl) return;

    if (source === 'slider') {
        numberEl.value = sliderEl.value;
    } else {
        let val = parseInt(numberEl.value, 10);
        if (isNaN(val) || val < 8) val = 8;
        if (val > 128) val = 128;
        numberEl.value = String(val);
        sliderEl.value = String(Math.min(val, 64));
    }
}

/**
 * 密码生成主入口。
 *
 * 页面位置：
 * - 长度设置区；
 * - 字符类型勾选区；
 * - 生成数量输入框；
 * - 结果输出区；
 * - 强度提示条。
 *
 * 页面按钮“生成密码”点下去后会进这里，负责：
 * 1. 读取所有规则；
 * 2. 调用 M9 模块批量生成密码；
 * 3. 把结果逐行写入输出区；
 * 4. 取第一条密码计算强度并刷新颜色条。
 *
 * 排障建议：
 * - 点击没结果：先看是否至少勾选了一种字符类型；
 * - 直接报模块错误：继续检查 tools_m9_utils.js；
 * - 结果有了但强度条不显示：再看 strengthRow / strengthBar / strengthText 是否存在。
 */
function generatePasswords() {
    const lengthEl = document.getElementById('password-length');
    const countEl = document.getElementById('password-count');
    const uppercaseEl = document.getElementById('password-uppercase');
    const lowercaseEl = document.getElementById('password-lowercase');
    const numbersEl = document.getElementById('password-numbers');
    const symbolsEl = document.getElementById('password-symbols');
    const excludeSimilarEl = document.getElementById('password-exclude-similar');
    const outputEl = document.getElementById('password-output');
    const errorsEl = document.getElementById('password-errors');
    const strengthRow = document.getElementById('password-strength-row');
    const strengthBar = document.getElementById('password-strength-bar');
    const strengthText = document.getElementById('password-strength-text');

    if (!outputEl || !errorsEl) return;
    errorsEl.innerHTML = '';
    outputEl.value = '';
    if (strengthRow) strengthRow.style.display = 'none';

    if (!window.DogToolboxM9Utils) {
        errorsEl.innerHTML = '<div>⚠ 工具模块未加载：tools_m9_utils.js</div>';
        return;
    }

    const length = parseInt(lengthEl?.value || '16', 10);
    const count = parseInt(countEl?.value || '5', 10);
    const uppercase = !!uppercaseEl?.checked;
    const lowercase = !!lowercaseEl?.checked;
    const numbers = !!numbersEl?.checked;
    const symbols = !!symbolsEl?.checked;
    const excludeSimilar = !!excludeSimilarEl?.checked;

    if (!uppercase && !lowercase && !numbers && !symbols) {
        errorsEl.innerHTML = '<div>⚠ 至少选择一种字符类型</div>';
        return;
    }

    try {
        const passwords = window.DogToolboxM9Utils.generatePasswords(
            { length, uppercase, lowercase, numbers, symbols, excludeSimilar },
            count
        );
        outputEl.value = passwords.join('\n');

        // 显示首条密码强度
        if (passwords.length > 0 && strengthRow && strengthBar && strengthText) {
            const score = window.DogToolboxM9Utils.calculateStrength(passwords[0]);
            const { label, color } = window.DogToolboxM9Utils.getStrengthLabel(score);
            strengthRow.style.display = 'flex';
            strengthBar.style.width = score + '%';
            strengthBar.className = 'password-strength-bar strength-' + color;
            strengthText.textContent = label + ' (' + score + ')';
            strengthText.className = 'password-strength-text strength-' + color;
        }
    } catch (e) {
        errorsEl.innerHTML = `<div>⚠ ${escapeHtml(e?.message || String(e))}</div>`;
    }
}

// 清空密码结果区和强度显示。
// 注意：不会重置用户勾选的规则配置，只清本次生成结果。
function clearPasswordTool() {
    const outputEl = document.getElementById('password-output');
    const errorsEl = document.getElementById('password-errors');
    const strengthRow = document.getElementById('password-strength-row');
    if (outputEl) outputEl.value = '';
    if (errorsEl) errorsEl.innerHTML = '';
    if (strengthRow) strengthRow.style.display = 'none';
}

// 复制密码生成结果。
// 一般对应结果文本框旁边的复制按钮，复制后用户可直接粘贴到其他系统中。
function copyPasswordOutput(btn) {
    const outputEl = document.getElementById('password-output');
    const text = outputEl?.value || '';
    copyToolText(btn, text);
}

// ==================== 工具箱：JSON 格式化（M10） ====================
// 对应 tool-json 页面，负责格式化、压缩、校验、树视图等 JSON 相关交互。

/**
 * JSON 工具初始化入口。
 *
 * 页面位置：
 * - 原始 JSON 输入区；
 * - 格式化输出区；
 * - 缩进切换按钮；
 * - 文本视图 / 树形视图切换区。
 *
 * 负责内容：
 * 1. 绑定输入框实时格式化；
 * 2. 把默认缩进设置成 2 空格；
 * 3. 借由 setJsonIndent() 触发首屏状态同步。
 *
 * 如果 JSON 页面完全没有自动联动，先看这里有没有被工具页初始化总入口调用。
 */
function initJsonTool() {
    const inputEl = document.getElementById('json-input');
    if (!inputEl) return;
    inputEl.addEventListener('input', updateJsonTool);
    setJsonIndent(2);
}

/**
 * 切换 JSON 输出缩进风格。
 *
 * 页面上的“2 空格 / 4 空格 / Tab”按钮都走这里。
 * 它做两件事：
 * 1. 更新当前全局缩进状态 jsonIndent；
 * 2. 刷新按钮高亮并立刻重算输出区内容。
 *
 * 所以用户点缩进按钮时看到结果文本立刻变化，是这里驱动的。
 */
function setJsonIndent(indent) {
    jsonIndent = indent;
    document.querySelectorAll('#json-indent-2, #json-indent-4, #json-indent-tab').forEach(btn => {
        btn.classList.remove('active');
    });
    const btnId = indent === 'tab' ? 'json-indent-tab' : `json-indent-${indent}`;
    document.getElementById(btnId)?.classList.add('active');
    updateJsonTool();
}

// JSON 工具主计算入口。
// 用户在 JSON 输入区编辑内容时，最先进入这里。
// 负责内容：校验 JSON 是否有效、按当前缩进格式化结果、更新状态标记，并在树形视图模式下同步刷新右侧树。
// 排障建议：JSON 页面“无效 / 不显示结果 / 树视图不同步”时，优先从这里开始看。
function updateJsonTool() {
    const inputEl = document.getElementById('json-input');
    const outputEl = document.getElementById('json-output');
    const errorsEl = document.getElementById('json-errors');
    const statusEl = document.getElementById('json-status');
    if (!inputEl || !outputEl || !errorsEl) return;

    errorsEl.innerHTML = '';
    if (statusEl) statusEl.textContent = '';

    const inputText = inputEl.value ?? '';
    if (!inputText.trim()) {
        outputEl.value = '';
        return;
    }

    if (!window.DogToolboxM10Utils) {
        errorsEl.innerHTML = '<div>⚠ 工具模块未加载：tools_m10_utils.js</div>';
        return;
    }

    const result = window.DogToolboxM10Utils.formatJson(inputText, jsonIndent);
    if (result.error) {
        outputEl.value = '';
        let errMsg = escapeHtml(result.error);
        if (result.line) errMsg += ` (第 ${result.line} 行)`;
        errorsEl.innerHTML = `<div>⚠ ${errMsg}</div>`;
        if (statusEl) statusEl.textContent = '❌ 无效';
        statusEl?.classList.remove('json-valid');
        statusEl?.classList.add('json-invalid');
    } else {
        outputEl.value = result.result;
        if (statusEl) statusEl.textContent = '✓ 有效';
        statusEl?.classList.remove('json-invalid');
        statusEl?.classList.add('json-valid');
        // 如果当前是树形视图模式，同步更新
        if (jsonViewMode === 'tree') {
            updateJsonTreeView();
        }
    }
}

/**
 * JSON 压缩按钮入口。
 *
 * 与 updateJsonTool() 的“格式化美化”不同，
 * 这里是把合法 JSON 压成单行文本，
 * 常用于：
 * - 贴到请求参数；
 * - 放进配置项；
 * - 复制到日志或命令行参数中。
 *
 * 排障建议：
 * - 如果点“压缩”后没有结果，优先看输入是否为空、JSON 是否本身非法。
 */
function minifyJsonTool() {
    const inputEl = document.getElementById('json-input');
    const outputEl = document.getElementById('json-output');
    const errorsEl = document.getElementById('json-errors');
    const statusEl = document.getElementById('json-status');
    if (!inputEl || !outputEl || !errorsEl) return;

    errorsEl.innerHTML = '';

    const inputText = inputEl.value ?? '';
    if (!inputText.trim()) {
        outputEl.value = '';
        return;
    }

    if (!window.DogToolboxM10Utils) {
        errorsEl.innerHTML = '<div>⚠ 工具模块未加载：tools_m10_utils.js</div>';
        return;
    }

    const result = window.DogToolboxM10Utils.minifyJson(inputText);
    if (result.error) {
        outputEl.value = '';
        errorsEl.innerHTML = `<div>⚠ ${escapeHtml(result.error)}</div>`;
        if (statusEl) statusEl.textContent = '❌ 无效';
    } else {
        outputEl.value = result.result;
        if (statusEl) statusEl.textContent = '✓ 已压缩';
    }
}

/**
 * JSON 自动修复入口。
 *
 * 页面上的“尝试修复”按钮会走这里。
 * 它主要处理一些常见、可恢复的小问题，例如：
 * - 多余尾逗号；
 * - 少量引号/转义异常；
 * - 结构上还能推断的轻微错误。
 *
 * 修复成功后会：
 * 1. 直接把修复结果写回输入区；
 * 2. 在状态区告诉用户修了几项；
 * 3. 再调用 updateJsonTool() 重新格式化输出。
 *
 * 如果用户说“点了修复但输入框没变化”，先看这里的 result.fixes 是否为空。
 */
function tryFixJsonTool() {
    const inputEl = document.getElementById('json-input');
    const errorsEl = document.getElementById('json-errors');
    const statusEl = document.getElementById('json-status');
    if (!inputEl || !window.DogToolboxM10Utils) return;

    const result = window.DogToolboxM10Utils.advancedFixJson(inputEl.value);

    if (result.fixes.length > 0) {
        inputEl.value = result.result;
        if (statusEl) statusEl.textContent = `✓ 已修复 ${result.fixes.length} 项`;
        if (errorsEl) {
            const fixList = result.fixes.map(f => `<div class="fix-item">✓ ${escapeHtml(f)}</div>`).join('');
            errorsEl.innerHTML = `<div class="fix-summary">${fixList}</div>`;
            setTimeout(() => { errorsEl.innerHTML = ''; }, 3000);
        }
        updateJsonTool();
    } else if (result.error) {
        if (errorsEl) errorsEl.innerHTML = `<div>⚠ 无法自动修复: ${escapeHtml(result.error)}</div>`;
    } else {
        if (statusEl) statusEl.textContent = '无需修复';
        setTimeout(() => { if (statusEl) statusEl.textContent = ''; }, 2000);
    }
}

/**
 * 清空 JSON 工具全部区域。
 *
 * 会同时清理：
 * - 输入区；
 * - 输出区；
 * - 错误提示；
 * - 状态标记；
 * - 树形视图容器。
 *
 * 这相当于把当前 JSON 页面恢复成“刚打开时的空白状态”。
 */
function clearJsonTool() {
    const inputEl = document.getElementById('json-input');
    const outputEl = document.getElementById('json-output');
    const errorsEl = document.getElementById('json-errors');
    const statusEl = document.getElementById('json-status');
    const treeEl = document.getElementById('json-tree-content');
    if (inputEl) inputEl.value = '';
    if (outputEl) outputEl.value = '';
    if (errorsEl) errorsEl.innerHTML = '';
    if (statusEl) statusEl.textContent = '';
    if (treeEl) treeEl.innerHTML = '';
}

// JSON 视图切换状态（已在 app_state.js 中定义）
// let jsonViewMode = 'text'; // 预留：如后续需要“文本 / 树形”双视图，可从这里继续扩展

/**
 * 切换 JSON 输出区域的显示方式。
 *
 * text 模式：
 * - 显示纯文本结果框；
 * - 适合复制、粘贴、再次编辑。
 *
 * tree 模式：
 * - 显示结构化树；
 * - 更适合外行观察层级、字段嵌套关系。
 *
 * 切到 tree 时会立刻调用 updateJsonTreeView() 重新生成树节点。
 */
function switchJsonView(mode) {
    jsonViewMode = mode;
    const textView = document.getElementById('json-output-text');
    const treeView = document.getElementById('json-output-tree');
    const textTab = document.getElementById('json-view-text');
    const treeTab = document.getElementById('json-view-tree');

    if (mode === 'text') {
        if (textView) textView.style.display = 'block';
        if (treeView) treeView.style.display = 'none';
        textTab?.classList.add('active');
        treeTab?.classList.remove('active');
    } else {
        if (textView) textView.style.display = 'none';
        if (treeView) treeView.style.display = 'block';
        textTab?.classList.remove('active');
        treeTab?.classList.add('active');
        updateJsonTreeView();
    }
}

/**
 * JSON 树形视图渲染入口。
 *
 * 页面位置：tool-json 的树视图区。
 * 负责内容：
 * 1. 读取输入框中的 JSON 原文；
 * 2. 交给 M16 树形模块解析；
 * 3. 产出可折叠的 HTML 节点树并写入容器。
 *
 * 排障建议：
 * - 切到树视图后一片空白：先看这里；
 * - 页面提示“树形视图模块未加载”：继续检查 tools_m16_utils.js；
 * - 树显示错乱：再看输入框里是否真的是合法 JSON。
 */
function updateJsonTreeView() {
    const inputEl = document.getElementById('json-input');
    const treeEl = document.getElementById('json-tree-content');
    if (!inputEl || !treeEl) return;

    if (!window.DogToolboxM16Utils) {
        treeEl.innerHTML = '<div class="jtree-error">⚠ 树形视图模块未加载</div>';
        return;
    }

    const result = window.DogToolboxM16Utils.parseAndRender(inputEl.value);
    treeEl.innerHTML = result.html;
}

// 点击某个 JSON 树节点前的小三角时会走这里。
// 它只是把事件转发给 M16 树工具模块，本身不做结构解析。
function toggleJsonTreeNode(toggle) {
    if (window.DogToolboxM16Utils) {
        window.DogToolboxM16Utils.toggleNode(toggle);
    }
}

// 展开 JSON 树的所有节点。
// 对应树视图上的“全部展开”按钮，方便一次看全深层字段。
function expandAllJsonTree() {
    const container = document.getElementById('json-tree-content');
    if (window.DogToolboxM16Utils && container) {
        window.DogToolboxM16Utils.expandAll(container);
    }
}

// 折叠 JSON 树的所有节点。
// 对应树视图上的“全部折叠”按钮，数据层级太深时会比较有用。
function collapseAllJsonTree() {
    const container = document.getElementById('json-tree-content');
    if (window.DogToolboxM16Utils && container) {
        window.DogToolboxM16Utils.collapseAll(container);
    }
}

// 复制 JSON 文本输出区。
// 注意：复制的是格式化/压缩后的文本框内容，不是树形节点的可见文字。
function copyJsonOutput(btn) {
    const outputEl = document.getElementById('json-output');
    const text = outputEl?.value || '';
    copyToolText(btn, text);
}

/**
 * JSON 字段排序按钮入口。
 *
 * 适合处理“对象 key 想按名称升序 / 降序排列”的场景。
 * 重要特点：
 * - 排序结果只写到输出区；
 * - 不会偷偷改掉输入区原文；
 * - 所以用户可以安全地拿原始内容做不同排序试验。
 */
function sortJsonTool(order) {
    const inputEl = document.getElementById('json-input');
    const outputEl = document.getElementById('json-output');
    const statusEl = document.getElementById('json-status');
    const errorsEl = document.getElementById('json-errors');
    if (!inputEl || !outputEl) return;

    const text = inputEl.value.trim();
    if (!text) return;

    const result = window.DogToolboxM10Utils.sortJsonFields(text, order, jsonIndent);
    if (result.error) {
        if (errorsEl) errorsEl.innerHTML = `<div class="error-item">❌ ${result.error}</div>`;
        if (statusEl) statusEl.textContent = '';
    } else {
        outputEl.value = result.result;
        if (errorsEl) errorsEl.innerHTML = '';
        if (statusEl) statusEl.textContent = `✓ 已按字段名${order === 'desc' ? '降序' : '升序'}排列`;
    }
}

/**
 * JSON 字符串转义入口。
 *
 * 常用于把普通文本变成“可安全放进 JSON 字符串”的形式。
 * 例如换行、引号、反斜杠会被改写成带转义符的文本。
 *
 * 页面理解上，可以把它看成：
 * - 输入区放原文；
 * - 输出区放适合嵌入 JSON 的安全字符串。
 */
function escapeJsonTool() {
    const inputEl = document.getElementById('json-input');
    const outputEl = document.getElementById('json-output');
    const statusEl = document.getElementById('json-status');
    if (!inputEl || !outputEl) return;

    const text = inputEl.value;
    if (!text) return;

    const result = window.DogToolboxM10Utils.escapeJson(text);
    outputEl.value = result.result;
    if (statusEl) statusEl.textContent = '✓ 已转义';
}

/**
 * JSON 字符串反转义入口。
 *
 * 与 escapeJsonTool() 相反，
 * 它把类似 \\n、\\\" 这类转义后的文本还原成更接近原始内容的人眼可读文本。
 *
 * 常见场景：
 * - 调试接口返回的字符串字段；
 * - 还原日志里转义过的片段；
 * - 检查某段 JSON 字符串真实长什么样。
 */
function unescapeJsonTool() {
    const inputEl = document.getElementById('json-input');
    const outputEl = document.getElementById('json-output');
    const statusEl = document.getElementById('json-status');
    const errorsEl = document.getElementById('json-errors');
    if (!inputEl || !outputEl) return;

    const text = inputEl.value;
    if (!text) return;

    const result = window.DogToolboxM10Utils.unescapeJson(text);
    if (result.error) {
        if (errorsEl) errorsEl.innerHTML = `<div class="error-item">❌ ${result.error}</div>`;
        if (statusEl) statusEl.textContent = '';
    } else {
        outputEl.value = result.result;
        if (errorsEl) errorsEl.innerHTML = '';
        if (statusEl) statusEl.textContent = '✓ 已删除转义';
    }
}

// ==================== 工具箱：数据格式转换（M18） ====================
// 对应 tool-data-convert 页面，处理不同结构数据之间的转换和结果展示。
 

/**
 * 数据格式转换工具初始化入口。
 *
 * 页面位置：
 * - 输入格式按钮组；
 * - 输出格式按钮组；
 * - 原始数据输入区；
 * - 转换结果输出区；
 * - 自动检测提示区。
 *
 * 当前初始化逻辑以“同步按钮高亮状态”为主，
 * 真正的转换计算发生在 updateDataConvertTool()。
 */
function initDataConvertTool() {
    updateDataFormatButtons();
}

/**
 * 切换“输入格式”按钮组选中项。
 *
 * auto / json / yaml / xml 四种模式会决定：
 * 当前输入框里的内容，第一步应该按什么方式解析。
 *
 * 切换后会立刻重新转换，因此用户能马上看到结果或错误提示变化。
 */
function setDataInputFormat(format) {
    dataInputFormat = format;
    updateDataFormatButtons();
    updateDataConvertTool();
}

/**
 * 切换“输出格式”按钮组选中项。
 *
 * json / yaml / xml 三种模式会决定：
 * 第二步把统一对象重新输出成哪种文本格式给用户看。
 */
function setDataOutputFormat(format) {
    dataOutputFormat = format;
    updateDataFormatButtons();
    updateDataConvertTool();
}

/**
 * 刷新数据转换页按钮高亮。
 *
 * 这是纯展示层函数，不做实际转换。
 * 它的意义是让用户清楚看到：
 * - 当前“输入格式”选中了什么；
 * - 当前“输出格式”准备转成什么。
 */
function updateDataFormatButtons() {
    ['auto', 'json', 'yaml', 'xml'].forEach(fmt => {
        const inBtn = document.getElementById(`data-in-${fmt}`);
        if (inBtn) inBtn.classList.toggle('active', dataInputFormat === fmt);
    });
    ['json', 'yaml', 'xml'].forEach(fmt => {
        const outBtn = document.getElementById(`data-out-${fmt}`);
        if (outBtn) outBtn.classList.toggle('active', dataOutputFormat === fmt);
    });
}

// 数据格式转换主计算入口。
// 页面位置：tool-data-convert 的输入区、输出区、错误区、检测提示区。
// 核心链路分两步：
// 1) 先按输入格式把内容解析成统一 JS 对象；
// 2) 再按目标格式把对象序列化成 JSON / YAML / XML。
// 排障建议：转换失败时先分清是“第一步解析失败”还是“第二步输出失败”，错误文案也是按这两层给出的。
function updateDataConvertTool() {
    const inputEl = document.getElementById('data-convert-input');
    const outputEl = document.getElementById('data-convert-output');
    const errorsEl = document.getElementById('data-convert-errors');
    const detectEl = document.getElementById('data-detect');

    if (!inputEl || !outputEl) return;
    if (errorsEl) errorsEl.innerHTML = '';

    const inputText = inputEl.value.trim();
    if (!inputText) {
        outputEl.value = '';
        if (detectEl) detectEl.textContent = '';
        return;
    }

    if (!window.DogToolboxM18Utils) {
        if (errorsEl) errorsEl.innerHTML = '<div>⚠ 工具模块未加载：tools_m18_utils.js</div>';
        return;
    }

    const M18 = window.DogToolboxM18Utils;
    const detectedFormat = M18.detectFormat(inputText);
    if (detectEl) detectEl.textContent = `检测格式: ${detectedFormat.toUpperCase()}`;

    const xmlRoot = document.getElementById('data-xml-root')?.value || 'root';
    const jsonIndent = parseInt(document.getElementById('data-json-indent')?.value || '2', 10);

    let intermediateObj = null;
    let parseError = null;

    // 第一步：先把当前输入解析成统一的 JS 对象
    if (dataInputFormat === 'json' || (dataInputFormat === 'auto' && detectedFormat === 'json')) {
        try {
            intermediateObj = JSON.parse(inputText);
        } catch (e) {
            parseError = `JSON 解析错误: ${e.message}`;
        }
    } else if (dataInputFormat === 'yaml' || (dataInputFormat === 'auto' && detectedFormat === 'yaml')) {
        const result = M18.yamlToJson(inputText, jsonIndent);
        if (result.error) {
            parseError = `YAML 解析错误: ${result.error}`;
        } else {
            try {
                intermediateObj = JSON.parse(result.result);
            } catch (e) {
                parseError = `YAML→JSON 解析错误: ${e.message}`;
            }
        }
    } else if (dataInputFormat === 'xml' || (dataInputFormat === 'auto' && detectedFormat === 'xml')) {
        const result = M18.xmlToJson(inputText, jsonIndent);
        if (result.error) {
            parseError = `XML 解析错误: ${result.error}`;
        } else {
            try {
                intermediateObj = JSON.parse(result.result);
            } catch (e) {
                parseError = `XML→JSON 解析错误: ${e.message}`;
            }
        }
    }

    if (parseError) {
        if (errorsEl) errorsEl.innerHTML = `<div>⚠ ${escapeHtml(parseError)}</div>`;
        outputEl.value = '';
        return;
    }

    if (intermediateObj === null) {
        outputEl.value = '';
        return;
    }

    // 第二步：再按用户选中的目标格式重新序列化输出
    let outputText = '';
    let convertError = null;

    if (dataOutputFormat === 'json') {
        outputText = JSON.stringify(intermediateObj, null, jsonIndent);
    } else if (dataOutputFormat === 'yaml') {
        const jsonStr = JSON.stringify(intermediateObj);
        const result = M18.jsonToYaml(jsonStr);
        if (result.error) {
            convertError = `转换为 YAML 失败: ${result.error}`;
        } else {
            outputText = result.result;
        }
    } else if (dataOutputFormat === 'xml') {
        const jsonStr = JSON.stringify(intermediateObj);
        const result = M18.jsonToXml(jsonStr, xmlRoot);
        if (result.error) {
            convertError = `转换为 XML 失败: ${result.error}`;
        } else {
            outputText = result.result;
        }
    }

    if (convertError) {
        if (errorsEl) errorsEl.innerHTML = `<div>⚠ ${escapeHtml(convertError)}</div>`;
        outputEl.value = '';
        return;
    }

    outputEl.value = outputText;
}

/**
 * 清空数据格式转换页的工作区。
 *
 * 会同时清除：
 * - 输入区；
 * - 输出区；
 * - 错误区；
 * - 自动检测提示。
 *
 * 但不会重置输入 / 输出格式按钮当前的选中状态。
 */
function clearDataConvertTool() {
    const inputEl = document.getElementById('data-convert-input');
    const outputEl = document.getElementById('data-convert-output');
    const errorsEl = document.getElementById('data-convert-errors');
    const detectEl = document.getElementById('data-detect');

    if (inputEl) inputEl.value = '';
    if (outputEl) outputEl.value = '';
    if (errorsEl) errorsEl.innerHTML = '';
    if (detectEl) detectEl.textContent = '';
}

// 复制数据格式转换结果。
// 页面上的“复制输出”按钮会走这里；如果没内容则直接不触发复制。
function copyDataConvertOutput(btn) {
    const outputEl = document.getElementById('data-convert-output');
    if (!outputEl || !outputEl.value) return;
    copyToolText(btn, outputEl.value);
}

/* ========== M11: 文本去重/排序 ========== */
// 对应 tool-text-sort 页面，负责去重、排序和批量整理文本结果。
// 页面块一般是“原始文本输入区 + 操作按钮条 + 输出区 + 统计区”。
function initTextTool() {
    const inputEl = document.getElementById('text-input');
    if (inputEl) {
        inputEl.addEventListener('input', updateTextStats);
    }
}

// 更新文本工具顶部/底部的统计提示。
// 当前主要展示总行数和去重后行数，方便用户在点按钮前先对数据规模有直观认识。
function updateTextStats() {
    const inputEl = document.getElementById('text-input');
    const statsEl = document.getElementById('text-stats');
    if (!inputEl || !statsEl) return;

    const text = inputEl.value;
    const caseSensitive = document.getElementById('text-case-sensitive')?.checked || false;
    const lines = DogToolboxM11Utils.countLines(text);
    const unique = DogToolboxM11Utils.countUniqueLines(text, caseSensitive);
    statsEl.textContent = text ? `行数: ${lines} | 去重后: ${unique}` : '';
}

// 文本去重按钮入口。
// 常见场景：一堆重复行去重后输出到右侧结果区；大小写敏感、是否 trim 由复选框决定。
function textDeduplicate() {
    const inputEl = document.getElementById('text-input');
    const outputEl = document.getElementById('text-output');
    if (!inputEl || !outputEl) return;

    const caseSensitive = document.getElementById('text-case-sensitive')?.checked || false;
    const trimLines = document.getElementById('text-trim-lines')?.checked || true;
    const result = DogToolboxM11Utils.deduplicate(inputEl.value, caseSensitive, trimLines);
    outputEl.value = result;
}

// 文本排序按钮入口。
// order 决定升序还是降序，最终结果写到输出区。
function textSort(order) {
    const inputEl = document.getElementById('text-input');
    const outputEl = document.getElementById('text-output');
    if (!inputEl || !outputEl) return;

    const caseSensitive = document.getElementById('text-case-sensitive')?.checked || false;
    const result = DogToolboxM11Utils.sortLines(inputEl.value, order, caseSensitive);
    outputEl.value = result;
}

// 按行倒序排列文本。
function textReverse() {
    const inputEl = document.getElementById('text-input');
    const outputEl = document.getElementById('text-output');
    if (!inputEl || !outputEl) return;

    const result = DogToolboxM11Utils.reverseLines(inputEl.value);
    outputEl.value = result;
}

// 删除空行。
function textRemoveEmpty() {
    const inputEl = document.getElementById('text-input');
    const outputEl = document.getElementById('text-output');
    if (!inputEl || !outputEl) return;

    const result = DogToolboxM11Utils.removeEmptyLines(inputEl.value);
    outputEl.value = result;
}

// 去掉每一行首尾空白。
function textTrimLines() {
    const inputEl = document.getElementById('text-input');
    const outputEl = document.getElementById('text-output');
    if (!inputEl || !outputEl) return;

    const result = DogToolboxM11Utils.trimAllLines(inputEl.value);
    outputEl.value = result;
}

// 为每一行加上行号。
// 适合把纯文本临时变成“1. xxx / 2. yyy”这类可引用形式。
function textAddLineNumbers() {
    const inputEl = document.getElementById('text-input');
    const outputEl = document.getElementById('text-output');
    if (!inputEl || !outputEl) return;

    const result = DogToolboxM11Utils.addLineNumbers(inputEl.value, 1);
    outputEl.value = result;
}

// 删除已经存在的行号前缀。
function textRemoveLineNumbers() {
    const inputEl = document.getElementById('text-input');
    const outputEl = document.getElementById('text-output');
    if (!inputEl || !outputEl) return;

    const result = DogToolboxM11Utils.removeLineNumbers(inputEl.value);
    outputEl.value = result;
}

// 清空文本整理工具的输入、输出和统计提示。
function clearTextTool() {
    const inputEl = document.getElementById('text-input');
    const outputEl = document.getElementById('text-output');
    const statsEl = document.getElementById('text-stats');
    if (inputEl) inputEl.value = '';
    if (outputEl) outputEl.value = '';
    if (statsEl) statsEl.textContent = '';
}

// 复制文本整理输出区。
function copyTextOutput(btn) {
    const outputEl = document.getElementById('text-output');
    const text = outputEl?.value || '';
    copyToolText(btn, text);
}

/* ========== M12: 正则表达式测试 ========== */
// 对应 tool-regex 页面，负责模式输入、匹配结果、替换预览和 flags 切换。
// 这一块通常是外行最容易迷路的页面之一：模式输入区、待测试文本区、flags 复选框、匹配结果区、替换区都由下面这些函数串起来。
async function initRegexTool() {
    const presetEl = document.getElementById('regex-preset');
    if (presetEl) {
        const presets = DogToolboxM12Utils.getPresets();
        presets.forEach(p => {
            const opt = document.createElement('option');
            opt.value = p.key;
            opt.textContent = p.name;
            opt.title = p.description;
            presetEl.appendChild(opt);
        });
    }

    // 初始化 AI 辅助功能
    await initRegexAIHelper();
}

// 正则工具 AI 辅助功能初始化
// 负责决定“正则工具页”顶部是否显示 AI 生成 / AI 修复按钮。
// 如果用户说“别人截图里有 AI 按钮，我这里没有”，先看这里是否判断为 tool-regex 未启用 AI。
async function initRegexAIHelper() {
    if (typeof checkToolAIEnabled !== 'function') return;

    const aiStatus = await checkToolAIEnabled('tool-regex');
    if (!aiStatus.enabled) return;

    const container = document.getElementById('regex-ai-buttons');
    if (!container) return;

    container.innerHTML = '';

    // AI 生成按钮
    if (aiStatus.features.generate) {
        const generateBtn = document.createElement('button');
        generateBtn.className = 'btn btn-sm ai-helper-btn ai-generate-btn';
        generateBtn.innerHTML = '✨ AI 生成';
        generateBtn.title = '根据描述生成正则表达式';
        generateBtn.onclick = () => showRegexAIGenerateModal();
        container.appendChild(generateBtn);
    }

    // AI 修复按钮
    if (aiStatus.features.fix) {
        const fixBtn = document.createElement('button');
        fixBtn.className = 'btn btn-sm ai-helper-btn ai-fix-btn';
        fixBtn.innerHTML = '🔧 AI 修复';
        fixBtn.title = '修复正则表达式中的错误';
        fixBtn.onclick = () => executeRegexAIFix();
        container.appendChild(fixBtn);
    }
}

// 显示正则 AI 生成弹窗
// 页面按钮“✨ AI 生成”点下去后会打开描述输入弹窗，生成成功后自动把结果回填到正则输入框。
function showRegexAIGenerateModal() {
    if (typeof showAIGenerateModal !== 'function') return;

    showAIGenerateModal('tool-regex', {
        onGenerate: (result) => {
            const patternEl = document.getElementById('regex-pattern');
            if (patternEl) {
                patternEl.value = result.replace(/^\/|\/[gimsuvy]*$/g, '');
                updateRegexTool();
            }
        }
    });
}

// 执行正则 AI 修复
// 当用户已经写了一个正则，但报错或匹配不准时，可通过这里把当前模式交给 AI 修复并回填页面。
async function executeRegexAIFix() {
    if (typeof executeAIFix !== 'function') return;

    const patternEl = document.getElementById('regex-pattern');
    const content = patternEl ? patternEl.value.trim() : '';

    if (!content) {
        showToast('请先输入正则表达式', 'warning');
        return;
    }

    showToast('🔧 AI 正在修复...', 'info');

    const result = await executeAIFix('tool-regex', content);

    if (result.success) {
        patternEl.value = result.result.replace(/^\/|\/[gimsuvy]*$/g, '');
        updateRegexTool();
        showToast('AI 修复完成', 'success');
    } else {
        showToast(`修复失败: ${result.error}`, 'error');
    }
}

// 从预设下拉框回填一个常用正则模板。
// 例如邮箱、手机号、URL 等常见表达式通常会在这里注入到 pattern 输入框中。
function loadRegexPreset() {
    const presetEl = document.getElementById('regex-preset');
    const patternEl = document.getElementById('regex-pattern');
    if (!presetEl || !patternEl) return;

    const key = presetEl.value;
    if (!key) return;

    const preset = DogToolboxM12Utils.getPreset(key);
    if (preset) {
        patternEl.value = preset.pattern;
        updateRegexTool();
    }
    presetEl.value = '';
}

// 把 flags 复选框同步成真正的 flags 字符串。
// 页面上的 g/i/m/s 小勾选框变化后，会统一拼成一个字符串再交给 updateRegexTool()。
function syncRegexFlags() {
    const flagsEl = document.getElementById('regex-flags');
    if (!flagsEl) return;

    let flags = '';
    if (document.getElementById('regex-flag-g')?.checked) flags += 'g';
    if (document.getElementById('regex-flag-i')?.checked) flags += 'i';
    if (document.getElementById('regex-flag-m')?.checked) flags += 'm';
    if (document.getElementById('regex-flag-s')?.checked) flags += 's';

    flagsEl.value = flags;
    updateRegexTool();
}

// 正则测试主渲染入口。
// 页面位置：模式输入区、测试文本区、匹配结果区、匹配数提示、错误区。
// 负责内容：执行匹配、渲染每个命中项、展示捕获组和位置索引。
// 排障建议：正则页面“无匹配 / 报错 / 分组展示不对”时，优先看这里。
function updateRegexTool() {
    const patternEl = document.getElementById('regex-pattern');
    const flagsEl = document.getElementById('regex-flags');
    const inputEl = document.getElementById('regex-input');
    const matchesEl = document.getElementById('regex-matches');
    const countEl = document.getElementById('regex-match-count');
    const errorsEl = document.getElementById('regex-errors');

    if (!patternEl || !inputEl || !matchesEl) return;

    const pattern = patternEl.value;
    const flags = flagsEl?.value || 'g';
    const text = inputEl.value;

    if (errorsEl) errorsEl.innerHTML = '';
    if (countEl) countEl.textContent = '';

    if (!pattern) {
        matchesEl.innerHTML = '<div class="regex-empty">输入正则表达式开始匹配</div>';
        return;
    }

    const { matches, error } = DogToolboxM12Utils.testMatch(text, pattern, flags);

    if (error) {
        if (errorsEl) errorsEl.innerHTML = `<div>正则错误: ${error}</div>`;
        matchesEl.innerHTML = '';
        return;
    }

    if (countEl) {
        countEl.textContent = `${matches.length} 个匹配`;
    }

    if (matches.length === 0) {
        matchesEl.innerHTML = '<div class="regex-empty">无匹配</div>';
        return;
    }

    matchesEl.innerHTML = matches.map((m, i) => {
        const groupsHtml = m.groups.length > 0
            ? `<div class="regex-groups">${m.groups.map((g, j) => `<span class="regex-group">$${j + 1}: ${escapeHtml(g || '')}</span>`).join('')}</div>`
            : '';
        return `<div class="regex-match-item">
            <div class="regex-match-header">
                <span class="regex-match-index">#${i + 1}</span>
                <span class="regex-match-pos">位置: ${m.index}</span>
            </div>
            <div class="regex-match-text">${escapeHtml(m.match)}</div>
            ${groupsHtml}
        </div>`;
    }).join('');
}

// 正则替换入口。
// 与 updateRegexTool() 不同，这里处理的是“把匹配到的内容替换成新文本”，结果输出到 replaced 区域。
function executeRegexReplace() {
    const patternEl = document.getElementById('regex-pattern');
    const flagsEl = document.getElementById('regex-flags');
    const inputEl = document.getElementById('regex-input');
    const replacementEl = document.getElementById('regex-replacement');
    const replacedEl = document.getElementById('regex-replaced');
    const errorsEl = document.getElementById('regex-errors');

    if (!patternEl || !inputEl || !replacedEl) return;

    const pattern = patternEl.value;
    const flags = flagsEl?.value || 'g';
    const text = inputEl.value;
    const replacement = replacementEl?.value || '';

    if (!pattern) {
        replacedEl.value = '';
        return;
    }

    const { result, count, error } = DogToolboxM12Utils.replaceAll(text, pattern, replacement, flags);

    if (error) {
        if (errorsEl) errorsEl.innerHTML = `<div>正则错误: ${error}</div>`;
        replacedEl.value = '';
        return;
    }

    replacedEl.value = result;
}

// 清空正则测试页的所有输入、勾选框和结果区域。
// 会把 g 标志恢复为默认勾选，避免用户清空后处于不可预期状态。
function clearRegexTool() {
    const patternEl = document.getElementById('regex-pattern');
    const flagsEl = document.getElementById('regex-flags');
    const inputEl = document.getElementById('regex-input');
    const matchesEl = document.getElementById('regex-matches');
    const countEl = document.getElementById('regex-match-count');
    const errorsEl = document.getElementById('regex-errors');
    const replacementEl = document.getElementById('regex-replacement');
    const replacedEl = document.getElementById('regex-replaced');

    if (patternEl) patternEl.value = '';
    if (flagsEl) flagsEl.value = 'g';
    if (inputEl) inputEl.value = '';
    if (matchesEl) matchesEl.innerHTML = '<div class="regex-empty">输入正则表达式开始匹配</div>';
    if (countEl) countEl.textContent = '';
    if (errorsEl) errorsEl.innerHTML = '';
    if (replacementEl) replacementEl.value = '';
    if (replacedEl) replacedEl.value = '';

    document.getElementById('regex-flag-g').checked = true;
    document.getElementById('regex-flag-i').checked = false;
    document.getElementById('regex-flag-m').checked = false;
    document.getElementById('regex-flag-s').checked = false;
}

// 复制正则匹配结果区中每条命中的正文。
// 这里只复制 .regex-match-text，不会复制位置、分组标题等外围 UI 文案。
function copyRegexMatches(btn) {
    const matchesEl = document.getElementById('regex-matches');
    const items = matchesEl?.querySelectorAll('.regex-match-text') || [];
    const text = Array.from(items).map(el => el.textContent).join('\n');
    copyToolText(btn, text);
}

// 复制“替换结果”文本框。
function copyRegexReplaced(btn) {
    const replacedEl = document.getElementById('regex-replaced');
    const text = replacedEl?.value || '';
    copyToolText(btn, text);
}

// escapeHtml 已移至 app_state.js

// ========== M13: cURL 解析工具 ==========
// 对应 tool-curl 页面，负责把原始 cURL 文本解析成结构化请求参数与代码片段。


// cURL 工具初始化入口。
// 页面位置：原始 cURL 输入区、解析结果区、目标语言按钮组、代码输出区。
// 初始化时会清空旧解析结果，并默认把代码生成语言设为 fetch。
function initCurlTool() {
    curlState.parsed = null;
    curlState.lang = 'fetch';
    updateCurlLangBtns();
}

// cURL 解析主入口。
// 用户点击“解析”按钮后，原始命令会在这里被拆成 method、url、headers、body 等结构化字段，
// 然后分别写到“解析结果区”和“代码生成区”。
// 排障建议：如果 cURL 页面第一块就报错，先看这里，再看 DogToolboxM13Utils.parseCurl() 的输出。
function parseCurlCommand() {
    const inputEl = document.getElementById('curl-input');
    const parsedEl = document.getElementById('curl-parsed');
    const codeEl = document.getElementById('curl-code');
    const errorsEl = document.getElementById('curl-errors');

    if (errorsEl) errorsEl.innerHTML = '';

    const cmd = inputEl?.value?.trim() || '';
    if (!cmd) {
        if (errorsEl) errorsEl.innerHTML = '<div>请输入 cURL 命令</div>';
        return;
    }

    const parsed = DogToolboxM13Utils.parseCurl(cmd);
    curlState.parsed = parsed;

    if (parsed.errors && parsed.errors.length > 0) {
        if (errorsEl) errorsEl.innerHTML = parsed.errors.map(e => `<div>${e}</div>`).join('');
    }

    if (parsedEl) {
        parsedEl.value = DogToolboxM13Utils.formatParsedResult(parsed);
    }

    generateCurlCode();
}

// 根据当前已解析的 cURL 结果，生成不同语言的示例代码。
// 页面上的语言按钮切换不会重新解析 cURL，只会复用 curlState.parsed 在这里重新拼装代码。
function generateCurlCode() {
    const codeEl = document.getElementById('curl-code');
    if (!codeEl || !curlState.parsed) {
        if (codeEl) codeEl.value = '';
        return;
    }

    let code = '';
    switch (curlState.lang) {
        case 'fetch':
            code = DogToolboxM13Utils.toFetch(curlState.parsed);
            break;
        case 'axios':
            code = DogToolboxM13Utils.toAxios(curlState.parsed);
            break;
        case 'python':
            code = DogToolboxM13Utils.toPythonRequests(curlState.parsed);
            break;
        case 'node':
            code = DogToolboxM13Utils.toNodeHttp(curlState.parsed);
            break;
        case 'php':
            code = DogToolboxM13Utils.toPhpCurl(curlState.parsed);
            break;
        case 'go':
            code = DogToolboxM13Utils.toGo(curlState.parsed);
            break;
        default:
            code = DogToolboxM13Utils.toFetch(curlState.parsed);
    }
    codeEl.value = code;
}

// 切换 cURL 代码生成语言。
// 例如 fetch / axios / python / node / php / go，对应下方代码区展示不同模板。
function setCurlLang(lang) {
    curlState.lang = lang;
    updateCurlLangBtns();
    generateCurlCode();
}

// 刷新 cURL 语言按钮的 active 状态。
function updateCurlLangBtns() {
    const langs = ['fetch', 'axios', 'python', 'node', 'php', 'go'];
    langs.forEach(l => {
        const btn = document.getElementById(`curl-lang-${l}`);
        if (btn) {
            btn.classList.toggle('active', l === curlState.lang);
        }
    });
}

// 清空 cURL 工具的输入、解析结果、代码结果和错误区。
// 同时会把 curlState.parsed 置空，避免旧结果污染下一次生成。
function clearCurlTool() {
    const inputEl = document.getElementById('curl-input');
    const parsedEl = document.getElementById('curl-parsed');
    const codeEl = document.getElementById('curl-code');
    const errorsEl = document.getElementById('curl-errors');

    if (inputEl) inputEl.value = '';
    if (parsedEl) parsedEl.value = '';
    if (codeEl) codeEl.value = '';
    if (errorsEl) errorsEl.innerHTML = '';

    curlState.parsed = null;
}

// 复制 cURL 结构化解析结果。
function copyCurlParsed(btn) {
    const parsedEl = document.getElementById('curl-parsed');
    copyToolText(btn, parsedEl?.value || '');
}

// 复制 cURL 生成的代码片段。
function copyCurlCode(btn) {
    const codeEl = document.getElementById('curl-code');
    copyToolText(btn, codeEl?.value || '');
}

// ========== cURL 工具联动 ==========
// 这一段负责把 cURL 解析结果回填到其它工具，或从其它工具接收预填数据。

// 把当前 cURL 解析结果发送到 HTTP Collections 工具页。
// 这属于“跨工具跳转/联动”入口；前提是 parseCurlCommand() 已经先把 curlState.parsed 准备好。
function sendCurlToHttpCollections() {
    if (!curlState.parsed) {
        showToast('请先解析 cURL 命令', 'warning');
        return;
    }
    transferDataToTool('http-collections', curlState.parsed, 'http-request');
}

// 把解析出的 method、url、headers、body 逐项回填到 HTTP 请求页面。
// 如果用户反馈“从 cURL 跳过去后 URL 带上了，但 Header/Body 没过去”，优先看这里每一段是否命中了对应 DOM。
function populateHttpFromCurl(parsedCurl) {
    if (!parsedCurl) return;

    // 填充 URL
    const urlEl = document.getElementById('http-url');
    if (urlEl) urlEl.value = parsedCurl.url || '';

    // 填充 Method
    const methodEl = document.getElementById('http-method');
    if (methodEl) methodEl.value = (parsedCurl.method || 'GET').toUpperCase();

    // 清空并填充 Headers
    const headersContainer = document.getElementById('http-headers-list');
    if (headersContainer && parsedCurl.headers) {
        headersContainer.innerHTML = '';
        const headers = Object.entries(parsedCurl.headers);
        headers.forEach(([key, value]) => {
            if (typeof addHttpHeaderRow === 'function') {
                addHttpHeaderRow(key, value, true);
            }
        });
        // 添加空行供继续添加
        if (typeof addHttpHeaderRow === 'function') {
            addHttpHeaderRow('', '', true);
        }
    }

    // 填充 Body
    if (parsedCurl.data) {
        if (typeof switchHttpBodyType === 'function') {
            // 尝试判断是否为 JSON
            try {
                JSON.parse(parsedCurl.data);
                switchHttpBodyType('json');
            } catch {
                switchHttpBodyType('raw');
            }
        }
        const bodyEl = document.getElementById('http-body-text');
        if (bodyEl) bodyEl.value = parsedCurl.data;
    }
}

// ========== M14: 颜色转换器 ==========
// 对应 tool-color 页面，负责颜色值换算、预览块更新和格式复制。

// 颜色工具初始化入口。
// 页面位置：颜色输入框、颜色预览块、格式输出区、配色推荐区。
function initColorTool() {
    const inputEl = document.getElementById('color-input');
    if (!inputEl) return;
    inputEl.addEventListener('input', updateColorTool);
}

// 颜色工具主刷新入口。
// 负责把用户输入解析成统一颜色对象，再同步更新预览色块、各种格式输出框，以及互补色/类似色等配色区域。
// 排障建议：颜色能识别但配色区不变时，先看 updateColorPalette() 是否被成功调用。
function updateColorTool() {
    const inputEl = document.getElementById('color-input');
    const errorsEl = document.getElementById('color-errors');
    const detectEl = document.getElementById('color-detect');
    const previewColorEl = document.getElementById('color-preview-color');

    if (errorsEl) errorsEl.innerHTML = '';
    if (detectEl) detectEl.textContent = '';

    const input = inputEl?.value?.trim() || '';
    if (!input) {
        clearColorOutputs();
        return;
    }

    const color = DogToolboxM14Utils.parseColor(input);

    if (color.error) {
        if (errorsEl) errorsEl.innerHTML = `<div>${color.error}</div>`;
        clearColorOutputs();
        return;
    }

    // 显示检测到的格式
    if (detectEl) {
        const formatNames = {
            'hex': 'HEX',
            'rgb': 'RGB',
            'rgba': 'RGBA',
            'hsl': 'HSL',
            'hsla': 'HSLA'
        };
        const isDark = DogToolboxM14Utils.isDark(color);
        detectEl.textContent = `格式: ${formatNames[color.format] || color.format.toUpperCase()} | ${isDark ? '深色' : '浅色'}`;
    }

    // 更新预览
    if (previewColorEl) {
        previewColorEl.style.backgroundColor = DogToolboxM14Utils.toRgb(color, true);
    }

    // 获取所有格式
    const formats = DogToolboxM14Utils.getAllFormats(color);

    // 更新输出字段
    setColorOutput('hex', formats.hex);
    setColorOutput('hexa', formats.hexAlpha);
    setColorOutput('rgb', formats.rgb);
    setColorOutput('rgba', formats.rgba);
    setColorOutput('hsl', formats.hsl);
    setColorOutput('hsla', formats.hsla);
    setColorOutput('hsv', formats.hsv);
    setColorOutput('cmyk', formats.cmyk);

    // 更新相关色
    updateColorPalette(color);
}

// 写入某个颜色格式输出框。
// 这是多个格式结果框的公共回填函数，避免每种格式都重复写 DOM 赋值。
function setColorOutput(id, value) {
    const el = document.getElementById(`color-out-${id}`);
    if (el) el.value = value;
}

// 清空所有颜色输出区域。
// 包括 HEX/RGB/HSL 等格式框、中心预览色块，以及配色推荐区。
function clearColorOutputs() {
    const ids = ['hex', 'hexa', 'rgb', 'rgba', 'hsl', 'hsla', 'hsv', 'cmyk'];
    ids.forEach(id => setColorOutput(id, ''));

    const previewColorEl = document.getElementById('color-preview-color');
    if (previewColorEl) previewColorEl.style.backgroundColor = 'transparent';

    clearColorPalette();
}

// 更新颜色相关配色方案。
// 页面位置：互补色、三等分色、类似色那几块小色卡区域。
function updateColorPalette(color) {
    // 互补色
    const complement = DogToolboxM14Utils.getComplementary(color);
    setColorPaletteSwatch('complement', complement);

    // 三等分色
    const triadic = DogToolboxM14Utils.getTriadic(color);
    setColorPaletteSwatch('triadic1', triadic[0]);
    setColorPaletteSwatch('triadic2', triadic[1]);

    // 类似色
    const analogous = DogToolboxM14Utils.getAnalogous(color);
    setColorPaletteSwatch('analog1', analogous[0]);
    setColorPaletteSwatch('analog2', analogous[1]);
}

// 渲染单个配色色块及其文字值。
function setColorPaletteSwatch(id, color) {
    const swatchEl = document.getElementById(`color-${id}`);
    const valueEl = document.getElementById(`color-${id}-value`);

    if (swatchEl) {
        swatchEl.style.backgroundColor = DogToolboxM14Utils.toRgb(color);
    }
    if (valueEl) {
        valueEl.textContent = DogToolboxM14Utils.toHex(color);
    }
}

// 清空所有配色色卡。
function clearColorPalette() {
    const ids = ['complement', 'triadic1', 'triadic2', 'analog1', 'analog2'];
    ids.forEach(id => {
        const swatchEl = document.getElementById(`color-${id}`);
        const valueEl = document.getElementById(`color-${id}-value`);
        if (swatchEl) swatchEl.style.backgroundColor = 'transparent';
        if (valueEl) valueEl.textContent = '';
    });
}

// 清空颜色工具输入与展示结果。
function clearColorTool() {
    const inputEl = document.getElementById('color-input');
    const errorsEl = document.getElementById('color-errors');
    const detectEl = document.getElementById('color-detect');

    if (inputEl) inputEl.value = '';
    if (errorsEl) errorsEl.innerHTML = '';
    if (detectEl) detectEl.textContent = '';

    clearColorOutputs();
}

// 复制某个颜色格式输出框。
function copyColorOutput(btn, id) {
    const el = document.getElementById(`color-out-${id}`);
    copyToolText(btn, el?.value || '');
}

// ========== M15: IP 工具 ==========
// 对应 tool-ip 页面，负责基础 IP 校验与附加信息展示。

// IP 工具初始化入口。
// 页面位置：IP/CIDR 输入框、基础信息卡片、十进制/十六进制/二进制输出区、CIDR 子网信息区。
function initIpTool() {
    const inputEl = document.getElementById('ip-input');
    if (!inputEl) return;
    inputEl.addEventListener('input', updateIpTool);
}

// IP 工具主计算入口。
// 会先判断用户输入的是普通 IP 还是 CIDR，再分别渲染基础信息和子网信息。
// 外行排障建议：如果“输入了 IP 却什么都没显示”，先看这里是否被提前 return，再看输入格式是否被判定无效。
function updateIpTool() {
    const inputEl = document.getElementById('ip-input');
    const errorsEl = document.getElementById('ip-errors');
    const infoCard = document.getElementById('ip-info-card');
    const cidrPanel = document.getElementById('ip-cidr-panel');

    if (errorsEl) errorsEl.innerHTML = '';
    if (infoCard) infoCard.style.display = 'none';
    if (cidrPanel) cidrPanel.style.display = 'none';
    clearIpOutputs();

    const input = inputEl?.value?.trim() || '';
    if (!input) return;

    if (!window.DogToolboxM15Utils) {
        if (errorsEl) errorsEl.innerHTML = '<div>⚠ 工具模块未加载：tools_m15_utils.js</div>';
        return;
    }

    // 检测是否为 CIDR 格式
    const isCidr = input.includes('/');

    if (isCidr) {
        const result = DogToolboxM15Utils.parseCIDR(input);
        if (result.error) {
            if (errorsEl) errorsEl.innerHTML = `<div>⚠ ${escapeHtml(result.error)}</div>`;
            return;
        }

        // 显示基本信息
        if (infoCard) {
            infoCard.style.display = '';
            document.getElementById('ip-type').textContent = 'IPv4 / CIDR';
            document.getElementById('ip-class').textContent = result.ipClass || '-';
            document.getElementById('ip-private').textContent = result.isPrivate ? '是' : '否';
        }

        // 显示格式转换
        document.getElementById('ip-out-decimal').value = DogToolboxM15Utils.ipv4ToDecimal(result.ip) || '';
        document.getElementById('ip-out-hex').value = DogToolboxM15Utils.ipv4ToHex(result.ip) || '';
        document.getElementById('ip-out-binary').value = DogToolboxM15Utils.ipv4ToBinary(result.ip) || '';

        // 显示子网信息
        if (cidrPanel) {
            cidrPanel.style.display = '';
            document.getElementById('cidr-network').textContent = result.network;
            document.getElementById('cidr-broadcast').textContent = result.broadcast;
            document.getElementById('cidr-netmask').textContent = result.netmask;
            document.getElementById('cidr-hosts').textContent = result.hostCount.toLocaleString();
            document.getElementById('cidr-first').textContent = result.firstHost;
            document.getElementById('cidr-last').textContent = result.lastHost;
        }
    } else {
        // 普通 IP 地址
        const isV4 = DogToolboxM15Utils.isValidIPv4(input);
        const isV6 = DogToolboxM15Utils.isValidIPv6(input);

        if (!isV4 && !isV6) {
            if (errorsEl) errorsEl.innerHTML = '<div>⚠ 无效的 IP 地址格式</div>';
            return;
        }

        if (infoCard) {
            infoCard.style.display = '';
            document.getElementById('ip-type').textContent = isV4 ? 'IPv4' : 'IPv6';
            document.getElementById('ip-class').textContent = isV4 ? (DogToolboxM15Utils.getIPClass(input) || '-') : 'N/A';
            document.getElementById('ip-private').textContent = isV4 ? (DogToolboxM15Utils.isPrivateIP(input) ? '是' : '否') : 'N/A';
        }

        if (isV4) {
            document.getElementById('ip-out-decimal').value = DogToolboxM15Utils.ipv4ToDecimal(input) || '';
            document.getElementById('ip-out-hex').value = DogToolboxM15Utils.ipv4ToHex(input) || '';
            document.getElementById('ip-out-binary').value = DogToolboxM15Utils.ipv4ToBinary(input) || '';
        }
    }
}

// 清空 IP 工具三个基础输出框。
// 这里只负责 decimal / hex / binary，不处理上方信息卡和 CIDR 面板的显隐。
function clearIpOutputs() {
    document.getElementById('ip-out-decimal').value = '';
    document.getElementById('ip-out-hex').value = '';
    document.getElementById('ip-out-binary').value = '';
}

// 清空整个 IP 页面。
// 包括输入框、错误区、基础信息卡、CIDR 面板和各类转换结果。
function clearIpTool() {
    const inputEl = document.getElementById('ip-input');
    const errorsEl = document.getElementById('ip-errors');
    const infoCard = document.getElementById('ip-info-card');
    const cidrPanel = document.getElementById('ip-cidr-panel');

    if (inputEl) inputEl.value = '';
    if (errorsEl) errorsEl.innerHTML = '';
    if (infoCard) infoCard.style.display = 'none';
    if (cidrPanel) cidrPanel.style.display = 'none';
    clearIpOutputs();
}

// 复制某个 IP 输出框。
function copyIpOutput(btn, type) {
    const idMap = { decimal: 'ip-out-decimal', hex: 'ip-out-hex', binary: 'ip-out-binary' };
    const el = document.getElementById(idMap[type]);
    copyToolText(btn, el?.value || '');
}

// ========== M15: Cron 解析 ==========
// 对应 tool-cron 页面，负责表达式解析、字段说明和自然语言预览。

// Cron 工具初始化入口。
// 页面位置：Cron 输入框、解析描述区、字段说明区、下次运行时间列表。
function initCronTool() {
    const inputEl = document.getElementById('cron-input');
    if (!inputEl) return;
    inputEl.addEventListener('input', updateCronTool);
}

// 从预设按钮/链接快速填入一个 Cron 表达式。
// 适合页面上“每 5 分钟 / 每天 0 点”这类快捷示例直接触发。
function loadCronPreset(expr) {
    const inputEl = document.getElementById('cron-input');
    if (inputEl) {
        inputEl.value = expr;
        updateCronTool();
    }
}

// Cron 解析主入口。
// 负责清空旧结果、兼容紧凑写法、调用解析器生成自然语言说明和未来运行时间列表。
// 排障建议：Cron 页面主要看这里；如果表达式输入后完全没反应，通常就是这里没跑通或解析器返回 error。
function updateCronTool() {
    const inputEl = document.getElementById('cron-input');
    const errorsEl = document.getElementById('cron-errors');
    const descEl = document.getElementById('cron-description');
    const fieldsEl = document.getElementById('cron-fields');
    const nextPanel = document.getElementById('cron-next-panel');
    const nextList = document.getElementById('cron-next-list');

    if (errorsEl) errorsEl.innerHTML = '';
    if (descEl) descEl.textContent = '输入 Cron 表达式开始解析';
    if (fieldsEl) fieldsEl.innerHTML = '';
    if (nextPanel) nextPanel.style.display = 'none';
    if (nextList) nextList.innerHTML = '';

    let input = inputEl?.value?.trim() || '';
    if (!input) return;

    // 自动为紧凑输入添加空格（如 "00***" → "0 0 * * *"）
    // 规则：默认每个字符代表一个字段；仅对步进写法合并（如 "*/5"、"0/15"）
    if (!input.includes(' ') && input.length >= 5) {
        const chars = input.split('');
        const fields = [];
        let current = '';
        for (const c of chars) {
            // 允许在 "…/" 后继续拼接数字（支持多位数：*/15、0/30）
            if (/\d/.test(c) && /\/\d*$/.test(current)) {
                current += c;
                continue;
            }
            // 允许 "/" 拼接到数字或 "*" 后面（如 "*/", "0/"）
            if (c === '/' && /^[\d\*]$/.test(current)) {
                current += c;
                continue;
            }
            // 其他情况：结束当前字段，开始新字段
            if (current) fields.push(current);
            current = c;
        }
        if (current) fields.push(current);
        if (fields.length >= 5) {
            input = fields.join(' ');
        }
    }

    if (!window.DogToolboxM15Utils) {
        if (errorsEl) errorsEl.innerHTML = '<div>⚠ 工具模块未加载：tools_m15_utils.js</div>';
        return;
    }

    const result = DogToolboxM15Utils.parseCron(input);

    if (result.error) {
        if (errorsEl) errorsEl.innerHTML = `<div>⚠ ${escapeHtml(result.error)}</div>`;
        return;
    }

    if (descEl) {
        descEl.textContent = result.description || '无法生成描述';
    }

    // 显示下次运行时间
    if (result.nextRuns && result.nextRuns.length > 0) {
        if (nextPanel) nextPanel.style.display = '';
        if (nextList) {
            nextList.innerHTML = result.nextRuns.map(run => `<li>${escapeHtml(run)}</li>`).join('');
        }
    }
}

// 清空 Cron 页面。
// 会把描述区恢复成默认提示文案，并隐藏“下次运行时间”面板。
function clearCronTool() {
    const inputEl = document.getElementById('cron-input');
    const errorsEl = document.getElementById('cron-errors');
    const descEl = document.getElementById('cron-description');
    const fieldsEl = document.getElementById('cron-fields');
    const nextPanel = document.getElementById('cron-next-panel');
    const nextList = document.getElementById('cron-next-list');

    if (inputEl) inputEl.value = '';
    if (errorsEl) errorsEl.innerHTML = '';
    if (descEl) descEl.textContent = '输入 Cron 表达式开始解析';
    if (fieldsEl) fieldsEl.innerHTML = '';
    if (nextPanel) nextPanel.style.display = 'none';
    if (nextList) nextList.innerHTML = '';
}

// ========== M15: SQL 格式化 ==========
// 对应 tool-sql 页面，负责格式化、压缩和格式错误提示。


// SQL 工具初始化入口。
// 页面位置：SQL 输入区、格式化/压缩模式按钮、输出区、错误区、表名提取区。
function initSqlTool() {
    const inputEl = document.getElementById('sql-input');
    if (!inputEl) return;
    inputEl.addEventListener('input', updateSqlTool);
    setSqlMode('format');
}

// 切换 SQL 工具当前模式。
// format 会输出更易读的多行 SQL；minify 则压缩成紧凑文本，适合嵌入脚本或配置。
function setSqlMode(mode) {
    if (mode !== 'format' && mode !== 'minify') return;
    sqlMode = mode;
    document.getElementById('sql-format-btn')?.classList.toggle('active', sqlMode === 'format');
    document.getElementById('sql-minify-btn')?.classList.toggle('active', sqlMode === 'minify');
    updateSqlTool();
}

// SQL 工具主处理入口。
// 负责读取 SQL 文本、按当前模式格式化/压缩，并在下方额外提取涉及的表名标签。
// 排障建议：如果 SQL 页面“能输出结果，但表名区空白”，先看 extractTables() 返回值，再看这里的 tablesPanel 渲染。
function updateSqlTool() {
    const inputEl = document.getElementById('sql-input');
    const outputEl = document.getElementById('sql-output');
    const errorsEl = document.getElementById('sql-errors');
    const tablesPanel = document.getElementById('sql-tables-panel');
    const tablesList = document.getElementById('sql-tables-list');

    if (errorsEl) errorsEl.innerHTML = '';
    if (outputEl) outputEl.value = '';
    if (tablesPanel) tablesPanel.style.display = 'none';
    if (tablesList) tablesList.innerHTML = '';

    const input = inputEl?.value || '';
    if (!input.trim()) return;

    if (!window.DogToolboxM15Utils) {
        if (errorsEl) errorsEl.innerHTML = '<div>⚠ 工具模块未加载：tools_m15_utils.js</div>';
        return;
    }

    let result;
    const dialect = document.getElementById('sql-dialect')?.value || 'generic';
    if (sqlMode === 'format') {
        result = DogToolboxM15Utils.formatSQL(input, { dialect });
    } else {
        result = DogToolboxM15Utils.minifySQL(input);
    }

    if (result.error) {
        if (errorsEl) errorsEl.innerHTML = `<div>⚠ ${escapeHtml(result.error)}</div>`;
    }

    if (outputEl) outputEl.value = result.result || '';

    // 提取表名
    const tables = DogToolboxM15Utils.extractTables(input);
    if (tables && tables.length > 0) {
        if (tablesPanel) tablesPanel.style.display = '';
        if (tablesList) {
            tablesList.innerHTML = tables.map(t => `<span class="sql-table-tag">${escapeHtml(t)}</span>`).join('');
        }
    }
}

// 清空 SQL 输入、输出、错误和表名提取区域。
function clearSqlTool() {
    const inputEl = document.getElementById('sql-input');
    const outputEl = document.getElementById('sql-output');
    const errorsEl = document.getElementById('sql-errors');
    const tablesPanel = document.getElementById('sql-tables-panel');
    const tablesList = document.getElementById('sql-tables-list');

    if (inputEl) inputEl.value = '';
    if (outputEl) outputEl.value = '';
    if (errorsEl) errorsEl.innerHTML = '';
    if (tablesPanel) tablesPanel.style.display = 'none';
    if (tablesList) tablesList.innerHTML = '';
}

// 复制 SQL 输出区内容。
function copySqlOutput(btn) {
    const outputEl = document.getElementById('sql-output');
    copyToolText(btn, outputEl?.value || '');
}
