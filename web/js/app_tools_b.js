// ==================== 工具函数 ====================
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

function copyCommand(btn, text) {
    copyToolText(btn, text);
}

// ==================== 工具箱：URL 编解码（M8） ====================
const URL_HISTORY_KEY = 'url_history';
const URL_HISTORY_MAX = 20;

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

function autoDetectUrlMode(text) {
    if (!window.DogToolboxM8Utils?.detectUrlEncoded) return;
    const detection = window.DogToolboxM8Utils.detectUrlEncoded(text);
    if (detection.isUrlEncoded && detection.confidence >= 0.6) {
        setUrlMode('decode');
        showToast?.('检测到 URL 编码，已切换到解码模式', 'info');
    }
}

function setUrlMode(mode) {
    if (mode !== 'encode' && mode !== 'decode') return;
    urlMode = mode;
    document.getElementById('url-encode-btn')?.classList.toggle('active', urlMode === 'encode');
    document.getElementById('url-decode-btn')?.classList.toggle('active', urlMode === 'decode');
    updateUrlTool();
}

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

function clearUrlTool() {
    const inputEl = document.getElementById('url-input');
    const outputEl = document.getElementById('url-output');
    const errorsEl = document.getElementById('url-errors');
    if (inputEl) inputEl.value = '';
    if (outputEl) outputEl.value = '';
    if (errorsEl) errorsEl.innerHTML = '';
}

function copyUrlOutput(btn) {
    const outputEl = document.getElementById('url-output');
    const text = outputEl?.value || '';
    copyToolText(btn, text);
}

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

function loadUrlHistory() {
    try {
        const raw = localStorage.getItem(URL_HISTORY_KEY);
        return raw ? JSON.parse(raw).entries || [] : [];
    } catch (e) {
        return [];
    }
}

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

function applyUrlHistory(index) {
    const entries = loadUrlHistory();
    const entry = entries[index];
    if (!entry) return;

    const inputEl = document.getElementById('url-input');
    if (inputEl) inputEl.value = entry.input;
    setUrlMode(entry.mode);
}

function clearUrlHistory() {
    localStorage.removeItem(URL_HISTORY_KEY);
    renderUrlHistory();
    showToast?.('历史记录已清空', 'info');
}

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
function initRadixTool() {
    const inputEl = document.getElementById('radix-input');
    if (!inputEl) return;
    inputEl.addEventListener('input', updateRadixTool);
    document.getElementById('radix-from')?.addEventListener('change', updateRadixTool);
    updateRadixTool();
}

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

function copyRadixOutput(btn, type) {
    const idMap = { bin: 'radix-out-bin', oct: 'radix-out-oct', dec: 'radix-out-dec', hex: 'radix-out-hex' };
    const el = document.getElementById(idMap[type]);
    const text = el?.value || '';
    copyToolText(btn, text);
}

// ==================== 工具箱：Unicode 编解码（M19） ====================

function initUnicodeTool() {
    const inputEl = document.getElementById('unicode-input');
    if (!inputEl) return;
    inputEl.addEventListener('input', updateUnicodeTool);
    setUnicodeMode('encode');
}

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

function copyUnicodeOutput(btn) {
    const outputEl = document.getElementById('unicode-output');
    const text = outputEl?.value || '';
    copyToolText(btn, text);
}

// ==================== 工具箱：HMAC 计算（M21） ====================
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

function copyHmacOutput(btn) {
    const outputEl = document.getElementById('hmac-output');
    const text = outputEl?.value || '';
    copyToolText(btn, text);
}

// ==================== 工具箱：RSA 加解密（M20） ====================

function initRsaTool() {
    setRsaMode('encrypt');
    updateRsaKeyHint();
}

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

function updateRsaKeyHint() {
    const hintEl = document.getElementById('rsa-key-hint');
    const keysizeEl = document.getElementById('rsa-keysize');
    if (!hintEl) return;
    const keysize = keysizeEl?.value || '2048';
    hintEl.textContent = `当前配置：${keysize} 位 RSA-OAEP (SHA-256)`;
}

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

function copyRsaOutput(btn) {
    const outputEl = document.getElementById('rsa-output');
    const text = outputEl?.value || '';
    copyToolText(btn, text);
}

// ==================== 工具箱：字符统计（M8） ====================
function initCharCountTool() {
    const inputEl = document.getElementById('charcount-input');
    if (!inputEl) return;
    inputEl.addEventListener('input', updateCharCountTool);
    updateCharCountTool();
}

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

function clearCharCountTool() {
    const inputEl = document.getElementById('charcount-input');
    if (inputEl) inputEl.value = '';
    updateCharCountTool();
}

// ==================== 工具箱：密码生成器（M9） ====================
function initPasswordTool() {
    const sliderEl = document.getElementById('password-length-slider');
    const numberEl = document.getElementById('password-length');
    if (!sliderEl || !numberEl) return;
    syncPasswordLength('slider');
}

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

function clearPasswordTool() {
    const outputEl = document.getElementById('password-output');
    const errorsEl = document.getElementById('password-errors');
    const strengthRow = document.getElementById('password-strength-row');
    if (outputEl) outputEl.value = '';
    if (errorsEl) errorsEl.innerHTML = '';
    if (strengthRow) strengthRow.style.display = 'none';
}

function copyPasswordOutput(btn) {
    const outputEl = document.getElementById('password-output');
    const text = outputEl?.value || '';
    copyToolText(btn, text);
}

// ==================== 工具箱：JSON 格式化（M10） ====================

function initJsonTool() {
    const inputEl = document.getElementById('json-input');
    if (!inputEl) return;
    inputEl.addEventListener('input', updateJsonTool);
    setJsonIndent(2);
}

function setJsonIndent(indent) {
    jsonIndent = indent;
    document.querySelectorAll('#json-indent-2, #json-indent-4, #json-indent-tab').forEach(btn => {
        btn.classList.remove('active');
    });
    const btnId = indent === 'tab' ? 'json-indent-tab' : `json-indent-${indent}`;
    document.getElementById(btnId)?.classList.add('active');
    updateJsonTool();
}

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
// let jsonViewMode = 'text';

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

function toggleJsonTreeNode(toggle) {
    if (window.DogToolboxM16Utils) {
        window.DogToolboxM16Utils.toggleNode(toggle);
    }
}

function expandAllJsonTree() {
    const container = document.getElementById('json-tree-content');
    if (window.DogToolboxM16Utils && container) {
        window.DogToolboxM16Utils.expandAll(container);
    }
}

function collapseAllJsonTree() {
    const container = document.getElementById('json-tree-content');
    if (window.DogToolboxM16Utils && container) {
        window.DogToolboxM16Utils.collapseAll(container);
    }
}

function copyJsonOutput(btn) {
    const outputEl = document.getElementById('json-output');
    const text = outputEl?.value || '';
    copyToolText(btn, text);
}

// JSON 字段排序
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

// JSON 转义
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

// JSON 反转义
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
 

function initDataConvertTool() {
    updateDataFormatButtons();
}

function setDataInputFormat(format) {
    dataInputFormat = format;
    updateDataFormatButtons();
    updateDataConvertTool();
}

function setDataOutputFormat(format) {
    dataOutputFormat = format;
    updateDataFormatButtons();
    updateDataConvertTool();
}

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

    // Step 1: Parse input to JS object
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

    // Step 2: Convert to output format
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

function copyDataConvertOutput(btn) {
    const outputEl = document.getElementById('data-convert-output');
    if (!outputEl || !outputEl.value) return;
    copyToolText(btn, outputEl.value);
}

/* ========== M11: 文本去重/排序 ========== */
function initTextTool() {
    const inputEl = document.getElementById('text-input');
    if (inputEl) {
        inputEl.addEventListener('input', updateTextStats);
    }
}

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

function textDeduplicate() {
    const inputEl = document.getElementById('text-input');
    const outputEl = document.getElementById('text-output');
    if (!inputEl || !outputEl) return;

    const caseSensitive = document.getElementById('text-case-sensitive')?.checked || false;
    const trimLines = document.getElementById('text-trim-lines')?.checked || true;
    const result = DogToolboxM11Utils.deduplicate(inputEl.value, caseSensitive, trimLines);
    outputEl.value = result;
}

function textSort(order) {
    const inputEl = document.getElementById('text-input');
    const outputEl = document.getElementById('text-output');
    if (!inputEl || !outputEl) return;

    const caseSensitive = document.getElementById('text-case-sensitive')?.checked || false;
    const result = DogToolboxM11Utils.sortLines(inputEl.value, order, caseSensitive);
    outputEl.value = result;
}

function textReverse() {
    const inputEl = document.getElementById('text-input');
    const outputEl = document.getElementById('text-output');
    if (!inputEl || !outputEl) return;

    const result = DogToolboxM11Utils.reverseLines(inputEl.value);
    outputEl.value = result;
}

function textRemoveEmpty() {
    const inputEl = document.getElementById('text-input');
    const outputEl = document.getElementById('text-output');
    if (!inputEl || !outputEl) return;

    const result = DogToolboxM11Utils.removeEmptyLines(inputEl.value);
    outputEl.value = result;
}

function textTrimLines() {
    const inputEl = document.getElementById('text-input');
    const outputEl = document.getElementById('text-output');
    if (!inputEl || !outputEl) return;

    const result = DogToolboxM11Utils.trimAllLines(inputEl.value);
    outputEl.value = result;
}

function textAddLineNumbers() {
    const inputEl = document.getElementById('text-input');
    const outputEl = document.getElementById('text-output');
    if (!inputEl || !outputEl) return;

    const result = DogToolboxM11Utils.addLineNumbers(inputEl.value, 1);
    outputEl.value = result;
}

function textRemoveLineNumbers() {
    const inputEl = document.getElementById('text-input');
    const outputEl = document.getElementById('text-output');
    if (!inputEl || !outputEl) return;

    const result = DogToolboxM11Utils.removeLineNumbers(inputEl.value);
    outputEl.value = result;
}

function clearTextTool() {
    const inputEl = document.getElementById('text-input');
    const outputEl = document.getElementById('text-output');
    const statsEl = document.getElementById('text-stats');
    if (inputEl) inputEl.value = '';
    if (outputEl) outputEl.value = '';
    if (statsEl) statsEl.textContent = '';
}

function copyTextOutput(btn) {
    const outputEl = document.getElementById('text-output');
    const text = outputEl?.value || '';
    copyToolText(btn, text);
}

/* ========== M12: 正则表达式测试 ========== */
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

function copyRegexMatches(btn) {
    const matchesEl = document.getElementById('regex-matches');
    const items = matchesEl?.querySelectorAll('.regex-match-text') || [];
    const text = Array.from(items).map(el => el.textContent).join('\n');
    copyToolText(btn, text);
}

function copyRegexReplaced(btn) {
    const replacedEl = document.getElementById('regex-replaced');
    const text = replacedEl?.value || '';
    copyToolText(btn, text);
}

// escapeHtml 已移至 app_state.js

// ========== M13: cURL 解析工具 ==========
 

function initCurlTool() {
    curlState.parsed = null;
    curlState.lang = 'fetch';
    updateCurlLangBtns();
}

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

function setCurlLang(lang) {
    curlState.lang = lang;
    updateCurlLangBtns();
    generateCurlCode();
}

function updateCurlLangBtns() {
    const langs = ['fetch', 'axios', 'python', 'node', 'php', 'go'];
    langs.forEach(l => {
        const btn = document.getElementById(`curl-lang-${l}`);
        if (btn) {
            btn.classList.toggle('active', l === curlState.lang);
        }
    });
}

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

function copyCurlParsed(btn) {
    const parsedEl = document.getElementById('curl-parsed');
    copyToolText(btn, parsedEl?.value || '');
}

function copyCurlCode(btn) {
    const codeEl = document.getElementById('curl-code');
    copyToolText(btn, codeEl?.value || '');
}

// ========== cURL 工具联动 ==========

/**
 * 发送 cURL 解析结果到 HTTP Collections
 */
function sendCurlToHttpCollections() {
    if (!curlState.parsed) {
        showToast('请先解析 cURL 命令', 'warning');
        return;
    }
    transferDataToTool('http-collections', curlState.parsed, 'http-request');
}

/**
 * 从 cURL 解析结果填充 HTTP 请求表单
 * @param {object} parsedCurl - cURL 解析结果
 */
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

function initColorTool() {
    const inputEl = document.getElementById('color-input');
    if (!inputEl) return;
    inputEl.addEventListener('input', updateColorTool);
}

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

function setColorOutput(id, value) {
    const el = document.getElementById(`color-out-${id}`);
    if (el) el.value = value;
}

function clearColorOutputs() {
    const ids = ['hex', 'hexa', 'rgb', 'rgba', 'hsl', 'hsla', 'hsv', 'cmyk'];
    ids.forEach(id => setColorOutput(id, ''));

    const previewColorEl = document.getElementById('color-preview-color');
    if (previewColorEl) previewColorEl.style.backgroundColor = 'transparent';

    clearColorPalette();
}

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

function clearColorPalette() {
    const ids = ['complement', 'triadic1', 'triadic2', 'analog1', 'analog2'];
    ids.forEach(id => {
        const swatchEl = document.getElementById(`color-${id}`);
        const valueEl = document.getElementById(`color-${id}-value`);
        if (swatchEl) swatchEl.style.backgroundColor = 'transparent';
        if (valueEl) valueEl.textContent = '';
    });
}

function clearColorTool() {
    const inputEl = document.getElementById('color-input');
    const errorsEl = document.getElementById('color-errors');
    const detectEl = document.getElementById('color-detect');

    if (inputEl) inputEl.value = '';
    if (errorsEl) errorsEl.innerHTML = '';
    if (detectEl) detectEl.textContent = '';

    clearColorOutputs();
}

function copyColorOutput(btn, id) {
    const el = document.getElementById(`color-out-${id}`);
    copyToolText(btn, el?.value || '');
}

// ========== M15: IP 工具 ==========

function initIpTool() {
    const inputEl = document.getElementById('ip-input');
    if (!inputEl) return;
    inputEl.addEventListener('input', updateIpTool);
}

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

function clearIpOutputs() {
    document.getElementById('ip-out-decimal').value = '';
    document.getElementById('ip-out-hex').value = '';
    document.getElementById('ip-out-binary').value = '';
}

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

function copyIpOutput(btn, type) {
    const idMap = { decimal: 'ip-out-decimal', hex: 'ip-out-hex', binary: 'ip-out-binary' };
    const el = document.getElementById(idMap[type]);
    copyToolText(btn, el?.value || '');
}

// ========== M15: Cron 解析 ==========

function initCronTool() {
    const inputEl = document.getElementById('cron-input');
    if (!inputEl) return;
    inputEl.addEventListener('input', updateCronTool);
}

function loadCronPreset(expr) {
    const inputEl = document.getElementById('cron-input');
    if (inputEl) {
        inputEl.value = expr;
        updateCronTool();
    }
}

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
 

function initSqlTool() {
    const inputEl = document.getElementById('sql-input');
    if (!inputEl) return;
    inputEl.addEventListener('input', updateSqlTool);
    setSqlMode('format');
}

function setSqlMode(mode) {
    if (mode !== 'format' && mode !== 'minify') return;
    sqlMode = mode;
    document.getElementById('sql-format-btn')?.classList.toggle('active', sqlMode === 'format');
    document.getElementById('sql-minify-btn')?.classList.toggle('active', sqlMode === 'minify');
    updateSqlTool();
}

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

function copySqlOutput(btn) {
    const outputEl = document.getElementById('sql-output');
    copyToolText(btn, outputEl?.value || '');
}
