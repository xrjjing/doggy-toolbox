// ==================== 工具箱：Base64 编解码（M2） ====================
function initBase64Tool() {
    const input = document.getElementById('b64-input');
    const batch = document.getElementById('b64-batch');
    if (!input) return;
    input.addEventListener('input', updateBase64Tool);
    batch?.addEventListener('change', updateBase64Tool);
    // 默认编码模式
    setBase64Mode('encode');
}

function setBase64Mode(mode) {
    if (mode !== 'encode' && mode !== 'decode') return;
    base64Mode = mode;
    document.getElementById('b64-encode-btn')?.classList.toggle('active', base64Mode === 'encode');
    document.getElementById('b64-decode-btn')?.classList.toggle('active', base64Mode === 'decode');
    updateBase64Tool();
}

function updateBase64Tool() {
    const inputEl = document.getElementById('b64-input');
    const outputEl = document.getElementById('b64-output');
    const errorsEl = document.getElementById('b64-errors');
    const batchEl = document.getElementById('b64-batch');
    if (!inputEl || !outputEl || !errorsEl) return;

    const inputText = inputEl.value || '';
    const batch = !!batchEl?.checked;
    errorsEl.innerHTML = '';

    if (!inputText.trim()) {
        outputEl.value = '';
        return;
    }

    try {
        if (!window.DogToolboxM2Utils) {
            throw new Error('工具模块未加载：tools_m2_utils.js');
        }

        if (base64Mode === 'encode') {
            if (batch) {
                const lines = inputText.split(/\r?\n/);
                const outLines = lines.map(line => {
                    if (line === '') return '';
                    return window.DogToolboxM2Utils.base64EncodeTextUtf8(line);
                });
                outputEl.value = outLines.join('\n');
            } else {
                outputEl.value = window.DogToolboxM2Utils.base64EncodeTextUtf8(inputText);
            }
        } else {
            if (batch) {
                const lines = inputText.split(/\r?\n/);
                const outLines = lines.map(line => {
                    const normalized = String(line || '').replace(/\s+/g, '');
                    if (!normalized) return '';
                    return window.DogToolboxM2Utils.base64DecodeToTextUtf8(normalized);
                });
                outputEl.value = outLines.join('\n');
            } else {
                const normalized = inputText.replace(/\s+/g, '');
                outputEl.value = window.DogToolboxM2Utils.base64DecodeToTextUtf8(normalized);
            }
        }
    } catch (e) {
        outputEl.value = '';
        errorsEl.innerHTML = `<div>⚠ ${escapeHtml(e?.message || String(e))}</div>`;
    }
}

function clearBase64Tool() {
    const inputEl = document.getElementById('b64-input');
    const outputEl = document.getElementById('b64-output');
    const errorsEl = document.getElementById('b64-errors');
    if (inputEl) inputEl.value = '';
    if (outputEl) outputEl.value = '';
    if (errorsEl) errorsEl.innerHTML = '';
}

function copyBase64Output(btn) {
    const outputEl = document.getElementById('b64-output');
    const text = outputEl?.value || '';
    copyToolText(btn, text);
}

// ==================== 工具箱：UUID 生成器（M2） ====================
function initUuidTool() {
    // 预留：后续可做“进入页面自动生成”
    const countEl = document.getElementById('uuid-count');
    if (!countEl) return;
}

function generateUuids() {
    const countEl = document.getElementById('uuid-count');
    const outputEl = document.getElementById('uuid-output');
    const errorsEl = document.getElementById('uuid-errors');
    const upperEl = document.getElementById('uuid-uppercase');
    const noHyphenEl = document.getElementById('uuid-no-hyphens');

    if (!countEl || !outputEl || !errorsEl) return;
    errorsEl.innerHTML = '';

    const rawCount = String(countEl.value || '').trim();
    let count = parseInt(rawCount, 10);
    if (!Number.isFinite(count) || count < 1) {
        errorsEl.innerHTML = '<div>⚠ 请输入合法的生成数量</div>';
        outputEl.value = '';
        return;
    }
    if (count > 1000) {
        count = 1000;
        errorsEl.innerHTML = '<div>⚠ 数量过大已自动限制为 1000</div>';
    }

    try {
        if (!window.DogToolboxM2Utils) {
            throw new Error('工具模块未加载：tools_m2_utils.js');
        }
        const upper = !!upperEl?.checked;
        const noHyphen = !!noHyphenEl?.checked;
        const list = [];
        for (let i = 0; i < count; i++) {
            let uuid = window.DogToolboxM2Utils.generateUuidV4();
            if (noHyphen) uuid = uuid.replace(/-/g, '');
            uuid = upper ? uuid.toUpperCase() : uuid.toLowerCase();
            list.push(uuid);
        }
        outputEl.value = list.join('\n');
    } catch (e) {
        outputEl.value = '';
        errorsEl.innerHTML = `<div>⚠ ${escapeHtml(e?.message || String(e))}</div>`;
    }
}

function clearUuidTool() {
    const outputEl = document.getElementById('uuid-output');
    const errorsEl = document.getElementById('uuid-errors');
    if (outputEl) outputEl.value = '';
    if (errorsEl) errorsEl.innerHTML = '';
}

function copyUuidOutput(btn) {
    const outputEl = document.getElementById('uuid-output');
    const text = outputEl?.value || '';
    copyToolText(btn, text);
}

// ==================== 工具箱：变量命名转换（M2） ====================
function initNamingTool() {
    const inputEl = document.getElementById('naming-input');
    if (!inputEl) return;
    inputEl.addEventListener('input', updateNamingTool);
    updateNamingTool();
}

function updateNamingTool() {
    const inputEl = document.getElementById('naming-input');
    if (!inputEl) return;
    const inputText = inputEl.value || '';

    if (!window.DogToolboxM2Utils) {
        // 工具页可用但算法模块缺失时，避免报错弹窗
        setNamingOutputs({
            space: '',
            camelSpace: '',
            kebab: '',
            snakeUpper: '',
            pascal: '',
            camel: '',
            snake: ''
        });
        return;
    }

    const formats = window.DogToolboxM2Utils.toNamingFormats(inputText);
    setNamingOutputs(formats);
}

function setNamingOutputs(formats) {
    const map = {
        space: 'naming-space',
        camelSpace: 'naming-camelSpace',
        kebab: 'naming-kebab',
        snakeUpper: 'naming-snakeUpper',
        pascal: 'naming-pascal',
        camel: 'naming-camel',
        snake: 'naming-snake'
    };
    Object.entries(map).forEach(([key, id]) => {
        const el = document.getElementById(id);
        if (el) el.textContent = formats?.[key] ?? '';
    });
}

function copyNamingOutput(btn, key) {
    const el = document.getElementById(`naming-${key}`);
    const text = el?.textContent || '';
    copyToolText(btn, text);
}

function clearNamingTool() {
    const inputEl = document.getElementById('naming-input');
    if (inputEl) inputEl.value = '';
    updateNamingTool();
}

// ==================== 工具箱：JWT 解码（M3） ====================
function initJwtTool() {
    const inputEl = document.getElementById('jwt-input');
    if (!inputEl) return;
    inputEl.addEventListener('input', updateJwtTool);
    updateJwtTool();
}

function updateJwtTool() {
    const inputEl = document.getElementById('jwt-input');
    const typeEl = document.getElementById('jwt-input-type');
    const showHeaderEl = document.getElementById('jwt-show-header');
    const showPayloadEl = document.getElementById('jwt-show-payload');
    const headerSection = document.getElementById('jwt-header-section');
    const payloadSection = document.getElementById('jwt-payload-section');
    const headerOut = document.getElementById('jwt-header-output');
    const payloadOut = document.getElementById('jwt-payload-output');
    const warningEl = document.getElementById('jwt-warning');
    const errorsEl = document.getElementById('jwt-errors');
    if (!inputEl || !typeEl || !headerOut || !payloadOut || !warningEl || !errorsEl) return;

    const showHeader = !!showHeaderEl?.checked;
    const showPayload = !!showPayloadEl?.checked;
    if (headerSection) headerSection.style.display = showHeader ? '' : 'none';
    if (payloadSection) payloadSection.style.display = showPayload ? '' : 'none';

    errorsEl.innerHTML = '';
    warningEl.textContent = '';
    headerOut.value = '';
    payloadOut.value = '';

    const raw = String(inputEl.value || '').trim();
    if (!raw) return;

    try {
        if (!window.DogToolboxM3Utils) {
            throw new Error('工具模块未加载：tools_m3_utils.js');
        }
        const inputType = String(typeEl.value || 'auto');
        const result = window.DogToolboxM3Utils.decodeJwt(raw, inputType);
        headerOut.value = result.headerJson || '';
        payloadOut.value = result.payloadJson || '';
        warningEl.textContent = result.warning || '';
        if (result.errors && result.errors.length) {
            errorsEl.innerHTML = result.errors.map(e => `<div>⚠ ${escapeHtml(e)}</div>`).join('');
        }
    } catch (e) {
        errorsEl.innerHTML = `<div>⚠ ${escapeHtml(e?.message || String(e))}</div>`;
    }
}

function clearJwtTool() {
    const inputEl = document.getElementById('jwt-input');
    const errorsEl = document.getElementById('jwt-errors');
    const warningEl = document.getElementById('jwt-warning');
    if (inputEl) inputEl.value = '';
    if (errorsEl) errorsEl.innerHTML = '';
    if (warningEl) warningEl.textContent = '';
    updateJwtTool();
}

function copyJwtPart(btn, part) {
    const id = part === 'header' ? 'jwt-header-output' : 'jwt-payload-output';
    const el = document.getElementById(id);
    const text = el?.value || '';
    copyToolText(btn, text);
}

function copyJwtAll(btn) {
    const showHeader = !!document.getElementById('jwt-show-header')?.checked;
    const showPayload = !!document.getElementById('jwt-show-payload')?.checked;
    const header = showHeader ? (document.getElementById('jwt-header-output')?.value || '') : '';
    const payload = showPayload ? (document.getElementById('jwt-payload-output')?.value || '') : '';
    const parts = [];
    if (header.trim()) parts.push(header.trim());
    if (payload.trim()) parts.push(payload.trim());
    copyToolText(btn, parts.join('\n\n'));
}

// ==================== 工具箱：时间戳转换（M3） ====================
function initTimeTool() {
    const inputEl = document.getElementById('time-input');
    if (!inputEl) return;
    inputEl.addEventListener('input', () => updateTimeTool(false));
    updateTimeTool(true);
}

function divModBigInt(a, b) {
    let q = a / b;
    let r = a % b;
    if (r < 0n) {
        r += b;
        q -= 1n;
    }
    return { q, r };
}

function getTimeTzOffsetMs() {
    const tz = document.getElementById('time-zone')?.value || 'utc';
    if (tz === 'utc8') return 8 * 60 * 60 * 1000;
    return 0;
}

function getTimeEffectiveInputType(raw, selectedType) {
    const type = String(selectedType || 'auto');
    if (type !== 'auto') return type;
    if (!window.DogToolboxM3Utils) return 'auto';
    const detected = window.DogToolboxM3Utils.detectTimeInputType(raw);
    return detected?.type || 'auto';
}

function updateTimeTool(forceNowUpdate) {
    const inputEl = document.getElementById('time-input');
    const typeEl = document.getElementById('time-input-type');
    const detectEl = document.getElementById('time-detect');
    const errorsEl = document.getElementById('time-errors');
    const outSec = document.getElementById('time-out-sec');
    const outMs = document.getElementById('time-out-ms');
    const outNs = document.getElementById('time-out-ns');
    if (!inputEl || !typeEl || !detectEl || !errorsEl || !outSec || !outMs || !outNs) return;

    const tzOffsetMs = getTimeTzOffsetMs();
    const selectedType = String(typeEl.value || 'auto');
    const raw = String(inputEl.value || '').trim();

    errorsEl.innerHTML = '';
    detectEl.textContent = '';
    outSec.value = '';
    outMs.value = '';
    outNs.value = '';

    if (!raw) {
        if (forceNowUpdate) updateTimeNowArea();
        return;
    }

    try {
        if (!window.DogToolboxM3Utils) {
            throw new Error('工具模块未加载：tools_m3_utils.js');
        }

        const parsed = window.DogToolboxM3Utils.parseTimeInput(raw, selectedType, tzOffsetMs);
        detectEl.textContent = parsed.detectedLabel || '';

        if (parsed.errors && parsed.errors.length) {
            errorsEl.innerHTML = parsed.errors.map(e => `<div>⚠ ${escapeHtml(e)}</div>`).join('');
            return;
        }
        if (!parsed.unixMillis) return;

        const effectiveType = getTimeEffectiveInputType(raw, selectedType);
        const unixMillis = parsed.unixMillis;
        const nanosWithinSecond = parsed.nanosWithinSecond ?? 0n;

        if (effectiveType === 'datetime') {
            // 标准时间 -> Unix 时间戳（秒/毫秒/纳秒）
            const secMod = divModBigInt(unixMillis, 1000n);
            const unixSec = secMod.q;
            const unixNs = unixSec * 1000000000n + nanosWithinSecond;
            outSec.value = unixSec.toString();
            outMs.value = unixMillis.toString();
            outNs.value = unixNs.toString();
        } else {
            // Unix 时间戳 -> 标准时间（秒/毫秒/纳秒）
            outSec.value = window.DogToolboxM3Utils.formatUnixMillis(unixMillis, tzOffsetMs, false);
            outMs.value = window.DogToolboxM3Utils.formatUnixMillis(unixMillis, tzOffsetMs, true);
            outNs.value = window.DogToolboxM3Utils.formatUnixNanos(unixMillis, nanosWithinSecond, tzOffsetMs);
        }
    } catch (e) {
        errorsEl.innerHTML = `<div>⚠ ${escapeHtml(e?.message || String(e))}</div>`;
    } finally {
        if (forceNowUpdate) {
            updateTimeNowArea();
        }
    }
}

function clearTimeTool() {
    const inputEl = document.getElementById('time-input');
    const detectEl = document.getElementById('time-detect');
    const errorsEl = document.getElementById('time-errors');
    const outSec = document.getElementById('time-out-sec');
    const outMs = document.getElementById('time-out-ms');
    const outNs = document.getElementById('time-out-ns');
    if (inputEl) inputEl.value = '';
    if (detectEl) detectEl.textContent = '';
    if (errorsEl) errorsEl.innerHTML = '';
    if (outSec) outSec.value = '';
    if (outMs) outMs.value = '';
    if (outNs) outNs.value = '';
    updateTimeTool(true);
}

function copyTimeOutput(btn, kind) {
    const id = kind === 'sec' ? 'time-out-sec' : (kind === 'ms' ? 'time-out-ms' : 'time-out-ns');
    const el = document.getElementById(id);
    const text = el?.value || '';
    copyToolText(btn, text);
}

function loadTimeValue(type, sourceId) {
    const sourceEl = document.getElementById(sourceId);
    const value = sourceEl?.textContent || '';
    const inputEl = document.getElementById('time-input');
    const typeEl = document.getElementById('time-input-type');
    if (!inputEl || !typeEl) return;
    inputEl.value = value;
    typeEl.value = String(type || 'auto');
    updateTimeTool(true);
}

function updateTimeNowArea() {
    const tzOffsetMs = getTimeTzOffsetMs();
    if (!window.DogToolboxM3Utils) return;
    const now = window.DogToolboxM3Utils.getNowValues(tzOffsetMs);
    const stdSecEl = document.getElementById('time-now-std-sec');
    const unixSecEl = document.getElementById('time-now-unix-sec');
    const stdMsEl = document.getElementById('time-now-std-ms');
    const unixMsEl = document.getElementById('time-now-unix-ms');
    if (stdSecEl) stdSecEl.textContent = now.stdSec || '-';
    if (unixSecEl) unixSecEl.textContent = now.unixSec || '-';
    if (stdMsEl) stdMsEl.textContent = now.stdMs || '-';
    if (unixMsEl) unixMsEl.textContent = now.unixMs || '-';
}

function startTimeNowTicker() {
    stopTimeNowTicker();
    updateTimeNowArea();
    timeNowIntervalId = setInterval(() => {
        // 仅在页面仍然处于激活状态时刷新
        if (activePage !== 'tool-time') return;
        updateTimeNowArea();
    }, 50);
}

function stopTimeNowTicker() {
    if (timeNowIntervalId) {
        clearInterval(timeNowIntervalId);
        timeNowIntervalId = null;
    }
}

// ==================== M32 日期计算器 ====================
function initDateCalcTool() {
    // 设置默认值为今天
    const today = new Date().toISOString().split('T')[0];

    const diffStartEl = document.getElementById('datecalc-diff-start');
    const diffEndEl = document.getElementById('datecalc-diff-end');
    const addBaseEl = document.getElementById('datecalc-add-base');
    const weekdayDateEl = document.getElementById('datecalc-weekday-date');
    const ageBirthEl = document.getElementById('datecalc-age-birth');
    const ageRefEl = document.getElementById('datecalc-age-ref');
    const infoDateEl = document.getElementById('datecalc-info-date');

    // 设置默认日期
    if (diffStartEl) diffStartEl.value = today;
    if (diffEndEl) diffEndEl.value = today;
    if (addBaseEl) addBaseEl.value = today;
    if (weekdayDateEl) weekdayDateEl.value = today;
    if (infoDateEl) infoDateEl.value = today;

    // 绑定事件监听器
    if (diffStartEl) diffStartEl.addEventListener('change', calculateDateDiff);
    if (diffEndEl) diffEndEl.addEventListener('change', calculateDateDiff);

    if (addBaseEl) addBaseEl.addEventListener('change', calculateDateAdd);
    const addValueEl = document.getElementById('datecalc-add-value');
    const addUnitEl = document.getElementById('datecalc-add-unit');
    if (addValueEl) addValueEl.addEventListener('input', calculateDateAdd);
    if (addUnitEl) addUnitEl.addEventListener('change', calculateDateAdd);

    if (weekdayDateEl) weekdayDateEl.addEventListener('change', calculateWeekday);

    if (ageBirthEl) ageBirthEl.addEventListener('change', calculateAge);
    if (ageRefEl) ageRefEl.addEventListener('change', calculateAge);

    if (infoDateEl) infoDateEl.addEventListener('change', calculateDateInfo);

    // 初始计算
    calculateDateDiff();
    calculateDateAdd();
    calculateWeekday();
    calculateDateInfo();
}

function clearDateCalcTool() {
    const today = new Date().toISOString().split('T')[0];

    const elements = [
        'datecalc-diff-start', 'datecalc-diff-end',
        'datecalc-add-base', 'datecalc-weekday-date',
        'datecalc-age-birth', 'datecalc-age-ref',
        'datecalc-info-date'
    ];

    elements.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = id.includes('age-ref') ? '' : today;
    });

    const addValueEl = document.getElementById('datecalc-add-value');
    const addUnitEl = document.getElementById('datecalc-add-unit');
    if (addValueEl) addValueEl.value = '1';
    if (addUnitEl) addUnitEl.value = 'days';

    const resultElements = [
        'datecalc-diff-result', 'datecalc-add-result',
        'datecalc-weekday-result', 'datecalc-age-result',
        'datecalc-info-result'
    ];

    resultElements.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.innerHTML = '';
    });

    initDateCalcTool();
}

function calculateDateDiff() {
    const startEl = document.getElementById('datecalc-diff-start');
    const endEl = document.getElementById('datecalc-diff-end');
    const resultEl = document.getElementById('datecalc-diff-result');

    if (!startEl || !endEl || !resultEl) return;
    if (!window.DogToolboxM32Utils) {
        resultEl.innerHTML = '<div class="error-message">工具模块未加载</div>';
        return;
    }

    const start = startEl.value;
    const end = endEl.value;

    if (!start || !end) {
        resultEl.innerHTML = '';
        return;
    }

    try {
        const diff = DogToolboxM32Utils.dateDifference(start, end);

        resultEl.innerHTML = `
            <div class="datecalc-result-item">
                <strong>相差天数：</strong>${diff.totalDays} 天
            </div>
            <div class="datecalc-result-item">
                <strong>详细差值：</strong>${diff.years} 年 ${diff.months} 个月 ${diff.days} 天
            </div>
            <div class="datecalc-result-item">
                <strong>约：</strong>${Math.floor(diff.totalDays / 365)} 年 / ${Math.floor(diff.totalDays / 30)} 个月 / ${Math.floor(diff.totalDays / 7)} 周
            </div>
        `;
    } catch (e) {
        resultEl.innerHTML = `<div class="error-message">错误：${escapeHtml(e.message || String(e))}</div>`;
    }
}

function calculateDateAdd() {
    const baseEl = document.getElementById('datecalc-add-base');
    const valueEl = document.getElementById('datecalc-add-value');
    const unitEl = document.getElementById('datecalc-add-unit');
    const resultEl = document.getElementById('datecalc-add-result');

    if (!baseEl || !valueEl || !unitEl || !resultEl) return;
    if (!window.DogToolboxM32Utils) {
        resultEl.innerHTML = '<div class="error-message">工具模块未加载</div>';
        return;
    }

    const base = baseEl.value;
    const value = parseInt(valueEl.value || '0', 10);
    const unit = unitEl.value;

    if (!base) {
        resultEl.innerHTML = '';
        return;
    }

    try {
        const result = DogToolboxM32Utils.dateAdd(base, value, unit);
        const formatted = DogToolboxM32Utils.formatDate(result, 'YYYY-MM-DD');
        const weekday = DogToolboxM32Utils.getWeekday(result);

        resultEl.innerHTML = `
            <div class="datecalc-result-item">
                <strong>结果日期：</strong>${formatted}
            </div>
            <div class="datecalc-result-item">
                <strong>星期：</strong>${weekday.nameCn}
            </div>
        `;
    } catch (e) {
        resultEl.innerHTML = `<div class="error-message">错误：${escapeHtml(e.message || String(e))}</div>`;
    }
}

function calculateWeekday() {
    const dateEl = document.getElementById('datecalc-weekday-date');
    const resultEl = document.getElementById('datecalc-weekday-result');

    if (!dateEl || !resultEl) return;
    if (!window.DogToolboxM32Utils) {
        resultEl.innerHTML = '<div class="error-message">工具模块未加载</div>';
        return;
    }

    const date = dateEl.value;
    if (!date) {
        resultEl.innerHTML = '';
        return;
    }

    try {
        const weekday = DogToolboxM32Utils.getWeekday(date);
        const weekNum = DogToolboxM32Utils.getWeekNumber(date);

        resultEl.innerHTML = `
            <div class="datecalc-result-item">
                <strong>星期：</strong>${weekday.nameCn}（${weekday.nameEn}）
            </div>
            <div class="datecalc-result-item">
                <strong>ISO 周数：</strong>${weekNum.year} 年第 ${weekNum.isoWeek} 周
            </div>
            <div class="datecalc-result-item">
                <strong>月内周数：</strong>第 ${weekNum.weekOfMonth} 周
            </div>
        `;
    } catch (e) {
        resultEl.innerHTML = `<div class="error-message">错误：${escapeHtml(e.message || String(e))}</div>`;
    }
}

function calculateAge() {
    const birthEl = document.getElementById('datecalc-age-birth');
    const refEl = document.getElementById('datecalc-age-ref');
    const resultEl = document.getElementById('datecalc-age-result');

    if (!birthEl || !resultEl) return;
    if (!window.DogToolboxM32Utils) {
        resultEl.innerHTML = '<div class="error-message">工具模块未加载</div>';
        return;
    }

    const birth = birthEl.value;
    if (!birth) {
        resultEl.innerHTML = '';
        return;
    }

    try {
        const ref = refEl?.value || new Date().toISOString().split('T')[0];
        const age = DogToolboxM32Utils.calculateAge(birth, ref);

        resultEl.innerHTML = `
            <div class="datecalc-result-item">
                <strong>年龄：</strong>${age.description}
            </div>
            <div class="datecalc-result-item">
                <strong>总天数：</strong>${age.totalDays} 天
            </div>
            <div class="datecalc-result-item">
                <strong>约：</strong>${Math.floor(age.totalDays / 365)} 岁
            </div>
        `;
    } catch (e) {
        resultEl.innerHTML = `<div class="error-message">错误：${escapeHtml(e.message || String(e))}</div>`;
    }
}

function calculateDateInfo() {
    const dateEl = document.getElementById('datecalc-info-date');
    const resultEl = document.getElementById('datecalc-info-result');

    if (!dateEl || !resultEl) return;
    if (!window.DogToolboxM32Utils) {
        resultEl.innerHTML = '<div class="error-message">工具模块未加载</div>';
        return;
    }

    const date = dateEl.value;
    if (!date) {
        resultEl.innerHTML = '';
        return;
    }

    try {
        const d = DogToolboxM32Utils.parseDate(date);
        const year = d.getFullYear();
        const month = d.getMonth() + 1;
        const isLeap = DogToolboxM32Utils.isLeapYear(year);
        const daysInMonth = DogToolboxM32Utils.getDaysInMonth(year, month);
        const remaining = DogToolboxM32Utils.getRemainingDays(date);

        resultEl.innerHTML = `
            <div class="datecalc-result-item">
                <strong>年份：</strong>${year} 年${isLeap ? ' （闰年）' : ''}
            </div>
            <div class="datecalc-result-item">
                <strong>本月天数：</strong>${daysInMonth} 天
            </div>
            <div class="datecalc-result-item">
                <strong>本年天数：</strong>${remaining.daysInYear} 天
            </div>
            <div class="datecalc-result-item">
                <strong>距离月末：</strong>${remaining.daysRemainingInMonth} 天
            </div>
            <div class="datecalc-result-item">
                <strong>距离年末：</strong>${remaining.daysRemainingInYear} 天
            </div>
        `;
    } catch (e) {
        resultEl.innerHTML = `<div class="error-message">错误：${escapeHtml(e.message || String(e))}</div>`;
    }
}

// ==================== 工具箱：哈希（M4） ====================
function initHashTool() {
    const inputEl = document.getElementById('hash-input');
    if (!inputEl) return;
    // 兜底：即使页面使用了 inline handler，这里也做一次绑定，保证一致性
    inputEl.addEventListener('input', updateHashTool);
    document.getElementById('hash-salt')?.addEventListener('input', updateHashTool);
    document.getElementById('hash-batch')?.addEventListener('change', updateHashTool);
    document.getElementById('hash-algo')?.addEventListener('change', updateHashTool);
    document.getElementById('hash-use-salt')?.addEventListener('change', toggleHashSalt);
    toggleHashSalt();
    updateHashTool();
}

function toggleHashSalt() {
    const useSalt = !!document.getElementById('hash-use-salt')?.checked;
    const row = document.getElementById('hash-salt-row');
    if (row) row.style.display = useSalt ? '' : 'none';
    updateHashTool();
}

function updateHashTool() {
    const inputEl = document.getElementById('hash-input');
    const outputEl = document.getElementById('hash-output');
    const errorsEl = document.getElementById('hash-errors');
    const algoEl = document.getElementById('hash-algo');
    const batchEl = document.getElementById('hash-batch');
    const useSaltEl = document.getElementById('hash-use-salt');
    const saltEl = document.getElementById('hash-salt');
    if (!inputEl || !outputEl || !errorsEl || !algoEl) return;

    errorsEl.innerHTML = '';
    outputEl.value = '';

    if (!window.DogToolboxM4Utils) {
        errorsEl.innerHTML = '<div>⚠ 工具模块未加载：tools_m4_utils.js</div>';
        return;
    }

    const algorithm = String(algoEl.value || 'md5');
    const batch = !!batchEl?.checked;
    const useSalt = !!useSaltEl?.checked;
    const salt = useSalt ? String(saltEl?.value || '') : '';

    const text = inputEl.value ?? '';
    if (text.length === 0) return;

    try {
        const hashOne = (t) => window.DogToolboxM4Utils.hashHexUtf8(useSalt ? (t + salt) : t, algorithm);

        if (batch) {
            const lines = String(text).split(/\r?\n/);
            const outLines = lines.map(line => (line === '' ? '' : hashOne(line)));
            outputEl.value = outLines.join('\n');
        } else {
            outputEl.value = hashOne(String(text));
        }
    } catch (e) {
        outputEl.value = '';
        errorsEl.innerHTML = `<div>⚠ ${escapeHtml(e?.message || String(e))}</div>`;
    }
}

function clearHashTool() {
    const inputEl = document.getElementById('hash-input');
    const outputEl = document.getElementById('hash-output');
    const errorsEl = document.getElementById('hash-errors');
    const saltEl = document.getElementById('hash-salt');
    if (inputEl) inputEl.value = '';
    if (outputEl) outputEl.value = '';
    if (errorsEl) errorsEl.innerHTML = '';
    if (saltEl) saltEl.value = '';
    updateHashTool();
}

function copyHashOutput(btn) {
    const outputEl = document.getElementById('hash-output');
    const text = outputEl?.value || '';
    copyToolText(btn, text);
}

// ==================== 工具箱：对称加密（M5） ====================
function initCryptoTool() {
    const inputEl = document.getElementById('crypto-input');
    if (!inputEl) return;
    // 默认：加密 + 高级
    setCryptoMode('encrypt', false);
    setCryptoLevel('advanced', false);
    updateCryptoToolUi();
}

function setCryptoMode(mode, clearOutput = true) {
    if (mode !== 'encrypt' && mode !== 'decrypt') return;
    cryptoMode = mode;
    document.getElementById('crypto-encrypt-btn')?.classList.toggle('active', cryptoMode === 'encrypt');
    document.getElementById('crypto-decrypt-btn')?.classList.toggle('active', cryptoMode === 'decrypt');
    if (clearOutput) {
        const out = document.getElementById('crypto-output');
        const err = document.getElementById('crypto-errors');
        if (out) out.value = '';
        if (err) err.innerHTML = '';
    }
    updateCryptoToolUi();
}

function setCryptoLevel(level, clearOutput = false) {
    if (level !== 'advanced' && level !== 'simple') return;
    cryptoLevel = level;
    document.getElementById('crypto-advanced-btn')?.classList.toggle('active', cryptoLevel === 'advanced');
    document.getElementById('crypto-simple-btn')?.classList.toggle('active', cryptoLevel === 'simple');
    if (clearOutput) {
        const out = document.getElementById('crypto-output');
        const err = document.getElementById('crypto-errors');
        if (out) out.value = '';
        if (err) err.innerHTML = '';
    }
    updateCryptoToolUi();
}

function detectCipherFormatAuto(text) {
    const t = String(text ?? '').trim().replace(/\s+/g, '');
    if (!t) return 'base64';
    if (t.length % 2 === 0 && /^[0-9a-fA-F]+$/.test(t)) return 'hex';
    return 'base64';
}

function updateCryptoToolUi() {
    const algoEl = document.getElementById('crypto-algo');
    const aesKeysizeEl = document.getElementById('crypto-aes-keysize');
    const modeEl = document.getElementById('crypto-mode');
    const paddingEl = document.getElementById('crypto-padding');
    const ivGroup = document.getElementById('crypto-iv-group');
    const autoKeyEl = document.getElementById('crypto-auto-key');
    const keyHintEl = document.getElementById('crypto-key-hint');

    const inputHeader = document.getElementById('crypto-input-header');
    const outputHeader = document.getElementById('crypto-output-header');
    const inputWrap = document.getElementById('crypto-input-format-wrap');
    const outputWrap = document.getElementById('crypto-output-format-wrap');
    const inputEl = document.getElementById('crypto-input');
    const outputEl = document.getElementById('crypto-output');
    if (!algoEl || !aesKeysizeEl || !autoKeyEl || !keyHintEl || !inputEl || !outputEl) return;

    const algo = String(algoEl.value || 'aes');
    const isAes = algo === 'aes';
    aesKeysizeEl.style.display = isAes ? '' : 'none';

    // 简单模式：隐藏 mode/padding/iv（但保留 key 与自动调整）
    if (cryptoLevel === 'simple') {
        modeEl && (modeEl.style.display = 'none');
        paddingEl && (paddingEl.style.display = 'none');
        if (ivGroup) ivGroup.style.display = 'none';
        document.getElementById('crypto-advanced-options')?.classList.remove('crypto-advanced-only');
    } else {
        modeEl && (modeEl.style.display = '');
        paddingEl && (paddingEl.style.display = '');
        if (ivGroup) ivGroup.style.display = '';
        document.getElementById('crypto-advanced-options')?.classList.remove('crypto-advanced-only');
    }

    // 加密/解密：控制格式下拉与文案
    const outFormat = document.getElementById('crypto-output-format');
    const inFormat = document.getElementById('crypto-input-format');
    if (cryptoMode === 'encrypt') {
        if (inputWrap) inputWrap.style.display = 'none';
        if (outputWrap) outputWrap.style.display = '';
        if (inputHeader) inputHeader.textContent = '输入（明文）';
        if (outputHeader) outputHeader.textContent = '输出（密文）';
        inputEl.placeholder = '输入明文（UTF-8）...';
        outputEl.placeholder = '输出密文（Base64/Hex）...';
        // 默认 Base64
        if (outFormat && (outFormat.value !== 'base64' && outFormat.value !== 'hex')) outFormat.value = 'base64';
    } else {
        if (inputWrap) inputWrap.style.display = '';
        if (outputWrap) outputWrap.style.display = 'none';
        if (inputHeader) inputHeader.textContent = '输入（密文）';
        if (outputHeader) outputHeader.textContent = '输出（明文）';
        inputEl.placeholder = '输入密文（Base64/Hex）...';
        outputEl.placeholder = '输出明文（UTF-8）...';
        if (inFormat && !['auto', 'base64', 'hex'].includes(inFormat.value)) inFormat.value = 'auto';
    }

    // key 长度提示
    const autoAdjust = !!autoKeyEl.checked;
    let targetLen = 16;
    if (isAes) {
        const bits = parseInt(String(aesKeysizeEl.value || '128'), 10);
        targetLen = bits === 256 ? 32 : 16;
    } else {
        targetLen = 8;
    }
    keyHintEl.textContent = autoAdjust
        ? `目标 key 长度：${targetLen} 字节（不足右补 0x00，超出截断）`
        : `严格 key 长度：必须为 ${targetLen} 字节（UTF-8）`;
}

function runCryptoTool() {
    const inputEl = document.getElementById('crypto-input');
    const outputEl = document.getElementById('crypto-output');
    const errorsEl = document.getElementById('crypto-errors');
    const algoEl = document.getElementById('crypto-algo');
    const aesKeysizeEl = document.getElementById('crypto-aes-keysize');
    const keyEl = document.getElementById('crypto-key');
    const autoKeyEl = document.getElementById('crypto-auto-key');
    const outFormatEl = document.getElementById('crypto-output-format');
    const inFormatEl = document.getElementById('crypto-input-format');
    if (!inputEl || !outputEl || !errorsEl || !algoEl || !aesKeysizeEl || !keyEl || !autoKeyEl) return;

    errorsEl.innerHTML = '';
    outputEl.value = '';

    if (!window.DogToolboxM5Utils) {
        errorsEl.innerHTML = '<div>⚠ 工具模块未加载：tools_m5_utils.js</div>';
        return;
    }

    const algo = String(algoEl.value || 'aes');
    const isAes = algo === 'aes';
    const autoAdjust = !!autoKeyEl.checked;
    const keyText = String(keyEl.value || '');

    try {
        if (cryptoMode === 'encrypt') {
            const plainText = String(inputEl.value ?? '');
            if (plainText.length === 0) return;

            const keyLen = isAes ? ((parseInt(String(aesKeysizeEl.value || '128'), 10) === 256) ? 32 : 16) : 8;
            const keyBytes = window.DogToolboxM5Utils.adjustKeyUtf8(keyText, keyLen, autoAdjust);
            const plainBytes = window.DogToolboxM5Utils.utf8ToBytes(plainText);
            const cipherBytes = isAes
                ? window.DogToolboxM5Utils.aesEcbEncrypt(plainBytes, keyBytes)
                : window.DogToolboxM5Utils.desEcbEncrypt(plainBytes, keyBytes);

            const outFmt = String(outFormatEl?.value || 'base64');
            outputEl.value = outFmt === 'hex'
                ? window.DogToolboxM5Utils.bytesToHex(cipherBytes)
                : window.DogToolboxM5Utils.base64EncodeBytes(cipherBytes);
        } else {
            const cipherText = String(inputEl.value ?? '');
            if (cipherText.trim().length === 0) return;

            const keyLen = isAes ? ((parseInt(String(aesKeysizeEl.value || '128'), 10) === 256) ? 32 : 16) : 8;
            const keyBytes = window.DogToolboxM5Utils.adjustKeyUtf8(keyText, keyLen, autoAdjust);

            const fmt = String(inFormatEl?.value || 'auto');
            const resolved = fmt === 'auto' ? detectCipherFormatAuto(cipherText) : fmt;
            const cipherBytes = resolved === 'hex'
                ? window.DogToolboxM5Utils.hexToBytes(cipherText)
                : window.DogToolboxM5Utils.base64DecodeToBytes(cipherText);

            const plainBytes = isAes
                ? window.DogToolboxM5Utils.aesEcbDecrypt(cipherBytes, keyBytes)
                : window.DogToolboxM5Utils.desEcbDecrypt(cipherBytes, keyBytes);
            outputEl.value = window.DogToolboxM5Utils.bytesToUtf8(plainBytes);
        }
    } catch (e) {
        outputEl.value = '';
        errorsEl.innerHTML = `<div>⚠ ${escapeHtml(e?.message || String(e))}</div>`;
    }
}

function clearCryptoTool() {
    const inputEl = document.getElementById('crypto-input');
    const outputEl = document.getElementById('crypto-output');
    const errorsEl = document.getElementById('crypto-errors');
    const keyEl = document.getElementById('crypto-key');
    if (inputEl) inputEl.value = '';
    if (outputEl) outputEl.value = '';
    if (errorsEl) errorsEl.innerHTML = '';
    if (keyEl) keyEl.value = '';
    updateCryptoToolUi();
}

function copyCryptoOutput(btn) {
    const outputEl = document.getElementById('crypto-output');
    const text = outputEl?.value || '';
    copyToolText(btn, text);
}

// ==================== 工具箱：文本对比（M6） ====================
function initDiffTool() {
    const leftEl = document.getElementById('diff-left');
    const rightEl = document.getElementById('diff-right');
    if (!leftEl || !rightEl) return;

    leftEl.addEventListener('input', scheduleDiffUpdate);
    rightEl.addEventListener('input', scheduleDiffUpdate);

    setDiffDirection('ltr', false);
    updateDiffToolUi();
    toggleDiffWrap();
    scheduleDiffUpdate();
}

function scheduleDiffUpdate() {
    if (diffUpdateTimerId) clearTimeout(diffUpdateTimerId);
    diffUpdateTimerId = setTimeout(() => {
        diffUpdateTimerId = null;
        updateDiffTool();
    }, 150);
}

function updateDiffToolUi() {
    const modeEl = document.getElementById('diff-mode');
    const formatBtn = document.getElementById('diff-format-btn');
    if (!modeEl) return;
    const mode = String(modeEl.value || 'text');
    if (formatBtn) formatBtn.style.display = mode === 'json' ? '' : 'none';
    scheduleDiffUpdate();
}

function toggleDiffWrap() {
    const wrapEl = document.getElementById('diff-wrap');
    const viewEl = document.getElementById('diff-view');
    if (!wrapEl || !viewEl) return;
    const enabled = !!wrapEl.checked;
    viewEl.classList.toggle('diff-wrap', enabled);
}

function setDiffDirection(direction, schedule = true) {
    if (direction !== 'ltr' && direction !== 'rtl') return;
    diffDirection = direction;
    document.getElementById('diff-ltr-btn')?.classList.toggle('active', diffDirection === 'ltr');
    document.getElementById('diff-rtl-btn')?.classList.toggle('active', diffDirection === 'rtl');

    const applyBtn = document.getElementById('diff-apply-btn');
    if (applyBtn) {
        applyBtn.textContent = diffDirection === 'ltr' ? '应用到右侧' : '应用到左侧';
    }
    if (schedule) scheduleDiffUpdate();
}

function applyDiffDirection() {
    const leftEl = document.getElementById('diff-left');
    const rightEl = document.getElementById('diff-right');
    if (!leftEl || !rightEl) return;
    if (diffDirection === 'ltr') {
        rightEl.value = leftEl.value;
    } else {
        leftEl.value = rightEl.value;
    }
    scheduleDiffUpdate();
}

function formatDiffJson() {
    const modeEl = document.getElementById('diff-mode');
    const leftEl = document.getElementById('diff-left');
    const rightEl = document.getElementById('diff-right');
    const errLeft = document.getElementById('diff-errors-left');
    const errRight = document.getElementById('diff-errors-right');
    if (!modeEl || !leftEl || !rightEl) return;
    if (String(modeEl.value || 'text') !== 'json') return;

    if (errLeft) errLeft.innerHTML = '';
    if (errRight) errRight.innerHTML = '';

    try {
        if (!window.DogToolboxM6Utils) {
            throw new Error('工具模块未加载：tools_m6_utils.js');
        }
        const l = leftEl.value ?? '';
        const r = rightEl.value ?? '';
        if (l.trim()) {
            try {
                leftEl.value = window.DogToolboxM6Utils.formatJson(l);
            } catch (e) {
                if (errLeft) errLeft.innerHTML = `<div>⚠ ${escapeHtml(e?.message || String(e))}</div>`;
            }
        }
        if (r.trim()) {
            try {
                rightEl.value = window.DogToolboxM6Utils.formatJson(r);
            } catch (e) {
                if (errRight) errRight.innerHTML = `<div>⚠ ${escapeHtml(e?.message || String(e))}</div>`;
            }
        }
        scheduleDiffUpdate();
    } catch (e) {
        if (errLeft) errLeft.innerHTML = `<div>⚠ ${escapeHtml(e?.message || String(e))}</div>`;
    }
}

function buildCharDiffHtml(leftText, rightText) {
    const left = String(leftText ?? '');
    const right = String(rightText ?? '');
    if (!window.DogToolboxM6Utils || typeof window.DogToolboxM6Utils.myersDiff !== 'function') {
        return { leftHtml: escapeHtml(left), rightHtml: escapeHtml(right) };
    }

    const leftChars = Array.from(left);
    const rightChars = Array.from(right);
    const maxChars = 2000;
    if (leftChars.length + rightChars.length > maxChars) {
        return buildSimpleDiffHtml(left, right);
    }

    const ops = window.DogToolboxM6Utils.myersDiff(leftChars, rightChars) || [];
    const leftSegs = [];
    const rightSegs = [];

    const pushSeg = (arr, type, text) => {
        if (!text) return;
        const last = arr.length ? arr[arr.length - 1] : null;
        if (last && last.type === type) last.text += text;
        else arr.push({ type, text });
    };

    for (const op of ops) {
        if (op.type === 'equal') {
            pushSeg(leftSegs, 'equal', op.value);
            pushSeg(rightSegs, 'equal', op.value);
        } else if (op.type === 'delete') {
            pushSeg(leftSegs, 'delete', op.value);
        } else if (op.type === 'insert') {
            pushSeg(rightSegs, 'insert', op.value);
        }
    }

    const segsToHtml = (segs) => segs.map(s => {
        const safe = escapeHtml(s.text);
        if (s.type === 'equal') return safe;
        if (s.type === 'delete') return `<span class="diff-inline diff-inline-del">${safe}</span>`;
        if (s.type === 'insert') return `<span class="diff-inline diff-inline-ins">${safe}</span>`;
        return safe;
    }).join('');

    return { leftHtml: segsToHtml(leftSegs), rightHtml: segsToHtml(rightSegs) };
}

function buildSimpleDiffHtml(left, right) {
    const a = String(left ?? '');
    const b = String(right ?? '');
    const aChars = Array.from(a);
    const bChars = Array.from(b);
    let prefix = 0;
    while (prefix < aChars.length && prefix < bChars.length && aChars[prefix] === bChars[prefix]) {
        prefix++;
    }
    let suffix = 0;
    while (
        suffix < (aChars.length - prefix)
        && suffix < (bChars.length - prefix)
        && aChars[aChars.length - 1 - suffix] === bChars[bChars.length - 1 - suffix]
    ) {
        suffix++;
    }
    const leftPrefix = aChars.slice(0, prefix).join('');
    const rightPrefix = bChars.slice(0, prefix).join('');
    const leftMid = aChars.slice(prefix, aChars.length - suffix).join('');
    const rightMid = bChars.slice(prefix, bChars.length - suffix).join('');
    const leftSuffix = aChars.slice(aChars.length - suffix).join('');
    const rightSuffix = bChars.slice(bChars.length - suffix).join('');

    const leftHtml = escapeHtml(leftPrefix)
        + (leftMid ? `<span class="diff-inline diff-inline-del">${escapeHtml(leftMid)}</span>` : '')
        + escapeHtml(leftSuffix);
    const rightHtml = escapeHtml(rightPrefix)
        + (rightMid ? `<span class="diff-inline diff-inline-ins">${escapeHtml(rightMid)}</span>` : '')
        + escapeHtml(rightSuffix);

    return { leftHtml, rightHtml };
}

function clearDiffTool() {
    const leftEl = document.getElementById('diff-left');
    const rightEl = document.getElementById('diff-right');
    const viewEl = document.getElementById('diff-view');
    if (leftEl) leftEl.value = '';
    if (rightEl) rightEl.value = '';
    if (viewEl) viewEl.innerHTML = '';
    document.getElementById('diff-errors-left') && (document.getElementById('diff-errors-left').innerHTML = '');
    document.getElementById('diff-errors-right') && (document.getElementById('diff-errors-right').innerHTML = '');
    scheduleDiffUpdate();
}

function updateDiffTool() {
    const modeEl = document.getElementById('diff-mode');
    const leftEl = document.getElementById('diff-left');
    const rightEl = document.getElementById('diff-right');
    const viewEl = document.getElementById('diff-view');
    const errLeft = document.getElementById('diff-errors-left');
    const errRight = document.getElementById('diff-errors-right');
    if (!modeEl || !leftEl || !rightEl || !viewEl) return;

    if (errLeft) errLeft.innerHTML = '';
    if (errRight) errRight.innerHTML = '';

    if (!window.DogToolboxM6Utils) {
        viewEl.innerHTML = '<div style="padding:12px">⚠ 工具模块未加载：tools_m6_utils.js</div>';
        return;
    }

    const mode = String(modeEl.value || 'text');
    const leftTextRaw = String(leftEl.value ?? '');
    const rightTextRaw = String(rightEl.value ?? '');

    let leftForDiff = leftTextRaw;
    let rightForDiff = rightTextRaw;

    if (mode === 'json') {
        let leftOk = true;
        let rightOk = true;
        if (leftTextRaw.trim()) {
            try {
                leftForDiff = window.DogToolboxM6Utils.formatJson(leftTextRaw);
            } catch (e) {
                leftOk = false;
                if (errLeft) errLeft.innerHTML = `<div>⚠ ${escapeHtml(e?.message || String(e))}</div>`;
            }
        }
        if (rightTextRaw.trim()) {
            try {
                rightForDiff = window.DogToolboxM6Utils.formatJson(rightTextRaw);
            } catch (e) {
                rightOk = false;
                if (errRight) errRight.innerHTML = `<div>⚠ ${escapeHtml(e?.message || String(e))}</div>`;
            }
        }
        // 任意一侧 JSON 非法时，仍然回退到原文对比，避免完全不可用
        if (!leftOk || !rightOk) {
            leftForDiff = leftTextRaw;
            rightForDiff = rightTextRaw;
        }
    }

    const result = window.DogToolboxM6Utils.buildSideBySideDiff(leftForDiff, rightForDiff);
    const rows = result?.rows || [];

    const head = `
        <div class="diff-head">
            <div class="diff-cell diff-ln">L</div>
            <div class="diff-cell">左侧</div>
            <div class="diff-cell diff-ln">R</div>
            <div class="diff-cell">右侧</div>
        </div>`;

    const body = rows.map(r => {
        const cls = r.type === 'equal' ? 'diff-equal' : (r.type === 'insert' ? 'diff-insert' : (r.type === 'delete' ? 'diff-delete' : 'diff-change'));
        const leftNo = r.leftNo === null ? '' : String(r.leftNo);
        const rightNo = r.rightNo === null ? '' : String(r.rightNo);
        let leftText = '';
        let rightText = '';
        if (r.type === 'change') {
            const d = buildCharDiffHtml(r.left || '', r.right || '');
            leftText = d.leftHtml;
            rightText = d.rightHtml;
        } else {
            if (r.left !== null) {
                leftText = (r.type === 'delete')
                    ? `<span class="diff-inline diff-inline-del">${escapeHtml(r.left)}</span>`
                    : escapeHtml(r.left);
            }
            if (r.right !== null) {
                rightText = (r.type === 'insert')
                    ? `<span class="diff-inline diff-inline-ins">${escapeHtml(r.right)}</span>`
                    : escapeHtml(r.right);
            }
        }
        const leftEmpty = r.left === null ? 'diff-empty' : '';
        const rightEmpty = r.right === null ? 'diff-empty' : '';
        return `
            <div class="diff-row ${cls}">
                <div class="diff-cell diff-ln">${leftNo}</div>
                <div class="diff-cell diff-text diff-left ${leftEmpty}">${leftText}</div>
                <div class="diff-cell diff-ln">${rightNo}</div>
                <div class="diff-cell diff-text diff-right ${rightEmpty}">${rightText}</div>
            </div>`;
    }).join('');

    viewEl.innerHTML = head + body;
}

// ==================== 工具箱：Base64 ↔ Hex（M7） ====================
function initB64HexTool() {
    const inputEl = document.getElementById('b64hex-input');
    if (!inputEl) return;
    inputEl.addEventListener('input', updateB64HexTool);
    document.getElementById('b64hex-batch')?.addEventListener('change', updateB64HexTool);
    // 默认 Base64→Hex
    setB64HexMode('b64_to_hex');
}

function setB64HexMode(mode) {
    if (mode !== 'b64_to_hex' && mode !== 'hex_to_b64') return;
    b64HexMode = mode;
    document.getElementById('b64hex-b2h-btn')?.classList.toggle('active', b64HexMode === 'b64_to_hex');
    document.getElementById('b64hex-h2b-btn')?.classList.toggle('active', b64HexMode === 'hex_to_b64');
    updateB64HexTool();
}

function updateB64HexTool() {
    const inputEl = document.getElementById('b64hex-input');
    const outputEl = document.getElementById('b64hex-output');
    const errorsEl = document.getElementById('b64hex-errors');
    const batchEl = document.getElementById('b64hex-batch');
    if (!inputEl || !outputEl || !errorsEl) return;

    errorsEl.innerHTML = '';
    outputEl.value = '';

    const inputText = String(inputEl.value ?? '');
    if (inputText.trim().length === 0) return;

    if (!window.DogToolboxM7Utils) {
        errorsEl.innerHTML = '<div>⚠ 工具模块未加载：tools_m7_utils.js</div>';
        return;
    }

    const batch = !!batchEl?.checked;

    try {
        const convertOne = (s) => {
            if (b64HexMode === 'b64_to_hex') return window.DogToolboxM7Utils.base64ToHex(s);
            return window.DogToolboxM7Utils.hexToBase64(s);
        };

        if (batch) {
            const lines = inputText.split(/\r?\n/);
            const outLines = [];
            for (let i = 0; i < lines.length; i++) {
                const line = lines[i];
                if (line === '') {
                    outLines.push('');
                    continue;
                }
                try {
                    outLines.push(convertOne(line));
                } catch (e) {
                    throw new Error(`第 ${i + 1} 行：${e?.message || String(e)}`);
                }
            }
            outputEl.value = outLines.join('\n');
        } else {
            outputEl.value = convertOne(inputText);
        }
    } catch (e) {
        outputEl.value = '';
        errorsEl.innerHTML = `<div>⚠ ${escapeHtml(e?.message || String(e))}</div>`;
    }
}

function clearB64HexTool() {
    const inputEl = document.getElementById('b64hex-input');
    const outputEl = document.getElementById('b64hex-output');
    const errorsEl = document.getElementById('b64hex-errors');
    if (inputEl) inputEl.value = '';
    if (outputEl) outputEl.value = '';
    if (errorsEl) errorsEl.innerHTML = '';
}

function copyB64HexOutput(btn) {
    const outputEl = document.getElementById('b64hex-output');
    const text = outputEl?.value || '';
    copyToolText(btn, text);
}

function copyToolText(btn, text, options = {}) {
    if (!text) return;

    const {
        showTextFeedback = false,  // 是否显示文字反馈
        successText = '✓ 已复制',   // 成功时的文字
        duration = 2000             // 反馈持续时间
    } = options;

    copyToClipboard(text).then(() => {
        if (btn) {
            if (showTextFeedback) {
                // 新模式：修改按钮文字
                const originalText = btn.textContent;
                btn.textContent = successText;
                btn.classList.add('btn-success');
                setTimeout(() => {
                    btn.textContent = originalText;
                    btn.classList.remove('btn-success');
                }, duration);
            } else {
                // 旧模式：添加 CSS 类
                btn.classList.add('copied');
                setTimeout(() => btn.classList.remove('copied'), 1000);
            }
        }
    });
}

