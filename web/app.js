/*
==================== 性能瓶颈与优化建议（文档区，不影响运行逻辑） ====================

现状（以当前仓库文件为准）：
- web/index.html 约 3663 行，且包含 30+ 工具脚本标签，集中在文档末尾加载。
- web/app.js 约 6310 行，DOMContentLoaded 内串行调用 40+ 初始化函数。
- waitForPywebview() 在"非 pywebview 环境"会最多等待 5 秒，导致首屏白等。
- HTML 内嵌所有工具页面：DOM 体积大、样式/布局计算重、首次解析时间长。

🔧 懒初始化（非关键工具）策略（推荐落地顺序）：
1) 定义"关键初始化"仅保留：导航、主题、当前页（默认 credentials）所需的最小渲染与数据加载。
2) 为工具页建立 PAGE_INIT_MAP：page -> initXxxTool()，在首次进入页面时才调用（只执行一次）。
3) 对"进入即更新"的逻辑（如 updateJwtTool / updateTimeTool）保持在 handlePageEnter()；
   但确保其依赖的 initXxxTool() 已在进入前执行（ensurePageInitialized(page)）。
4) 把"可延后"的初始化放到空闲期：
   - requestIdleCallback(fn, {timeout: 1000})，并用 setTimeout(fn, 0) 兜底（兼容性）。
   - 对事件监听器密集的工具，首次进入再绑定，避免抢占首屏主线程。

🚀 模块加载优化建议（从易到难）：
1) 统一改用 defer（本补丁已给出），保证脚本不阻塞 HTML 解析。
2) 合并/打包 tools_m*_utils.js（Vite/Rollup/esbuild），减少请求与解析开销；开启压缩与 tree-shaking。
3) 迁移为 ESM：index.html 只保留 app.js（type="module"），工具模块通过 import() 动态加载并按页分包。
4) CDN 依赖（js-yaml/fast-xml-parser）：
   - 若运行环境允许外网：按需加载（首次使用该工具再加载）；
   - 若外网不稳定/离线：本地化 vendor 并打包进构建产物，避免首屏卡在网络。
5) 页面拆分：将各工具页面抽成 <template> 或独立片段文件，首次访问 fetch 注入并缓存，降低初始 DOM 体积。
*/

// ==================== 模块加载错误边界 ====================

// 页面到模块的映射表
const PAGE_MODULE_MAP = {
    'tool-base64': 'DogToolboxM2Utils',
    'tool-jwt': 'DogToolboxM3Utils',
    'tool-time': 'DogToolboxM4Utils',
    'tool-hash': 'DogToolboxM5Utils',
    'tool-crypto': 'DogToolboxM6Utils',
    'tool-diff': 'DogToolboxM7Utils',
    'tool-b64hex': 'DogToolboxM8Utils',
    'tool-url': 'DogToolboxM9Utils',
    'tool-radix': 'DogToolboxM10Utils',
    'tool-charcount': 'DogToolboxM11Utils',
    'tool-password': 'DogToolboxM12Utils',
    'tool-json': 'DogToolboxM13Utils',
    'tool-dataconvert': 'DogToolboxM14Utils',
    'tool-text': 'DogToolboxM15Utils',
    'tool-regex': 'DogToolboxM16Utils',
    'tool-curl': 'DogToolboxM18Utils',
    'tool-color': 'DogToolboxM18Utils',
    'tool-ip': 'DogToolboxM18Utils',
    'tool-cron': 'DogToolboxM18Utils',
    'tool-sql': 'DogToolboxM18Utils',
    'tool-unicode': 'DogToolboxM19Utils',
    'tool-rsa': 'DogToolboxM20Utils',
    'tool-hmac': 'DogToolboxM21Utils',
    'tool-markdown': 'DogToolboxM22Utils',
    'tool-csv': 'DogToolboxM23Utils',
    'tool-git': 'DogToolboxM26Utils',
    'tool-docker': 'DogToolboxM27Utils',
    'tool-json-schema': 'DogToolboxM28Utils',
    'tool-http': 'DogToolboxM24Utils',
    'tool-websocket': 'DogToolboxM25Utils',
    'tool-mock': 'DogToolboxM29Utils',
    'tool-desensitize': 'DogToolboxM30Utils',
    'tool-mask': 'DogToolboxM30Utils',
    'tool-table-json': 'DogToolboxM31Utils',
    'tool-datecalc': 'DogToolboxM32Utils'
};

// 检测模块加载情况
function checkModuleLoading() {
    const failedModules = new Set();
    const failedPages = [];

    // 检查所有模块
    for (const [page, moduleName] of Object.entries(PAGE_MODULE_MAP)) {
        if (!window[moduleName]) {
            failedModules.add(moduleName);
            failedPages.push(page);
        }
    }

    // 如果有模块加载失败，显示错误横幅并禁用工具
    if (failedModules.size > 0) {
        showErrorBanner(failedModules, failedPages);
        disableFailedTools(failedPages);
    }
}

// 显示错误横幅
function showErrorBanner(failedModules, failedPages) {
    const banner = document.getElementById('global-error-banner');
    const textEl = document.getElementById('error-banner-text');

    if (!banner || !textEl) return;

    // 安全转义模块名（虽然是代码常量，但保持防御性编程）
    const moduleList = Array.from(failedModules)
        .map(m => escapeHtml(m))
        .join(', ');
    const pageCount = failedPages.length;

    textEl.innerHTML = `
        <strong>${failedModules.size} 个工具模块</strong>加载失败，
        <strong>${pageCount} 个工具</strong>无法使用。
        受影响模块：${moduleList}。
        <br>请刷新页面重试，或检查网络连接。
    `;

    banner.style.display = 'block';
}

// 禁用加载失败的工具页面
function disableFailedTools(failedPages) {
    failedPages.forEach(page => {
        const pageEl = document.getElementById(`page-${page}`);
        if (pageEl) {
            pageEl.classList.add('tool-disabled');
        }

        // 同时禁用导航项的点击
        const navItem = document.querySelector(`.nav-item[data-page="${page}"]`);
        if (navItem) {
            navItem.style.opacity = '0.5';
            navItem.style.cursor = 'not-allowed';
            navItem.title = '此工具的核心模块加载失败';
        }
    });
}

// 关闭错误横幅
function closeErrorBanner() {
    const banner = document.getElementById('global-error-banner');
    if (banner) {
        banner.style.display = 'none';
    }
}

// 启动加载遮罩：在关键初始化完成后关闭
function hideAppLoading() {
    // 加载动画已移除，保留函数以兼容调用
    document.documentElement.classList.remove('is-booting');
}

// ==================== 窗口控制 ====================
let _pywebviewReady = false;

function windowClose() {
    if (_pywebviewReady) pywebview.api.window_close();
}

function windowMinimize() {
    if (_pywebviewReady) pywebview.api.window_minimize();
}

function windowMaximize() {
    if (_pywebviewReady) pywebview.api.window_toggle_fullscreen();
}

// ==================== 原有全局状态 ====================

// 全局状态
let allCredentials = [];
let allCommands = [];
let allTabs = [];
let currentTabId = null;
let convertedNodes = [];
let expandedCredentialIds = new Set(); // 凭证附加信息展开状态
let convertOutputFormat = 'yaml'; // 节点转换输出格式：yaml/json
let lastConvertedYaml = '';
let lastConvertedJson = '';
let base64Mode = 'encode'; // Base64 工具模式：encode/decode
let b64HexMode = 'b64_to_hex'; // Base64↔Hex 工具模式：b64_to_hex/hex_to_b64
let activePage = null; // 当前激活页面（page-xxx 的 xxx）
let timeNowIntervalId = null; // 时间戳工具：实时刷新定时器
let cryptoMode = 'encrypt'; // 对称加密工具：encrypt/decrypt
let cryptoLevel = 'advanced'; // 对称加密工具：advanced/simple
let diffDirection = 'ltr'; // 文本对比方向：ltr/rtl
let diffUpdateTimerId = null; // 文本对比：防抖更新
let urlMode = 'encode'; // URL 编解码模式：encode/decode

// 页面懒初始化：按需初始化工具页，避免启动时初始化全部工具
const PAGE_INIT_MAP = Object.freeze({
    'tool-base64': initBase64Tool,
    'tool-uuid': initUuidTool,
    'tool-hash': initHashTool,
    'tool-crypto': initCryptoTool,
    'tool-b64hex': initB64HexTool,
    'tool-diff': initDiffTool,
    'tool-jwt': initJwtTool,
    'tool-time': initTimeTool,
    'tool-naming': initNamingTool,
    'tool-url': initUrlTool,
    'tool-radix': initRadixTool,
    'tool-unicode': initUnicodeTool,
    'tool-charcount': initCharCountTool,
    'tool-password': initPasswordTool,
    'tool-hmac': initHmacTool,
    'tool-rsa': initRsaTool,
    'tool-json': initJsonTool,
    'tool-data-convert': initDataConvertTool,
    'tool-table-json': initTableJsonTool,
    'tool-text': initTextTool,
    'tool-regex': initRegexTool,
    'tool-curl': initCurlTool,
    'tool-color': initColorTool,
    'tool-ip': initIpTool,
    'tool-cron': initCronTool,
    'tool-sql': initSqlTool,
    'tool-csv': initCsvTool,
    'tool-markdown': initMarkdownTool,
    'tool-datecalc': initDateCalcTool,
    'tool-git': initGitTool,
    'tool-docker': initDockerTool,
    'tool-json-schema': initJsonSchemaTool,
    'tool-http': initHttpTool,
    'tool-websocket': initWebSocketTool,
    'tool-mock': initMockTool,
    'tool-mask': initMaskTool,
    'tool-qrcode': initQrcodeTool,
});

const initializedPages = new Set();
const initializingPages = new Map();

async function ensurePageInitialized(page) {
    const initFn = PAGE_INIT_MAP[page];
    if (!initFn) return;
    if (initializedPages.has(page)) return;

    const pending = initializingPages.get(page);
    if (pending) return pending;

    const task = (async () => {
        try {
            await initFn();
            initializedPages.add(page);
        } finally {
            initializingPages.delete(page);
        }
    })();

    initializingPages.set(page, task);
    return task;
}

// 初始化
document.addEventListener('DOMContentLoaded', async () => {
    try {
        // 🔴 首先检测模块加载情况（错误边界）
        checkModuleLoading();

        // 🎨 关键：先让浏览器绘制一次,确保加载动画可见
        await new Promise(resolve => requestAnimationFrame(resolve));

        await waitForPywebview();
        initNavigation();
        initTheme();
        await initGlassMode();
        initConverterOutput();
        // 工具页懒初始化：移除所有 initXxxTool() 调用，在 handlePageEnter 中按需初始化
        loadCredentials();
        await loadTabs();
        loadCommands();
        loadNodes();

        // 记录初始激活页面，处理页面进入逻辑（避免仅依赖点击导航）
        const initial = document.querySelector('.page.active')?.id?.replace(/^page-/, '');
        activePage = initial || 'credentials';
        await handlePageEnter(activePage);
    } finally {
        hideAppLoading();
    }
});

function waitForPywebview() {
    return new Promise(resolve => {
        if (window.pywebview && window.pywebview.api) {
            _pywebviewReady = true;
            resolve();
        } else {
            // 添加超时机制，最多等待 5 秒
            const timeout = setTimeout(() => {
                console.warn('pywebview 初始化超时，继续加载页面');
                resolve();
            }, 5000);

            window.addEventListener('pywebviewready', () => {
                clearTimeout(timeout);
                _pywebviewReady = true;
                resolve();
            });
        }
    });
}

// 导航
function initNavigation() {
    // 叶子页面：点击切换页面
    document.querySelectorAll('.nav-item[data-page]').forEach(item => {
        item.addEventListener('click', () => {
            switchPage(item.dataset.page);
        });
    });

    // 分组：点击展开/收起
    document.querySelectorAll('.nav-group-header').forEach(header => {
        header.addEventListener('click', () => {
            const group = header.closest('.nav-group');
            if (!group) return;
            const willExpand = !group.classList.contains('expanded');
            group.classList.toggle('expanded', willExpand);
            header.setAttribute('aria-expanded', String(willExpand));
        });
        header.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                header.click();
            }
        });
    });
}

function switchPage(page) {
    if (!page) return;
    const target = document.getElementById(`page-${page}`);
    if (!target) return;

    if (activePage && activePage !== page) {
        handlePageLeave(activePage);
    }

    document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));

    // 激活当前叶子项
    document.querySelector(`.nav-item[data-page="${page}"]`)?.classList.add('active');
    target.classList.add('active');

    // 自动展开所属分组，保证当前项可见
    const group = document.querySelector(`.nav-item[data-page="${page}"]`)?.closest('.nav-group');
    if (group) {
        group.classList.add('expanded');
        group.querySelector('.nav-group-header')?.setAttribute('aria-expanded', 'true');
    }

    activePage = page;
    handlePageEnter(page);
}

async function handlePageEnter(page) {
    try {
        await ensurePageInitialized(page);
        if (page === 'tool-jwt') {
            updateJwtTool();
        }
        if (page === 'tool-time') {
            updateTimeTool(true);
            startTimeNowTicker();
        }
        if (page === 'tool-hash') {
            updateHashTool();
        }
        if (page === 'tool-crypto') {
            updateCryptoToolUi();
        }
        if (page === 'tool-diff') {
            updateDiffToolUi();
            scheduleDiffUpdate();
        }
        if (page === 'tool-b64hex') {
            updateB64HexTool();
        }
        if (page === 'tool-url') {
            updateUrlTool();
        }
        if (page === 'tool-radix') {
            updateRadixTool();
        }
        if (page === 'tool-charcount') {
            updateCharCountTool();
        }
        if (page === 'tool-csv') {
            updateCsvTool();
        }
        if (page === 'backup') {
            initBackupPage();
        }
    } catch (e) {
        console.error('页面进入处理失败:', page, e);
    }
}

function handlePageLeave(page) {
    if (page === 'tool-time') {
        stopTimeNowTicker();
    }
}

// 主题切换
const THEME_ICONS = {
    'light': '☀️', 'cute': '🐶', 'office': '📊',
    'neon-light': '🌊', 'cyberpunk-light': '🌸',
    'dark': '🌙', 'neon': '🌈', 'cyberpunk': '🤖'
};

const THEME_MASCOTS = {
    'light': '☀️', 'cute': '🐶', 'office': '📊',
    'neon-light': '🌊', 'cyberpunk-light': '🌸',
    'dark': '🌙', 'neon': '🌈', 'cyberpunk': '🤖'
};

async function initTheme() {
    // 优先从后端获取主题，回退到 localStorage
    let savedTheme = 'dark';
    try {
        savedTheme = await pywebview.api.get_theme();
    } catch (e) {
        savedTheme = localStorage.getItem('theme') || 'dark';
    }
    setTheme(savedTheme, false);

    // 点击外部关闭菜单
    window.addEventListener('click', (e) => {
        const menu = document.getElementById('themeMenu');
        const btn = document.getElementById('themeToggleBtn');
        if (menu && btn && menu.classList.contains('active')) {
            if (!menu.contains(e.target) && !btn.contains(e.target)) {
                menu.classList.remove('active');
            }
        }
    });
}

function toggleThemeMenu() {
    const menu = document.getElementById('themeMenu');
    menu.classList.toggle('active');
}

function selectTheme(theme) {
    setTheme(theme);
    document.getElementById('themeMenu').classList.remove('active');
}

function setTheme(theme, save = true) {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
    updateThemeIcon(theme);
    updateThemeSelector(theme);
    // 保存到后端
    if (save) {
        pywebview.api.save_theme(theme).catch(() => {});
    }
}

function updateThemeIcon(theme) {
    const iconEl = document.getElementById('currentThemeIcon');
    if (iconEl && THEME_ICONS[theme]) {
        iconEl.textContent = THEME_ICONS[theme];
    }
    // 更新侧边栏吉祥物
    const mascotEl = document.getElementById('themeMascot');
    if (mascotEl && THEME_MASCOTS[theme]) {
        mascotEl.textContent = THEME_MASCOTS[theme];
    }
}

function updateThemeSelector(activeTheme) {
    document.querySelectorAll('.theme-item').forEach(opt => {
        opt.classList.toggle('active', opt.dataset.theme === activeTheme);
    });
}

// ==================== 毛玻璃模式 ====================
async function initGlassMode() {
    let enabled = false;
    try {
        enabled = await pywebview.api.get_glass_mode();
    } catch (e) {
        enabled = localStorage.getItem('glass_mode') === 'true';
    }
    setGlassMode(enabled, false);
    // 加载透明度设置
    await loadGlassOpacity();
}

function setGlassMode(enabled, save = true) {
    document.documentElement.setAttribute('data-glass', enabled ? 'true' : 'false');
    localStorage.setItem('glass_mode', enabled);
    const toggle = document.getElementById('glassToggle');
    if (toggle) toggle.checked = enabled;
    // 显示/隐藏透明度调节器
    const opacityWrapper = document.getElementById('glassOpacityWrapper');
    if (opacityWrapper) {
        opacityWrapper.style.display = enabled ? 'block' : 'none';
    }
    if (save) {
        pywebview.api.save_glass_mode(enabled).catch(() => {});
    }
}

function toggleGlassMode() {
    const current = document.documentElement.getAttribute('data-glass') === 'true';
    setGlassMode(!current);
}

// 更新毛玻璃透明度
function updateGlassOpacity(value) {
    const opacity = parseInt(value) / 100;
    document.documentElement.style.setProperty('--glass-opacity', opacity);
    // 更新显示的百分比
    const valueDisplay = document.getElementById('opacityValue');
    if (valueDisplay) valueDisplay.textContent = value + '%';
    // 保存设置
    localStorage.setItem('glass_opacity', value);
    pywebview.api.save_glass_opacity(parseInt(value)).catch(() => {});
}

// 加载毛玻璃透明度
async function loadGlassOpacity() {
    let opacity = 60;
    try {
        opacity = await pywebview.api.get_glass_opacity();
    } catch {
        opacity = parseInt(localStorage.getItem('glass_opacity') || '60');
    }
    const slider = document.getElementById('glassOpacitySlider');
    if (slider) slider.value = opacity;
    const valueDisplay = document.getElementById('opacityValue');
    if (valueDisplay) valueDisplay.textContent = opacity + '%';
    document.documentElement.style.setProperty('--glass-opacity', opacity / 100);
}

// ==================== 凭证管理 ====================
async function loadCredentials() {
    allCredentials = await pywebview.api.get_credentials();
    renderCredentials(allCredentials);
}

function renderCredentials(credentials) {
    const container = document.getElementById('credentials-list');
    if (!credentials.length) {
        container.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-icon">🔐</div>
                <div class="empty-state-text">暂无记录，点击右上角添加</div>
            </div>`;
        return;
    }

    container.innerHTML = credentials.map(cred => `
        <div class="credential-card" data-cred-id="${cred.id}" draggable="true"
             ondragstart="onCredentialDragStart(event)"
             ondragover="onCredentialDragOver(event)"
             ondrop="onCredentialDrop(event)"
             ondragend="onCredentialDragEnd(event)">
            <div class="credential-header">
                <div class="credential-title-area">
                    <div class="credential-service">${escapeHtml(cred.service)}</div>
                    ${cred.url ? `<div class="credential-url"><a href="${escapeHtml(cred.url)}" target="_blank">${escapeHtml(cred.url)}</a></div>` : ''}
                </div>
                <div class="credential-actions">
                    <button class="btn btn-sm btn-ghost" onclick="editCredential('${cred.id}')">编辑</button>
                    <button class="btn btn-sm btn-danger" onclick="deleteCredential('${cred.id}')" title="删除"><span class="btn-icon">🗑️</span></button>
                </div>
            </div>
            <div class="credential-body">
                ${cred.account ? `
                <div class="credential-field">
                    <span class="credential-label">账号</span>
                    <span class="credential-value">${escapeHtml(cred.account)}</span>
                    <button class="copy-btn" onclick="copyField(this, '${escapeAttr(cred.account)}')" title="复制">📋</button>
                </div>` : ''}
                ${cred.password ? `
                <div class="credential-field">
                    <span class="credential-label">密码</span>
                    <span class="credential-value">${escapeHtml(cred.password)}</span>
                    <button class="copy-btn" onclick="copyField(this, '${escapeAttr(cred.password)}')" title="复制">📋</button>
                </div>` : ''}
            </div>
            ${cred.extra && cred.extra.length ? `
            <div class="credential-extra-toggle">
                <button class="btn btn-sm btn-ghost" onclick="toggleCredentialExtra('${cred.id}', event)">
                    ${expandedCredentialIds.has(cred.id) ? '收起附加信息' : '展开附加信息'}
                </button>
            </div>
            <div class="credential-extra ${expandedCredentialIds.has(cred.id) ? 'expanded' : ''}">
                ${cred.extra.map(e => `<div class="credential-extra-item">${escapeHtml(e)}</div>`).join('')}
            </div>` : ''}
        </div>
    `).join('');
}

function filterCredentials() {
    const keyword = document.getElementById('credential-search').value.toLowerCase();
    const filtered = allCredentials.filter(c =>
        c.service.toLowerCase().includes(keyword) ||
        c.account.toLowerCase().includes(keyword) ||
        c.url.toLowerCase().includes(keyword)
    );
    renderCredentials(filtered);
}

function showCredentialModal(cred = null) {
    document.getElementById('credential-modal-title').textContent = cred ? '编辑记录' : '添加记录';
    document.getElementById('credential-id').value = cred?.id || '';
    document.getElementById('credential-service').value = cred?.service || '';
    document.getElementById('credential-url').value = cred?.url || '';
    document.getElementById('credential-account').value = cred?.account || '';
    document.getElementById('credential-password').value = cred?.password || '';
    document.getElementById('credential-extra').value = cred?.extra?.join('\n') || '';
    openModal('credential-modal');
}

async function editCredential(id) {
    const cred = allCredentials.find(c => c.id === id);
    if (cred) showCredentialModal(cred);
}

async function saveCredential() {
    const id = document.getElementById('credential-id').value;
    const service = document.getElementById('credential-service').value.trim();
    const url = document.getElementById('credential-url').value.trim();
    const account = document.getElementById('credential-account').value.trim();
    const password = document.getElementById('credential-password').value.trim();
    const extra = document.getElementById('credential-extra').value.split('\n').filter(l => l.trim());

    if (!service) {
        alert('请填写服务名称');
        return;
    }

    if (id) {
        await pywebview.api.update_credential(id, service, url, account, password, extra);
    } else {
        await pywebview.api.add_credential(service, url, account, password, extra);
    }
    closeModal('credential-modal');
    loadCredentials();
}

async function deleteCredential(id) {
    if (confirm('确定删除此记录？')) {
        await pywebview.api.delete_credential(id);
        loadCredentials();
    }
}

function toggleCredentialExtra(id, e) {
    if (e) e.stopPropagation();
    if (expandedCredentialIds.has(id)) {
        expandedCredentialIds.delete(id);
    } else {
        expandedCredentialIds.add(id);
    }
    // 重新渲染以更新展开状态与按钮文案
    const keyword = document.getElementById('credential-search').value.toLowerCase();
    const filtered = allCredentials.filter(c =>
        c.service.toLowerCase().includes(keyword) ||
        c.account.toLowerCase().includes(keyword) ||
        c.url.toLowerCase().includes(keyword)
    );
    renderCredentials(keyword ? filtered : allCredentials);
}

// 凭证拖拽排序
let draggedCredentialId = null;

function onCredentialDragStart(e) {
    const card = e.target.closest('.credential-card');
    if (!card) return;
    draggedCredentialId = card.dataset.credId;
    card.classList.add('dragging');
    if (e.dataTransfer) {
        e.dataTransfer.effectAllowed = 'move';
    }
}

function onCredentialDragOver(e) {
    e.preventDefault();
    const target = e.target.closest('.credential-card');
    if (target && target.dataset.credId !== draggedCredentialId) {
        target.classList.add('drag-over');
    }
}

async function onCredentialDrop(e) {
    e.preventDefault();
    const target = e.target.closest('.credential-card');
    if (target && draggedCredentialId && target.dataset.credId !== draggedCredentialId) {
        await reorderCredentials(draggedCredentialId, target.dataset.credId);
    }
    document.querySelectorAll('.credential-card').forEach(el => el.classList.remove('drag-over'));
}

function onCredentialDragEnd() {
    draggedCredentialId = null;
    document.querySelectorAll('.credential-card').forEach(el => {
        el.classList.remove('dragging', 'drag-over');
    });
}

async function reorderCredentials(draggedId, targetId) {
    const draggedIdx = allCredentials.findIndex(c => c.id === draggedId);
    const targetIdx = allCredentials.findIndex(c => c.id === targetId);
    if (draggedIdx === -1 || targetIdx === -1) return;

    const [dragged] = allCredentials.splice(draggedIdx, 1);
    allCredentials.splice(targetIdx, 0, dragged);

    const keyword = document.getElementById('credential-search').value.toLowerCase();
    const displayList = keyword
        ? allCredentials.filter(c =>
            c.service.toLowerCase().includes(keyword) ||
            c.account.toLowerCase().includes(keyword) ||
            c.url.toLowerCase().includes(keyword)
        )
        : allCredentials;

    renderCredentials(displayList);
    await pywebview.api.reorder_credentials(allCredentials.map(c => c.id));
}

// ==================== 页签管理 ====================
async function loadTabs() {
    allTabs = await pywebview.api.get_tabs();
    if (!currentTabId && allTabs.length) {
        currentTabId = allTabs[0].id;
    }
    renderTabs();
}

function renderTabs() {
    const container = document.getElementById('command-tabs');
    container.innerHTML = allTabs.map(tab => {
        const count = allCommands.filter(c => c.tab_id === tab.id).length;
        return `
            <div class="tab-item ${tab.id === currentTabId ? 'active' : ''}"
                 data-tab-id="${tab.id}"
                 draggable="true"
                 onclick="selectTab('${tab.id}')"
                 ondragstart="onTabDragStart(event)"
                 ondragover="onTabDragOver(event)"
                 ondrop="onTabDrop(event)"
                 ondragend="onTabDragEnd(event)">
                <span>${escapeHtml(tab.name)}</span>
                <span class="tab-count">${count}</span>
            </div>
        `;
    }).join('');
}

function selectTab(tabId) {
    currentTabId = tabId;
    renderTabs();
    renderCommandsByTab();
}

function getTabCommandCount(tabId) {
    return allCommands.filter(c => c.tab_id === tabId).length;
}

// 页签拖拽排序
let draggedTabId = null;

function onTabDragStart(e) {
    draggedTabId = e.target.dataset.tabId;
    e.target.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
}

function onTabDragOver(e) {
    e.preventDefault();
    const target = e.target.closest('.tab-item');
    if (target && target.dataset.tabId !== draggedTabId) {
        target.classList.add('drag-over');
    }
}

function onTabDrop(e) {
    e.preventDefault();
    const target = e.target.closest('.tab-item');
    if (target && draggedTabId && target.dataset.tabId !== draggedTabId) {
        const targetId = target.dataset.tabId;
        reorderTabs(draggedTabId, targetId);
    }
    document.querySelectorAll('.tab-item').forEach(el => el.classList.remove('drag-over'));
}

function onTabDragEnd(e) {
    draggedTabId = null;
    document.querySelectorAll('.tab-item').forEach(el => {
        el.classList.remove('dragging', 'drag-over');
    });
}

async function reorderTabs(draggedId, targetId) {
    const draggedIdx = allTabs.findIndex(t => t.id === draggedId);
    const targetIdx = allTabs.findIndex(t => t.id === targetId);

    const [dragged] = allTabs.splice(draggedIdx, 1);
    allTabs.splice(targetIdx, 0, dragged);

    const newOrder = allTabs.map(t => t.id);
    await pywebview.api.reorder_tabs(newOrder);
    renderTabs();
}

// 页签管理弹窗
function showTabModal() {
    renderTabManageList();
    openModal('tab-modal');
}

function renderTabManageList() {
    const container = document.getElementById('tabs-manage-list');
    container.innerHTML = allTabs.map(tab => `
        <div class="tab-manage-item" data-tab-id="${tab.id}" draggable="true"
             ondragstart="onManageTabDragStart(event)"
             ondragover="onManageTabDragOver(event)"
             ondrop="onManageTabDrop(event)"
             ondragend="onManageTabDragEnd(event)">
            <span class="tab-drag-handle">☰</span>
            <div class="tab-manage-name">${escapeHtml(tab.name)}</div>
            <div class="tab-manage-actions">
                <button class="tab-manage-btn" onclick="editTabName('${tab.id}')" title="编辑">✏️</button>
                ${tab.id !== '0' ? `<button class="tab-manage-btn delete" onclick="deleteTab('${tab.id}')" title="删除">🗑</button>` : ''}
            </div>
        </div>
    `).join('');
}

// 管理列表拖拽
let draggedManageTabId = null;

function onManageTabDragStart(e) {
    draggedManageTabId = e.target.closest('.tab-manage-item').dataset.tabId;
    e.target.closest('.tab-manage-item').classList.add('dragging');
}

function onManageTabDragOver(e) {
    e.preventDefault();
    const target = e.target.closest('.tab-manage-item');
    if (target && target.dataset.tabId !== draggedManageTabId) {
        target.classList.add('drag-over');
    }
}

function onManageTabDrop(e) {
    e.preventDefault();
    const target = e.target.closest('.tab-manage-item');
    if (target && draggedManageTabId && target.dataset.tabId !== draggedManageTabId) {
        reorderTabs(draggedManageTabId, target.dataset.tabId);
        renderTabManageList();
    }
    document.querySelectorAll('.tab-manage-item').forEach(el => el.classList.remove('drag-over'));
}

function onManageTabDragEnd(e) {
    draggedManageTabId = null;
    document.querySelectorAll('.tab-manage-item').forEach(el => {
        el.classList.remove('dragging', 'drag-over');
    });
}

async function addTab() {
    const nameInput = document.getElementById('new-tab-name');
    const name = nameInput.value.trim();
    if (!name) {
        alert('请输入页签名称');
        return;
    }
    await pywebview.api.add_tab(name);
    nameInput.value = '';
    await loadTabs();
    renderTabManageList();
}

async function editTabName(tabId) {
    const tab = allTabs.find(t => t.id === tabId);
    if (!tab) return;

    const newName = prompt('输入新名称', tab.name);
    if (newName && newName.trim() && newName !== tab.name) {
        await pywebview.api.update_tab(tabId, newName.trim());
        await loadTabs();
        renderTabManageList();
    }
}

async function deleteTab(tabId) {
    if (confirm('删除页签后，其中的命令将移至"未分类"。确定删除？')) {
        await pywebview.api.delete_tab(tabId);
        if (currentTabId === tabId) {
            currentTabId = '0';
        }
        await loadTabs();
        await loadCommands();
        renderTabManageList();
    }
}

// ==================== 命令块管理 ====================
async function loadCommands() {
    allCommands = await pywebview.api.get_commands();
    renderTabs(); // 更新计数
    renderCommandsByTab();
}

function renderCommandsByTab() {
    const commands = currentTabId
        ? allCommands.filter(c => c.tab_id === currentTabId)
        : allCommands;
    renderCommands(commands);
}

function renderCommands(commands) {
    const container = document.getElementById('commands-list');
    if (!commands.length) {
        container.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-icon">⌨️</div>
                <div class="empty-state-text">当前页签暂无命令</div>
            </div>`;
        return;
    }

    container.innerHTML = commands.map(cmd => `
        <div class="command-card" data-cmd-id="${cmd.id}" draggable="true"
             ondragstart="onCommandDragStart(event)"
             ondragover="onCommandDragOver(event)"
             ondrop="onCommandDrop(event)"
             ondragend="onCommandDragEnd(event)">
            <div class="command-header">
                <div class="command-info">
                    <div class="command-title">${escapeHtml(cmd.title)}</div>
                    ${cmd.description ? `<div class="command-description">${escapeHtml(cmd.description)}</div>` : ''}
                </div>
                <div class="command-actions">
                    <button class="btn btn-sm btn-ghost" onclick="showMoveCommandModal('${cmd.id}')" title="移动">📁</button>
                    <button class="btn btn-sm btn-ghost" onclick="editCommand('${cmd.id}')">编辑</button>
                    <button class="btn btn-sm btn-danger" onclick="deleteCommand('${cmd.id}')" title="删除"><span class="btn-icon">🗑️</span></button>
                </div>
            </div>
            <div class="command-body">
                <pre>${escapeHtml(cmd.commands.join('\n'))}</pre>
                <button class="command-copy-btn" onclick="copyCommand(this, \`${escapeAttr(cmd.commands.join('\n'))}\`)" title="复制命令">📋</button>
            </div>
        </div>
    `).join('');
}

// 命令拖拽排序
let draggedCommandId = null;

function onCommandDragStart(e) {
    draggedCommandId = e.target.closest('.command-card').dataset.cmdId;
    e.target.closest('.command-card').classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
}

function onCommandDragOver(e) {
    e.preventDefault();
    const target = e.target.closest('.command-card');
    if (target && target.dataset.cmdId !== draggedCommandId) {
        target.classList.add('drag-over');
    }
}

async function onCommandDrop(e) {
    e.preventDefault();
    const target = e.target.closest('.command-card');
    if (target && draggedCommandId && target.dataset.cmdId !== draggedCommandId) {
        await reorderCommands(draggedCommandId, target.dataset.cmdId);
    }
    document.querySelectorAll('.command-card').forEach(el => el.classList.remove('drag-over'));
}

function onCommandDragEnd(e) {
    draggedCommandId = null;
    document.querySelectorAll('.command-card').forEach(el => {
        el.classList.remove('dragging', 'drag-over');
    });
}

async function reorderCommands(draggedId, targetId) {
    const currentCmds = allCommands.filter(c => c.tab_id === currentTabId);
    const draggedIdx = currentCmds.findIndex(c => c.id === draggedId);
    const targetIdx = currentCmds.findIndex(c => c.id === targetId);
    if (draggedIdx === -1 || targetIdx === -1) return;

    const [dragged] = currentCmds.splice(draggedIdx, 1);
    currentCmds.splice(targetIdx, 0, dragged);

    currentCmds.forEach((cmd, idx) => {
        cmd.order = idx;
    });

    allCommands.sort((a, b) => {
        if (a.tab_id === b.tab_id) {
            return (a.order || 0) - (b.order || 0);
        }
        return a.tab_id < b.tab_id ? -1 : 1;
    });

    renderCommands(currentCmds);
    await pywebview.api.reorder_commands(currentTabId, currentCmds.map(c => c.id));
}

function filterCommands() {
    const keyword = document.getElementById('command-search').value.toLowerCase();
    let commands = currentTabId
        ? allCommands.filter(c => c.tab_id === currentTabId)
        : allCommands;

    if (keyword) {
        commands = commands.filter(c =>
            c.title.toLowerCase().includes(keyword) ||
            c.description.toLowerCase().includes(keyword) ||
            c.commands.some(cmd => cmd.toLowerCase().includes(keyword))
        );
    }
    renderCommands(commands);
}

function showCommandModal(cmd = null) {
    document.getElementById('command-modal-title').textContent = cmd ? '编辑命令' : '添加命令';
    document.getElementById('command-id').value = cmd?.id || '';
    document.getElementById('command-tab-id').value = cmd?.tab_id || currentTabId || '0';
    document.getElementById('command-title').value = cmd?.title || '';
    document.getElementById('command-description').value = cmd?.description || '';
    document.getElementById('command-content').value = cmd?.commands?.join('\n') || '';

    // 填充页签选择
    const select = document.getElementById('command-tab-select');
    select.innerHTML = allTabs.map(tab =>
        `<option value="${tab.id}" ${tab.id === (cmd?.tab_id || currentTabId || '0') ? 'selected' : ''}>${escapeHtml(tab.name)}</option>`
    ).join('');

    openModal('command-modal');
}

async function editCommand(id) {
    const cmd = allCommands.find(c => c.id === id);
    if (cmd) showCommandModal(cmd);
}

async function saveCommand() {
    const id = document.getElementById('command-id').value;
    const title = document.getElementById('command-title').value.trim();
    const description = document.getElementById('command-description').value.trim();
    const tabId = document.getElementById('command-tab-select').value;
    const commands = document.getElementById('command-content').value.split('\n').filter(l => l.trim());

    if (!title || !commands.length) {
        alert('请填写标题和命令');
        return;
    }

    if (id) {
        await pywebview.api.update_command(id, title, description, commands, tabId, []);
    } else {
        await pywebview.api.add_command(title, description, commands, tabId, []);
    }
    closeModal('command-modal');
    await loadCommands();
}

async function deleteCommand(id) {
    if (confirm('确定删除此命令？')) {
        await pywebview.api.delete_command(id);
        await loadCommands();
    }
}

// 移动命令到页签
function showMoveCommandModal(cmdId) {
    const cmd = allCommands.find(c => c.id === cmdId);
    if (!cmd) return;

    document.getElementById('move-command-id').value = cmdId;
    const container = document.getElementById('move-tab-options');

    container.innerHTML = allTabs.map(tab => `
        <div class="move-tab-option ${tab.id === cmd.tab_id ? 'current' : ''}" onclick="moveCommandToTab('${cmdId}', '${tab.id}')">
            <span class="move-tab-icon">📁</span>
            <span class="move-tab-name">${escapeHtml(tab.name)}</span>
            ${tab.id === cmd.tab_id ? '<span class="move-tab-current">当前</span>' : ''}
        </div>
    `).join('');

    openModal('move-command-modal');
}

async function moveCommandToTab(cmdId, tabId) {
    await pywebview.api.move_command_to_tab(cmdId, tabId);
    closeModal('move-command-modal');
    await loadCommands();
}

// ==================== 批量导入 ====================
function showImportModal(type) {
    document.getElementById('import-type').value = type;
    document.getElementById('import-content').value = '';

    if (type === 'credentials') {
        document.getElementById('import-modal-title').textContent = '批量导入凭证';
        document.getElementById('import-hint').innerHTML = `
            支持格式：<br>
            1. <code>服务名 URL || 账号 || 密码</code><br>
            2. 多行格式（空行分隔）：<br>
            <code>服务名<br>账号：xxx<br>密码：xxx</code>
        `;
    } else {
        document.getElementById('import-modal-title').textContent = '批量导入命令块';
        document.getElementById('import-hint').innerHTML = `
            格式：以 <code># 注释</code> 或 <code>标题：</code> 开头作为块标题，<br>
            后续行作为命令，空行分隔不同命令块<br>
            <small>导入的命令将添加到当前页签</small>
        `;
    }
    openModal('import-modal');
}

async function doImport() {
    const type = document.getElementById('import-type').value;
    const content = document.getElementById('import-content').value.trim();

    if (!content) {
        alert('请粘贴要导入的内容');
        return;
    }

    let result;
    if (type === 'credentials') {
        result = await pywebview.api.import_credentials(content);
        loadCredentials();
    } else {
        result = await pywebview.api.import_commands(content);
        await loadCommands();
    }

    closeModal('import-modal');
    alert(`成功导入 ${result.imported} 条记录`);
}

// ==================== 节点转换 ====================
async function convertLinks() {
    const linksText = document.getElementById('links-input').value.trim();
    if (!linksText) {
        alert('请输入节点链接');
        return;
    }

    const result = await pywebview.api.convert_links(linksText);
    applyConvertResult(result);
}

function isLikelyNodeLinks(text) {
    const t = (text || '').trim();
    if (!t) return false;
    // 多行基本就是节点列表
    if (t.includes('\n') || t.includes('\r')) return true;
    // 单条节点链接（常见协议）
    return /^(vless|hysteria2|ss):\/\//i.test(t);
}

function initConverterOutput() {
    updateConverterFormatButtons();
}

function setConvertOutputFormat(format) {
    if (format !== 'yaml' && format !== 'json') return;
    convertOutputFormat = format;
    renderConvertOutput();
    updateConverterFormatButtons();
}

function updateConverterFormatButtons() {
    const yamlBtn = document.getElementById('format-yaml-btn');
    const jsonBtn = document.getElementById('format-json-btn');
    yamlBtn?.classList.toggle('active', convertOutputFormat === 'yaml');
    jsonBtn?.classList.toggle('active', convertOutputFormat === 'json');
}

function renderConvertOutput() {
    const outputEl = document.getElementById('yaml-output');
    if (!outputEl) return;
    outputEl.value = convertOutputFormat === 'json' ? (lastConvertedJson || '') : (lastConvertedYaml || '');
}

function applyConvertResult(result) {
    const nodes = Array.isArray(result?.nodes) ? result.nodes : [];
    const yaml = typeof result?.yaml === 'string' ? result.yaml : '';
    const errors = Array.isArray(result?.errors) ? result.errors : [];

    convertedNodes = nodes;
    lastConvertedYaml = yaml;
    lastConvertedJson = JSON.stringify(nodes, null, 2);

    renderConvertOutput();
    updateConverterFormatButtons();
    showErrors(errors);
}

async function fetchSubscription() {
    const url = document.getElementById('subscription-url').value.trim();
    if (!url) {
        alert('请输入订阅URL');
        return;
    }

    // 兼容用户误把“节点链接”粘贴到“订阅链接”输入框的情况
    if (isLikelyNodeLinks(url)) {
        document.getElementById('links-input').value = url;
        await convertLinks();
        return;
    }

    const result = await pywebview.api.fetch_subscription(url);
    applyConvertResult(result);
}

function showErrors(errors) {
    const container = document.getElementById('convert-errors');
    const safeErrors = Array.isArray(errors) ? errors : [];
    container.innerHTML = safeErrors.map(e => `<div>⚠ ${escapeHtml(e)}</div>`).join('');
}

function copyYaml() {
    const content = document.getElementById('yaml-output').value;
    if (content) {
        copyToClipboard(content).then((ok) => {
            alert(ok ? '已复制到剪贴板' : '复制失败，请手动复制');
        });
    }
}

async function saveConvertedNodes() {
    if (!convertedNodes.length) {
        alert('没有可保存的节点');
        return;
    }

    for (const node of convertedNodes) {
        await pywebview.api.save_node(
            node.name,
            node.type,
            node.server,
            node.port,
            '',
            JSON.stringify(node, null, 2)
        );
    }
    alert(`已保存 ${convertedNodes.length} 个节点`);
    loadNodes();
}

// ==================== 节点管理 ====================
async function loadNodes() {
    const nodes = await pywebview.api.get_nodes();
    const container = document.getElementById('nodes-list');

    if (!nodes.length) {
        container.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-icon">🌐</div>
                <div class="empty-state-text">暂无保存的节点</div>
            </div>`;
        return;
    }

    container.innerHTML = nodes.map(node => `
        <div class="node-card">
            <div class="node-header">
                <span class="node-name">${escapeHtml(node.name)}</span>
                <div style="display:flex;gap:8px;align-items:center">
                    <span class="node-type">${escapeHtml(node.type)}</span>
                    <button class="btn btn-sm btn-danger" onclick="deleteNode('${node.id}')" title="删除"><span class="btn-icon">🗑️</span></button>
                </div>
            </div>
            <div class="node-info">
                <span>🖥 ${escapeHtml(node.server)}</span>
                <span>🔌 ${node.port}</span>
            </div>
        </div>
    `).join('');
}

async function deleteNode(id) {
    if (confirm('确定删除此节点？')) {
        await pywebview.api.delete_node(id);
        loadNodes();
    }
}

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

function openModal(id) {
    document.getElementById(id).classList.add('active');
}

function closeModal(id) {
    document.getElementById(id).classList.remove('active');
}

function escapeHtml(text) {
    if (text === null || text === undefined) return '';
    const div = document.createElement('div');
    div.textContent = String(text);
    return div.innerHTML;
}

function escapeAttr(text) {
    if (text === null || text === undefined) return '';
    return String(text).replace(/'/g, "\\'").replace(/"/g, '\\"').replace(/`/g, '\\`');
}

function copyField(btn, text) {
    copyToolText(btn, text);
}

function copyCommand(btn, text) {
    copyToolText(btn, text);
}

// ==================== 工具箱：URL 编解码（M8） ====================
function initUrlTool() {
    const inputEl = document.getElementById('url-input');
    if (!inputEl) return;
    inputEl.addEventListener('input', updateUrlTool);
    document.getElementById('url-batch')?.addEventListener('change', updateUrlTool);
    setUrlMode('encode');
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
        if (urlMode === 'encode') {
            outputEl.value = batch
                ? window.DogToolboxM8Utils.urlEncodeBatch(inputText)
                : window.DogToolboxM8Utils.urlEncode(inputText);
        } else {
            if (batch) {
                const result = window.DogToolboxM8Utils.urlDecodeBatch(inputText);
                outputEl.value = result.result;
                if (result.errors && result.errors.length) {
                    errorsEl.innerHTML = result.errors.map(e => `<div>⚠ ${escapeHtml(e)}</div>`).join('');
                }
            } else {
                outputEl.value = window.DogToolboxM8Utils.urlDecode(inputText);
            }
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
let unicodeMode = 'encode';

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
let rsaMode = 'encrypt';

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
let jsonIndent = 2;

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
    if (!inputEl || !window.DogToolboxM10Utils) return;

    const fixed = window.DogToolboxM10Utils.tryFixJson(inputEl.value);
    inputEl.value = fixed;
    updateJsonTool();
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

// JSON 视图切换状态
let jsonViewMode = 'text';

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
let dataInputFormat = 'auto';
let dataOutputFormat = 'yaml';

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

// ==================== M31 Excel/CSV 转 JSON ====================
let tableInputFormat = 'csv';
let tableOutputFormat = 'json';

function initTableJsonTool() {
    updateTableFormatButtons();
}

function updateTableFormatButtons() {
    // 更新输入格式按钮状态
    const inputBtns = {
        csv: document.getElementById('table-in-csv'),
        tsv: document.getElementById('table-in-tsv'),
        json: document.getElementById('table-in-json')
    };

    Object.keys(inputBtns).forEach(key => {
        const btn = inputBtns[key];
        if (btn) {
            if (key === tableInputFormat) {
                btn.classList.add('active');
            } else {
                btn.classList.remove('active');
            }
        }
    });

    // 更新输出格式按钮状态
    const outputBtns = {
        json: document.getElementById('table-out-json'),
        csv: document.getElementById('table-out-csv'),
        tsv: document.getElementById('table-out-tsv')
    };

    Object.keys(outputBtns).forEach(key => {
        const btn = outputBtns[key];
        if (btn) {
            if (key === tableOutputFormat) {
                btn.classList.add('active');
            } else {
                btn.classList.remove('active');
            }
        }
    });
}

function setTableInputFormat(format) {
    tableInputFormat = format;
    updateTableFormatButtons();
    updateTableJsonTool();
}

function setTableOutputFormat(format) {
    tableOutputFormat = format;
    updateTableFormatButtons();
    updateTableJsonTool();
}

function clearTableJsonTool() {
    const inputEl = document.getElementById('table-input');
    const outputEl = document.getElementById('table-output');
    const errorsEl = document.getElementById('table-errors');

    if (inputEl) inputEl.value = '';
    if (outputEl) outputEl.value = '';
    if (errorsEl) errorsEl.innerHTML = '';
}

function updateTableJsonTool() {
    const inputEl = document.getElementById('table-input');
    const outputEl = document.getElementById('table-output');
    const errorsEl = document.getElementById('table-errors');
    const hasHeaderEl = document.getElementById('table-has-header');
    const jsonFormatEl = document.getElementById('table-json-format');
    const jsonIndentEl = document.getElementById('table-json-indent');

    if (!inputEl || !outputEl) return;

    const input = inputEl.value.trim();
    if (errorsEl) errorsEl.innerHTML = '';

    if (!input) {
        outputEl.value = '';
        return;
    }

    if (!window.DogToolboxM31Utils) {
        if (errorsEl) errorsEl.innerHTML = '<div class="error-message">工具模块未加载：tools_m31_utils.js</div>';
        outputEl.value = '';
        return;
    }

    try {
        const hasHeader = hasHeaderEl?.checked !== false;
        const jsonFormat = jsonFormatEl?.value || 'object';
        const jsonIndent = parseInt(jsonIndentEl?.value || '2', 10);

        let result = '';

        if (tableInputFormat === 'json' && tableOutputFormat !== 'json') {
            // JSON → CSV/TSV
            const json = JSON.parse(input);
            const tableData = DogToolboxM31Utils.jsonToTable(json);
            const delimiter = tableOutputFormat === 'tsv' ? '\t' : ',';
            result = DogToolboxM31Utils.tableToCsv(tableData, delimiter);
        } else if (tableInputFormat !== 'json' && tableOutputFormat === 'json') {
            // CSV/TSV → JSON
            const format = tableInputFormat === 'tsv' ? 'tsv' : 'csv';
            const tableData = DogToolboxM31Utils.parseTableData(input, format);

            if (tableData.length === 0) {
                throw new Error('未能解析出有效数据');
            }

            const jsonData = DogToolboxM31Utils.tableToJson(tableData, {
                hasHeader: hasHeader,
                outputFormat: jsonFormat
            });
            result = JSON.stringify(jsonData, null, jsonIndent);
        } else if (tableInputFormat === tableOutputFormat) {
            // 相同格式，直接输出
            result = input;
        } else {
            // CSV ↔ TSV 转换
            const tableData = DogToolboxM31Utils.parseTableData(input, tableInputFormat);
            const delimiter = tableOutputFormat === 'tsv' ? '\t' : ',';
            result = DogToolboxM31Utils.tableToCsv(tableData, delimiter);
        }

        outputEl.value = result;
    } catch (e) {
        if (errorsEl) {
            errorsEl.innerHTML = `<div class="error-message">错误：${escapeHtml(e.message || String(e))}</div>`;
        }
        outputEl.value = '';
    }
}

function copyTableOutput(btn) {
    const outputEl = document.getElementById('table-output');
    if (!outputEl || !outputEl.value) return;
    copyToolText(btn, outputEl.value, { showTextFeedback: true });
}

function downloadTableOutput() {
    const output = document.getElementById('table-output')?.value;
    if (!output) return;

    const format = tableOutputFormat || 'json';
    const ext = format === 'json' ? 'json' : (format === 'tsv' ? 'tsv' : 'csv');
    const mimeType = format === 'json' ? 'application/json' : 'text/csv';

    const blob = new Blob([output], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `data.${ext}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
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
function initRegexTool() {
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

function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

// ========== M13: cURL 解析工具 ==========
let curlState = {
    parsed: null,
    lang: 'fetch'
};

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

let sqlMode = 'format';

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
    if (sqlMode === 'format') {
        result = DogToolboxM15Utils.formatSQL(input);
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

// ==================== 数据备份与恢复 ====================
async function initBackupPage() {
    await updateBackupStats();
}

async function updateBackupStats() {
    try {
        const stats = await pywebview.api.get_data_stats();
        document.getElementById('stat-tabs').textContent = stats.tabs ?? '-';
        document.getElementById('stat-commands').textContent = stats.commands ?? '-';
        document.getElementById('stat-credentials').textContent = stats.credentials ?? '-';
        document.getElementById('stat-nodes').textContent = stats.nodes ?? '-';
    } catch (e) {
        console.error('Failed to load backup stats:', e);
    }
}

async function exportBackup() {
    const resultEl = document.getElementById('backup-result');
    resultEl.style.display = 'none';
    resultEl.className = 'backup-result';

    try {
        const data = await pywebview.api.export_data();
        const jsonStr = JSON.stringify(data, null, 2);
        const blob = new Blob([jsonStr], { type: 'application/json' });
        const url = URL.createObjectURL(blob);

        const now = new Date();
        const ts = now.toISOString().slice(0, 19).replace(/[:\-T]/g, '').replace(/(\d{8})(\d{6})/, '$1_$2');
        const filename = `狗狗百宝箱_备份_${ts}.json`;

        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        resultEl.className = 'backup-result backup-success';
        resultEl.innerHTML = `
            <div class="backup-result-title">✅ 导出成功</div>
            <div class="backup-result-details">
                备份文件已下载：<strong>${filename}</strong>
                <ul>
                    <li>页签：${data.data.tabs?.length ?? 0} 条</li>
                    <li>命令：${data.data.commands?.length ?? 0} 条</li>
                    <li>凭证：${data.data.credentials?.length ?? 0} 条</li>
                    <li>节点：${data.data.nodes?.length ?? 0} 条</li>
                </ul>
            </div>
        `;
        resultEl.style.display = '';
    } catch (e) {
        resultEl.className = 'backup-result backup-error';
        resultEl.innerHTML = `
            <div class="backup-result-title">❌ 导出失败</div>
            <div class="backup-result-details">${escapeHtml(e.message || String(e))}</div>
        `;
        resultEl.style.display = '';
    }
}

async function importBackup(event) {
    const file = event.target.files?.[0];
    if (!file) return;

    const resultEl = document.getElementById('backup-result');
    resultEl.style.display = 'none';
    resultEl.className = 'backup-result';

    try {
        const text = await file.text();
        const jsonData = JSON.parse(text);

        if (!jsonData.data) {
            throw new Error('无效的备份文件格式：缺少 data 字段');
        }

        if (!confirm('导入将覆盖现有数据，是否继续？')) {
            event.target.value = '';
            return;
        }

        const result = await pywebview.api.import_data(jsonData);

        if (result.success) {
            resultEl.className = 'backup-result backup-success';
            resultEl.innerHTML = `
                <div class="backup-result-title">✅ 导入成功</div>
                <div class="backup-result-details">
                    已导入数据：
                    <ul>
                        <li>页签：${result.imported.tabs} 条</li>
                        <li>命令：${result.imported.commands} 条</li>
                        <li>凭证：${result.imported.credentials} 条</li>
                        <li>节点：${result.imported.nodes} 条</li>
                    </ul>
                    页面将自动刷新以加载新数据...
                </div>
            `;
            resultEl.style.display = '';
            await updateBackupStats();
            setTimeout(() => location.reload(), 2000);
        } else {
            throw new Error(result.error || '导入失败');
        }
    } catch (e) {
        resultEl.className = 'backup-result backup-error';
        resultEl.innerHTML = `
            <div class="backup-result-title">❌ 导入失败</div>
            <div class="backup-result-details">${escapeHtml(e.message || String(e))}</div>
        `;
        resultEl.style.display = '';
    }

    event.target.value = '';
}

// ==================== M22 Markdown 预览工具 ====================
let markdownViewMode = 'split';

function setMarkdownViewMode(mode) {
    if (!['split', 'edit', 'preview'].includes(mode)) return;
    markdownViewMode = mode;

    const editPanel = document.getElementById('markdown-edit-panel');
    const previewPanel = document.getElementById('markdown-preview-panel');
    const layout = document.getElementById('markdown-layout');

    // 更新按钮状态
    document.querySelectorAll('.view-mode-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.mode === mode);
    });

    if (!editPanel || !previewPanel || !layout) return;

    // 重置样式
    editPanel.style.display = '';
    previewPanel.style.display = '';
    editPanel.style.flex = '';
    previewPanel.style.flex = '';

    switch (mode) {
        case 'edit':
            previewPanel.style.display = 'none';
            editPanel.style.flex = '1';
            break;
        case 'preview':
            editPanel.style.display = 'none';
            previewPanel.style.flex = '1';
            break;
        case 'split':
        default:
            // 默认分屏模式，两个面板各占一半
            break;
    }
}

function clearMarkdownTool() {
    document.getElementById('markdown-input').value = '';
    document.getElementById('markdown-preview').innerHTML = '';
}

function updateMarkdownTool() {
    const input = document.getElementById('markdown-input').value;
    const previewEl = document.getElementById('markdown-preview');

    if (!input.trim()) {
        previewEl.innerHTML = '<p class="placeholder-text">预览将在此处显示...</p>';
        return;
    }

    try {
        const html = DogToolboxM22Utils.parseMarkdown(input);
        previewEl.innerHTML = html;
    } catch (e) {
        previewEl.innerHTML = `<div class="error-message">解析错误：${escapeHtml(e.message || String(e))}</div>`;
    }
}

function copyMarkdownHtml(btn) {
    const previewEl = document.getElementById('markdown-preview');
    const html = previewEl.innerHTML;

    if (!html || html.includes('placeholder-text')) {
        return;
    }

    copyToolText(btn, html, { showTextFeedback: true });
}

function exportMarkdownAsHtml() {
    const inputEl = document.getElementById('markdown-input');
    const input = inputEl?.value;

    if (!input || !input.trim()) {
        return;
    }

    if (!window.DogToolboxM22Utils) {
        alert('工具模块未加载');
        return;
    }

    try {
        // 生成完整 HTML
        const htmlContent = window.DogToolboxM22Utils.exportAsHtml(input, {
            title: 'Markdown 文档'
        });

        // 创建 Blob 并触发下载
        const blob = new Blob([htmlContent], { type: 'text/html;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;

        // 生成文件名（带时间戳）
        const timestamp = new Date().toISOString().slice(0, 19).replace(/[:]/g, '-');
        link.download = `markdown-export-${timestamp}.html`;

        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    } catch (e) {
        alert('导出失败：' + (e.message || String(e)));
    }
}

// ==================== 输入验证辅助函数 ====================

/**
 * 验证输入字段，为空则添加错误样式
 * @param {string} elementId - 元素ID
 * @param {string} value - 字段值
 * @returns {boolean} 是否通过验证
 */
function validateInput(elementId, value) {
    const el = document.getElementById(elementId);
    if (!el) return true; // 元素不存在，跳过验证

    const isValid = value && value.trim() !== '';

    if (isValid) {
        el.classList.remove('input-error');
    } else {
        el.classList.add('input-error');
    }

    return isValid;
}

/**
 * 清除所有验证错误样式
 * @param {string[]} elementIds - 元素ID数组
 */
function clearValidationErrors(elementIds) {
    elementIds.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.classList.remove('input-error');
    });
}

// ==================== 原有 M26 Git 命令生成器 ====================

// ==================== M26 Git 命令生成器 ====================
let currentGitScene = 'commit';

// 场景切换
function switchGitScene(scene, evt) {
    currentGitScene = scene;

    // 更新 tab 激活状态
    document.querySelectorAll('.tool-tab').forEach(tab => {
        tab.classList.remove('active');
    });
    if (evt?.target) {
        evt.target.classList.add('active');
    }

    // 更新场景显示
    document.querySelectorAll('.git-scene').forEach(s => {
        s.classList.remove('active');
    });
    document.getElementById(`git-scene-${scene}`)?.classList.add('active');

    // 重置面板过滤状态
    resetPanelFiltering('.git-tool');

    // 如果是模板场景，加载模板
    if (scene === 'templates') {
        loadGitTemplates();
    } else {
        updateGitCommand();
    }
}

// 加载常用命令模板
function loadGitTemplates() {
    if (!window.DogToolboxM26Utils) return;

    const templates = DogToolboxM26Utils.getCommonTemplates();
    const container = document.getElementById('git-templates-list');
    
    // Add grid class if not present
    container.className = 'git-templates-grid';

    // Helper to pick icon
    const getIcon = (name) => {
        if (name.includes('初始化')) return '🏁';
        if (name.includes('状态')) return '🔍';
        if (name.includes('添加')) return '➕';
        if (name.includes('差异')) return '⚖️';
        if (name.includes('推送')) return '⬆️';
        if (name.includes('拉取')) return '⬇️';
        if (name.includes('远程')) return '🔗';
        if (name.includes('标签')) return '🏷️';
        if (name.includes('检出')) return '↩️';
        if (name.includes('日志') || name.includes('详情')) return '📜';
        if (name.includes('清理')) return '🧹';
        return '🔹';
    };

    container.innerHTML = templates.map(t => `
        <button type="button" class="git-template-card" onclick="applyGitTemplate('${escapeAttr(t.command)}')">
            <div class="git-template-header">
                <div class="git-template-icon" aria-hidden="true">${getIcon(t.name)}</div>
                <div class="git-template-info">
                    <div class="git-template-name">${escapeHtml(t.name)}</div>
                    <div class="git-template-desc">${escapeHtml(t.description)}</div>
                </div>
            </div>
            <div class="git-template-footer">
                <code class="git-template-code">${escapeHtml(t.command)}</code>
                <span class="git-template-hint">点击应用</span>
            </div>
        </button>
    `).join('');
}

// 应用模板到输出区
function applyGitTemplate(command) {
    document.getElementById('git-command-output').value = command;
    document.getElementById('git-command-desc').textContent = '已选择模板命令';
}

// 更新分支表单显示
function updateGitBranchForm() {
    const action = document.getElementById('git-branch-action')?.value;
    const nameGroup = document.getElementById('git-branch-name-group');
    const newnameGroup = document.getElementById('git-branch-newname-group');
    const forceGroup = document.getElementById('git-branch-force-group');
    const remoteGroup = document.getElementById('git-branch-remote-group');

    if (!action) return;

    // 隐藏所有可选字段
    if (nameGroup) nameGroup.style.display = 'none';
    if (newnameGroup) newnameGroup.style.display = 'none';
    if (forceGroup) forceGroup.style.display = 'none';
    if (remoteGroup) remoteGroup.style.display = 'none';

    // 根据操作类型显示相应字段
    switch (action) {
        case 'create':
        case 'switch':
            if (nameGroup) nameGroup.style.display = '';
            break;
        case 'delete':
            if (nameGroup) nameGroup.style.display = '';
            if (forceGroup) forceGroup.style.display = '';
            break;
        case 'rename':
            if (nameGroup) nameGroup.style.display = '';
            if (newnameGroup) newnameGroup.style.display = '';
            break;
        case 'list':
            if (remoteGroup) remoteGroup.style.display = '';
            break;
    }
}

// 更新暂存表单显示
function updateGitStashForm() {
    const action = document.getElementById('git-stash-action')?.value;
    const messageGroup = document.getElementById('git-stash-message-group');
    const indexGroup = document.getElementById('git-stash-index-group');

    if (!action) return;

    // 隐藏所有字段
    if (messageGroup) messageGroup.style.display = 'none';
    if (indexGroup) indexGroup.style.display = 'none';

    // 根据操作类型显示相应字段
    switch (action) {
        case 'save':
            if (messageGroup) messageGroup.style.display = '';
            break;
        case 'pop':
        case 'apply':
        case 'drop':
            if (indexGroup) indexGroup.style.display = '';
            break;
        // list 和 clear 不需要额外字段
    }
}

// 更新命令预览
function updateGitCommand() {
    const outputEl = document.getElementById('git-command-output');
    const descEl = document.getElementById('git-command-desc');

    if (!window.DogToolboxM26Utils) {
        if (outputEl) outputEl.value = '';
        if (descEl) descEl.textContent = '工具模块未加载';
        return;
    }

    try {
        let result = null;

        switch (currentGitScene) {
            case 'commit':
                result = generateCommitCmd();
                break;
            case 'branch':
                result = generateBranchCmd();
                break;
            case 'log':
                result = generateLogCmd();
                break;
            case 'reset':
                result = generateResetCmd();
                break;
            case 'clone':
                result = generateCloneCmd();
                break;
            case 'merge':
                result = generateMergeCmd();
                break;
            case 'stash':
                result = generateStashCmd();
                break;
        }

        if (result) {
            if (outputEl) outputEl.value = result.command || '';
            if (descEl) descEl.textContent = result.description || '';
        } else {
            if (outputEl) outputEl.value = '';
            if (descEl) descEl.textContent = '请填写必要参数';
        }
    } catch (e) {
        if (outputEl) outputEl.value = '';
        if (descEl) descEl.textContent = `错误：${e.message || String(e)}`;
    }
}

// 生成 Commit 命令
function generateCommitCmd() {
    const message = document.getElementById('git-commit-message')?.value.trim();

    // 验证必填字段
    if (!validateInput('git-commit-message', message)) {
        return null;
    }

    const options = {
        all: document.getElementById('git-commit-all')?.checked || false,
        amend: document.getElementById('git-commit-amend')?.checked || false,
        noVerify: document.getElementById('git-commit-noverify')?.checked || false
    };

    return DogToolboxM26Utils.generateCommitCommand(message, options);
}

// 生成 Branch 命令
function generateBranchCmd() {
    const action = document.getElementById('git-branch-action')?.value;
    const name = document.getElementById('git-branch-name')?.value.trim();

    if (action === 'list') {
        // list 操作不需要 name，清除错误样式
        clearValidationErrors(['git-branch-name']);
        const options = {
            remote: document.getElementById('git-branch-remote')?.checked || false
        };
        return DogToolboxM26Utils.generateBranchCommand(action, '', options);
    }

    // 其他操作需要验证 name
    if (!validateInput('git-branch-name', name)) {
        return null;
    }

    const options = {
        newName: document.getElementById('git-branch-newname')?.value.trim(),
        force: document.getElementById('git-branch-force')?.checked || false
    };

    return DogToolboxM26Utils.generateBranchCommand(action, name, options);
}

// 生成 Log 命令
function generateLogCmd() {
    const options = {
        oneline: document.getElementById('git-log-oneline')?.checked || false,
        graph: document.getElementById('git-log-graph')?.checked || false,
        maxCount: parseInt(document.getElementById('git-log-count')?.value) || null,
        author: document.getElementById('git-log-author')?.value.trim(),
        grep: document.getElementById('git-log-grep')?.value.trim()
    };

    return DogToolboxM26Utils.generateLogCommand(options);
}

// 生成 Reset 命令
function generateResetCmd() {
    const mode = document.getElementById('git-reset-mode')?.value || 'mixed';
    const ref = document.getElementById('git-reset-ref')?.value.trim();

    return DogToolboxM26Utils.generateResetCommand(mode, ref);
}

// 生成 Clone 命令
function generateCloneCmd() {
    const url = document.getElementById('git-clone-url')?.value.trim();

    // 验证必填字段
    if (!validateInput('git-clone-url', url)) {
        return null;
    }

    const options = {
        branch: document.getElementById('git-clone-branch')?.value.trim(),
        targetDir: document.getElementById('git-clone-dir')?.value.trim(),
        depth: parseInt(document.getElementById('git-clone-depth')?.value) || null,
        recursive: document.getElementById('git-clone-recursive')?.checked || false
    };

    return DogToolboxM26Utils.generateCloneCommand(url, options);
}

// 生成 Merge 命令
function generateMergeCmd() {
    const branch = document.getElementById('git-merge-branch')?.value.trim();

    // 验证必填字段
    if (!validateInput('git-merge-branch', branch)) {
        return null;
    }

    const options = {
        noFf: document.getElementById('git-merge-noff')?.checked || false,
        squash: document.getElementById('git-merge-squash')?.checked || false,
        message: document.getElementById('git-merge-message')?.value.trim()
    };

    return DogToolboxM26Utils.generateMergeCommand(branch, options);
}

// 生成 Stash 命令
function generateStashCmd() {
    const action = document.getElementById('git-stash-action')?.value;

    const options = {
        message: document.getElementById('git-stash-message')?.value.trim(),
        index: parseInt(document.getElementById('git-stash-index')?.value)
    };

    if (isNaN(options.index)) {
        options.index = undefined;
    }

    return DogToolboxM26Utils.generateStashCommand(action, options);
}

function copyGitCommand(btn) {
    const output = document.getElementById('git-command-output').value;
    if (!output) return;
    copyToolText(btn, output, { showTextFeedback: true });
}

// ==================== M27 Docker 命令生成器 ====================
let currentDockerScene = 'run';

function switchDockerScene(scene, evt) {
    currentDockerScene = scene;

    // 更新标签激活状态
    document.querySelectorAll('.tool-tab').forEach(tab => {
        tab.classList.remove('active');
    });
    if (evt?.target) {
        evt.target.classList.add('active');
    }

    // 更新场景显示
    document.querySelectorAll('.docker-scene').forEach(s => {
        s.classList.remove('active');
    });
    document.getElementById(`docker-scene-${scene}`)?.classList.add('active');

    // 重置面板过滤状态
    resetPanelFiltering('.docker-tool');

    // 更新命令
    updateDockerCommand();
}

function updateDockerComposeForm() {
    const action = document.getElementById('docker-compose-action')?.value;
    const serviceGroup = document.getElementById('docker-compose-service-group');
    const detachGroup = document.getElementById('docker-compose-detach-group');
    const volumesGroup = document.getElementById('docker-compose-volumes-group');

    if (!action) return;

    // 默认全部隐藏
    if (serviceGroup) serviceGroup.style.display = 'none';
    if (detachGroup) detachGroup.style.display = 'none';
    if (volumesGroup) volumesGroup.style.display = 'none';

    // 根据操作类型显示相应字段
    switch (action) {
        case 'up':
            if (detachGroup) detachGroup.style.display = '';
            if (serviceGroup) serviceGroup.style.display = '';
            break;
        case 'down':
            if (volumesGroup) volumesGroup.style.display = '';
            break;
        case 'start':
        case 'stop':
        case 'restart':
        case 'build':
        case 'pull':
            if (serviceGroup) serviceGroup.style.display = '';
            break;
        case 'logs':
        case 'exec':
            if (serviceGroup) serviceGroup.style.display = '';
            break;
    }
}

function updateDockerCommand() {
    const outputEl = document.getElementById('docker-command-output');
    const descEl = document.getElementById('docker-command-desc');

    if (!window.DogToolboxM27Utils) {
        if (outputEl) outputEl.value = '';
        if (descEl) descEl.textContent = '工具模块未加载';
        return;
    }

    try {
        let result = null;

        switch (currentDockerScene) {
            case 'run': result = generateRunCmd(); break;
            case 'build': result = generateBuildCmd(); break;
            case 'compose': result = generateComposeCmd(); break;
            case 'exec': result = generateExecCmd(); break;
            case 'logs': result = generateLogsCmd(); break;
            case 'ps': result = generatePsCmd(); break;
            case 'images': result = generateImagesCmd(); break;
            case 'container': result = generateContainerCmd(); break;
        }

        if (result) {
            if (outputEl) outputEl.value = result.command || '';
            if (descEl) descEl.textContent = result.description || '';
        } else {
            if (outputEl) outputEl.value = '';
            if (descEl) descEl.textContent = '请填写必要参数';
        }
    } catch (e) {
        if (outputEl) outputEl.value = '';
        if (descEl) descEl.textContent = `错误：${e.message || String(e)}`;
    }
}

function generateRunCmd() {
    const image = document.getElementById('docker-run-image')?.value.trim();

    // 验证必填字段
    if (!validateInput('docker-run-image', image)) {
        return null;
    }

    const options = {
        name: document.getElementById('docker-run-name')?.value.trim(),
        detach: document.getElementById('docker-run-detach')?.checked || false,
        interactive: document.getElementById('docker-run-interactive')?.checked || false,
        rm: document.getElementById('docker-run-rm')?.checked || false,
        network: document.getElementById('docker-run-network')?.value.trim(),
        restart: document.getElementById('docker-run-restart')?.value.trim(),
        memory: document.getElementById('docker-run-memory')?.value.trim(),
        cpus: document.getElementById('docker-run-cpus')?.value.trim(),
        command: document.getElementById('docker-run-command')?.value.trim()
    };

    // 解析端口映射
    const portsStr = document.getElementById('docker-run-ports')?.value.trim();
    if (portsStr) {
        options.ports = portsStr.split(',').map(p => p.trim()).filter(p => p);
    }

    // 解析卷挂载
    const volumesStr = document.getElementById('docker-run-volumes')?.value.trim();
    if (volumesStr) {
        options.volumes = volumesStr.split(',').map(v => v.trim()).filter(v => v);
    }

    // 解析环境变量
    const envStr = document.getElementById('docker-run-env')?.value.trim();
    if (envStr) {
        options.env = envStr.split(',').map(e => e.trim()).filter(e => e);
    }

    return DogToolboxM27Utils.generateRunCommand(image, options);
}

function generateBuildCmd() {
    const path = document.getElementById('docker-build-path')?.value.trim();
    const tag = document.getElementById('docker-build-tag')?.value.trim();

    // 验证必填字段
    const pathValid = validateInput('docker-build-path', path);
    const tagValid = validateInput('docker-build-tag', tag);

    if (!pathValid || !tagValid) {
        return null;
    }

    const options = {
        tag: tag,
        file: document.getElementById('docker-build-file')?.value.trim(),
        target: document.getElementById('docker-build-target')?.value.trim(),
        noCache: document.getElementById('docker-build-nocache')?.checked || false,
        pull: document.getElementById('docker-build-pull')?.checked || false
    };

    // 解析构建参数
    const argStr = document.getElementById('docker-build-arg')?.value.trim();
    if (argStr) {
        options.buildArg = argStr.split(',').map(a => a.trim()).filter(a => a);
    }

    return DogToolboxM27Utils.generateBuildCommand(path, options);
}

function generateComposeCmd() {
    const action = document.getElementById('docker-compose-action')?.value;
    if (!action) return null;

    const options = {
        file: document.getElementById('docker-compose-file')?.value.trim(),
        projectName: document.getElementById('docker-compose-project')?.value.trim(),
        service: document.getElementById('docker-compose-service')?.value.trim(),
        detach: document.getElementById('docker-compose-detach')?.checked || false,
        volumes: document.getElementById('docker-compose-volumes')?.checked || false
    };

    return DogToolboxM27Utils.generateComposeCommand(action, options);
}

function generateExecCmd() {
    const container = document.getElementById('docker-exec-container')?.value.trim();
    const command = document.getElementById('docker-exec-command')?.value.trim();

    // 验证必填字段
    const containerValid = validateInput('docker-exec-container', container);
    const commandValid = validateInput('docker-exec-command', command);

    if (!containerValid || !commandValid) {
        return null;
    }

    const options = {
        interactive: document.getElementById('docker-exec-interactive')?.checked || false,
        workdir: document.getElementById('docker-exec-workdir')?.value.trim(),
        user: document.getElementById('docker-exec-user')?.value.trim()
    };

    return DogToolboxM27Utils.generateExecCommand(container, command, options);
}

function generateLogsCmd() {
    const container = document.getElementById('docker-logs-container')?.value.trim();

    // 验证必填字段
    if (!validateInput('docker-logs-container', container)) {
        return null;
    }

    const options = {
        follow: document.getElementById('docker-logs-follow')?.checked || false,
        timestamps: document.getElementById('docker-logs-timestamps')?.checked || false,
        tail: document.getElementById('docker-logs-tail')?.value.trim(),
        since: document.getElementById('docker-logs-since')?.value.trim()
    };

    return DogToolboxM27Utils.generateLogsCommand(container, options);
}

function generatePsCmd() {
    const options = {
        all: document.getElementById('docker-ps-all')?.checked || false,
        quiet: document.getElementById('docker-ps-quiet')?.checked || false,
        filter: document.getElementById('docker-ps-filter')?.value.trim()
    };

    return DogToolboxM27Utils.generatePsCommand(options);
}

function generateImagesCmd() {
    const options = {
        all: document.getElementById('docker-images-all')?.checked || false,
        quiet: document.getElementById('docker-images-quiet')?.checked || false,
        filter: document.getElementById('docker-images-filter')?.value.trim()
    };

    return DogToolboxM27Utils.generateImagesCommand(options);
}

function generateContainerCmd() {
    const action = document.getElementById('docker-container-action')?.value;
    const namesStr = document.getElementById('docker-container-names')?.value.trim();

    if (!action || !namesStr) return null;

    const containers = namesStr.split(/\s+/).filter(n => n);
    if (containers.length === 0) return null;

    const options = {
        force: document.getElementById('docker-container-force')?.checked || false
    };

    return DogToolboxM27Utils.generateContainerCommand(action, containers, options);
}

function copyDockerCommand(btn) {
    const output = document.getElementById('docker-command-output').value;
    if (!output) return;
    copyToolText(btn, output, { showTextFeedback: true });
}


// ==================== M28 JSON Schema 生成 ====================
function clearJsonSchemaTool() {
    document.getElementById('jsonschema-input').value = '';
    document.getElementById('jsonschema-output').value = '';
    document.getElementById('jsonschema-errors').innerHTML = '';
}

function updateJsonSchemaTool() {
    const input = document.getElementById('jsonschema-input').value;
    const outputEl = document.getElementById('jsonschema-output');
    const errorsEl = document.getElementById('jsonschema-errors');
    const allRequiredEl = document.getElementById('jsonschema-all-required');
    const inferEnumEl = document.getElementById('jsonschema-infer-enum');

    errorsEl.innerHTML = '';

    if (!input.trim()) {
        outputEl.value = '';
        return;
    }

    const options = {
        allRequired: allRequiredEl?.checked ?? true,
        inferEnum: inferEnumEl?.checked ?? false
    };

    const result = DogToolboxM28Utils.generateSchema(input, options);

    if (result.error) {
        errorsEl.innerHTML = `<div class="error-message">错误：${escapeHtml(result.error)}</div>`;
        outputEl.value = '';
    } else {
        outputEl.value = JSON.stringify(result.schema, null, 2);
    }
}

function copyJsonSchemaOutput(btn) {
    const output = document.getElementById('jsonschema-output').value;
    if (!output) return;
    copyToolText(btn, output, { showTextFeedback: true });
}

function downloadJsonSchema() {
    const output = document.getElementById('jsonschema-output').value;
    if (!output) return;

    const blob = new Blob([output], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'schema.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

// ==================== M24 HTTP 请求测试 ====================
let httpBodyType = 'none';

function initHttpTool() {
    // 初始化默认请求头
    const headersEditor = document.getElementById('http-headers-editor');
    if (headersEditor) {
        headersEditor.innerHTML = `
            <div class="http-kv-row">
                <input type="text" placeholder="Header Name" class="http-kv-key" value="Content-Type">
                <input type="text" placeholder="Header Value" class="http-kv-value" value="application/json">
                <button class="btn btn-sm btn-ghost" onclick="removeHttpKvRow(this)">-</button>
            </div>
            <div class="http-kv-row">
                <input type="text" placeholder="Header Name" class="http-kv-key">
                <input type="text" placeholder="Header Value" class="http-kv-value">
                <button class="btn btn-sm btn-ghost" onclick="addHttpHeader()">+</button>
            </div>
        `;
    }
}

function clearHttpTool() {
    document.getElementById('http-url').value = '';
    document.getElementById('http-method').value = 'GET';
    document.getElementById('http-body-text').value = '';
    document.getElementById('http-response-body').value = '';
    document.getElementById('http-response-headers-text').value = '';
    document.getElementById('http-response-meta').innerHTML = '';
    document.getElementById('http-curl-input').value = '';

    // 重置参数和请求头
    const paramsEditor = document.getElementById('http-params-editor');
    if (paramsEditor) {
        paramsEditor.innerHTML = `
            <div class="http-kv-row">
                <input type="text" placeholder="Key" class="http-kv-key">
                <input type="text" placeholder="Value" class="http-kv-value">
                <button class="btn btn-sm btn-ghost" onclick="addHttpParam()">+</button>
            </div>
        `;
    }

    initHttpTool();
}

function switchHttpTab(tab) {
    // 切换标签激活状态
    document.querySelectorAll('.http-tabs .http-tab').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.tab === tab);
    });

    // 切换内容显示
    document.querySelectorAll('.http-request .http-tab-content').forEach(content => {
        content.classList.toggle('active', content.id === `http-tab-${tab}`);
    });
}

function switchHttpResponseTab(tab) {
    // 切换标签激活状态
    document.querySelectorAll('.http-response-tabs .http-tab').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.tab === tab);
    });

    // 切换内容显示
    document.querySelectorAll('.http-response-content .http-tab-content').forEach(content => {
        content.classList.toggle('active', content.id === `http-tab-${tab}`);
    });
}

function switchHttpBodyType(type) {
    httpBodyType = type;
    const editor = document.getElementById('http-body-editor');
    if (type === 'none') {
        editor.style.display = 'none';
    } else {
        editor.style.display = 'block';
    }
}

function addHttpParam() {
    const editor = document.getElementById('http-params-editor');
    const lastRow = editor.querySelector('.http-kv-row:last-child');
    const newRow = document.createElement('div');
    newRow.className = 'http-kv-row';
    newRow.innerHTML = `
        <input type="text" placeholder="Key" class="http-kv-key">
        <input type="text" placeholder="Value" class="http-kv-value">
        <button class="btn btn-sm btn-ghost" onclick="addHttpParam()">+</button>
    `;

    // 将最后一行的 + 按钮改为 - 按钮
    const lastBtn = lastRow.querySelector('button');
    lastBtn.textContent = '-';
    lastBtn.onclick = function() { removeHttpKvRow(this); };

    editor.appendChild(newRow);
}

function addHttpHeader() {
    const editor = document.getElementById('http-headers-editor');
    const lastRow = editor.querySelector('.http-kv-row:last-child');
    const newRow = document.createElement('div');
    newRow.className = 'http-kv-row';
    newRow.innerHTML = `
        <input type="text" placeholder="Header Name" class="http-kv-key">
        <input type="text" placeholder="Header Value" class="http-kv-value">
        <button class="btn btn-sm btn-ghost" onclick="addHttpHeader()">+</button>
    `;

    // 将最后一行的 + 按钮改为 - 按钮
    const lastBtn = lastRow.querySelector('button');
    lastBtn.textContent = '-';
    lastBtn.onclick = function() { removeHttpKvRow(this); };

    editor.appendChild(newRow);
}

function removeHttpKvRow(btn) {
    const row = btn.closest('.http-kv-row');
    row.remove();
}

function getHttpParams() {
    const params = {};
    document.querySelectorAll('#http-params-editor .http-kv-row').forEach(row => {
        const key = row.querySelector('.http-kv-key').value.trim();
        const value = row.querySelector('.http-kv-value').value.trim();
        if (key) {
            params[key] = value;
        }
    });
    return params;
}

function getHttpHeaders() {
    const headers = {};
    document.querySelectorAll('#http-headers-editor .http-kv-row').forEach(row => {
        const key = row.querySelector('.http-kv-key').value.trim();
        const value = row.querySelector('.http-kv-value').value.trim();
        if (key) {
            headers[key] = value;
        }
    });
    return headers;
}

async function sendHttpRequest() {
    const method = document.getElementById('http-method').value;
    const url = document.getElementById('http-url').value.trim();
    const responseBodyEl = document.getElementById('http-response-body');
    const responseHeadersEl = document.getElementById('http-response-headers-text');
    const responseMetaEl = document.getElementById('http-response-meta');

    if (!url) {
        responseBodyEl.value = '错误：请输入 URL';
        return;
    }

    try {
        // 构建完整 URL（带参数）
        const params = getHttpParams();
        const fullUrl = DogToolboxM24Utils.buildUrl(url, params);

        // 构建请求配置
        const config = {
            method: method,
            headers: getHttpHeaders()
        };

        // 添加请求体
        if (httpBodyType !== 'none' && (method === 'POST' || method === 'PUT' || method === 'PATCH')) {
            const body = document.getElementById('http-body-text').value;
            if (body) {
                config.body = body;
            }
        }

        // 发送请求
        responseMetaEl.innerHTML = '<span style="color: #666;">发送中...</span>';
        const startTime = Date.now();

        const response = await fetch(fullUrl, config);
        const endTime = Date.now();
        const duration = endTime - startTime;

        // 获取响应头
        const responseHeaders = {};
        response.headers.forEach((value, key) => {
            responseHeaders[key] = value;
        });

        // 获取响应体
        const contentType = response.headers.get('content-type') || '';
        let responseBody;

        if (contentType.includes('application/json')) {
            const json = await response.json();
            responseBody = JSON.stringify(json, null, 2);
        } else {
            responseBody = await response.text();
        }

        // 显示响应
        responseBodyEl.value = responseBody;
        responseHeadersEl.value = Object.keys(responseHeaders)
            .map(key => `${key}: ${responseHeaders[key]}`)
            .join('\n');

        // 显示元信息
        const statusColor = response.ok ? '#10b981' : '#ef4444';
        const size = new Blob([responseBody]).size;
        responseMetaEl.innerHTML = `
            <span style="color: ${statusColor}; font-weight: bold;">Status: ${response.status} ${response.statusText}</span>
            <span style="margin-left: 16px;">Time: ${DogToolboxM24Utils.formatResponseTime(duration)}</span>
            <span style="margin-left: 16px;">Size: ${DogToolboxM24Utils.formatResponseSize(size)}</span>
        `;

    } catch (e) {
        responseBodyEl.value = `错误：${e.message || String(e)}`;
        responseMetaEl.innerHTML = '<span style="color: #ef4444;">请求失败</span>';
    }
}

function importCurl() {
    const curlInput = document.getElementById('http-curl-input').value;
    if (!curlInput.trim()) return;

    const config = DogToolboxM24Utils.parseCurl(curlInput);

    if (config.error) {
        alert(config.error);
        return;
    }

    // 设置 URL 和方法
    document.getElementById('http-url').value = config.url;
    document.getElementById('http-method').value = config.method;

    // 设置请求头
    const headersEditor = document.getElementById('http-headers-editor');
    headersEditor.innerHTML = '';
    Object.keys(config.headers).forEach(key => {
        const row = document.createElement('div');
        row.className = 'http-kv-row';
        row.innerHTML = `
            <input type="text" placeholder="Header Name" class="http-kv-key" value="${escapeHtml(key)}">
            <input type="text" placeholder="Header Value" class="http-kv-value" value="${escapeHtml(config.headers[key])}">
            <button class="btn btn-sm btn-ghost" onclick="removeHttpKvRow(this)">-</button>
        `;
        headersEditor.appendChild(row);
    });

    // 添加空行
    const emptyRow = document.createElement('div');
    emptyRow.className = 'http-kv-row';
    emptyRow.innerHTML = `
        <input type="text" placeholder="Header Name" class="http-kv-key">
        <input type="text" placeholder="Header Value" class="http-kv-value">
        <button class="btn btn-sm btn-ghost" onclick="addHttpHeader()">+</button>
    `;
    headersEditor.appendChild(emptyRow);

    // 设置请求体
    if (config.body) {
        document.querySelector('input[name="http-body-type"][value="raw"]').checked = true;
        switchHttpBodyType('raw');
        document.getElementById('http-body-text').value = config.body;
    }

    alert('cURL 命令已导入');
}

function exportCurl() {
    const method = document.getElementById('http-method').value;
    const url = document.getElementById('http-url').value.trim();

    if (!url) {
        alert('请先输入 URL');
        return;
    }

    const params = getHttpParams();
    const fullUrl = DogToolboxM24Utils.buildUrl(url, params);

    const config = {
        method: method,
        url: fullUrl,
        headers: getHttpHeaders(),
        body: httpBodyType !== 'none' ? document.getElementById('http-body-text').value : ''
    };

    const curl = DogToolboxM24Utils.generateCurl(config);
    document.getElementById('http-curl-input').value = curl;

    // 切换到 cURL 标签
    switchHttpTab('curl');
}

// ==================== M25 WebSocket 测试 ====================
let wsConnection = null;
let wsMessages = [];
let wsAutoReconnect = false;
let wsReconnectTimer = null;

function initWebSocketTool() {
    // 初始化完成
}

function clearWebSocketTool() {
    if (wsConnection) {
        wsConnection.close();
        wsConnection = null;
    }
    document.getElementById('ws-url').value = '';
    document.getElementById('ws-message-input').value = '';
    clearWebSocketMessages();
    updateWebSocketStatus('未连接', 'disconnected');
}

function clearWebSocketMessages() {
    wsMessages = [];
    document.getElementById('ws-messages-list').innerHTML = '';
}

function updateWebSocketStatus(text, status) {
    const statusEl = document.getElementById('ws-status');
    const btnEl = document.getElementById('ws-connect-btn');

    statusEl.textContent = text;
    statusEl.className = `ws-status ws-status-${status}`;

    if (status === 'connected') {
        btnEl.textContent = '断开';
        btnEl.classList.remove('btn-primary');
        btnEl.classList.add('btn-danger');
    } else {
        btnEl.textContent = '连接';
        btnEl.classList.remove('btn-danger');
        btnEl.classList.add('btn-primary');
    }
}

function addWebSocketMessage(type, content) {
    const message = DogToolboxM25Utils.formatMessage(type, content);
    wsMessages.push(message);

    const messagesList = document.getElementById('ws-messages-list');
    const messageEl = document.createElement('div');
    messageEl.className = `ws-message ws-message-${type}`;

    const formatJson = document.getElementById('ws-format-json').checked;
    let displayContent = content;

    if (formatJson && type !== 'system') {
        displayContent = DogToolboxM25Utils.tryFormatJson(content);
    }

    messageEl.innerHTML = `
        <div class="ws-message-header">
            <span class="ws-message-type">${type === 'sent' ? '发送' : type === 'received' ? '接收' : '系统'}</span>
            <span class="ws-message-time">${message.timestamp}</span>
        </div>
        <div class="ws-message-content">${escapeHtml(displayContent)}</div>
    `;

    messagesList.appendChild(messageEl);
    messagesList.scrollTop = messagesList.scrollHeight;
}

function toggleWebSocketConnection() {
    if (wsConnection && wsConnection.readyState === WebSocket.OPEN) {
        // 断开连接
        wsAutoReconnect = false;
        wsConnection.close();
    } else {
        // 建立连接
        connectWebSocket();
    }
}

function connectWebSocket() {
    const url = document.getElementById('ws-url').value.trim();

    if (!url) {
        addWebSocketMessage('system', '错误：请输入 WebSocket URL');
        return;
    }

    if (!DogToolboxM25Utils.isValidWsUrl(url)) {
        addWebSocketMessage('system', '错误：无效的 WebSocket URL（必须以 ws:// 或 wss:// 开头）');
        return;
    }

    try {
        updateWebSocketStatus('连接中...', 'connecting');
        wsConnection = new WebSocket(url);
        wsAutoReconnect = document.getElementById('ws-auto-reconnect').checked;

        wsConnection.onopen = function() {
            updateWebSocketStatus('已连接', 'connected');
            addWebSocketMessage('system', `已连接到 ${url}`);

            if (wsReconnectTimer) {
                clearTimeout(wsReconnectTimer);
                wsReconnectTimer = null;
            }
        };

        wsConnection.onmessage = function(event) {
            addWebSocketMessage('received', event.data);
        };

        wsConnection.onerror = function(error) {
            addWebSocketMessage('system', '连接错误');
            updateWebSocketStatus('错误', 'error');
        };

        wsConnection.onclose = function(event) {
            updateWebSocketStatus('已断开', 'disconnected');
            addWebSocketMessage('system', `连接已关闭 (code: ${event.code})`);

            // 自动重连
            if (wsAutoReconnect && !wsReconnectTimer) {
                addWebSocketMessage('system', '5 秒后自动重连...');
                wsReconnectTimer = setTimeout(() => {
                    wsReconnectTimer = null;
                    connectWebSocket();
                }, 5000);
            }
        };

    } catch (e) {
        addWebSocketMessage('system', `连接失败：${e.message || String(e)}`);
        updateWebSocketStatus('失败', 'error');
    }
}

function sendWebSocketMessage() {
    if (!wsConnection || wsConnection.readyState !== WebSocket.OPEN) {
        addWebSocketMessage('system', '错误：未连接到 WebSocket 服务器');
        return;
    }

    const messageInput = document.getElementById('ws-message-input');
    const message = messageInput.value.trim();

    if (!message) {
        return;
    }

    const messageType = document.querySelector('input[name="ws-message-type"]:checked').value;

    try {
        let sendData = message;

        if (messageType === 'json') {
            // 验证 JSON 格式
            JSON.parse(message);
        }

        wsConnection.send(sendData);
        addWebSocketMessage('sent', sendData);
        messageInput.value = '';

    } catch (e) {
        addWebSocketMessage('system', `发送失败：${e.message || String(e)}`);
    }
}

function sendWebSocketPing() {
    if (!wsConnection || wsConnection.readyState !== WebSocket.OPEN) {
        addWebSocketMessage('system', '错误：未连接到 WebSocket 服务器');
        return;
    }

    try {
        wsConnection.send('ping');
        addWebSocketMessage('sent', 'ping');
    } catch (e) {
        addWebSocketMessage('system', `Ping 失败：${e.message || String(e)}`);
    }
}

// ==================== M29 Mock 数据生成 ====================
function clearMockTool() {
    document.getElementById('mock-output').value = '';
}

function generateMockData() {
    const type = document.getElementById('mock-type').value;
    const count = parseInt(document.getElementById('mock-count').value) || 10;
    const format = document.getElementById('mock-output-format')?.value || 'lines';
    const outputEl = document.getElementById('mock-output');

    const results = [];

    try {
        for (let i = 0; i < count; i++) {
            let value;
            switch (type) {
                case 'name':
                    value = DogToolboxM29Utils.randomName();
                    break;
                case 'email':
                    value = DogToolboxM29Utils.randomEmail();
                    break;
                case 'phone':
                    value = DogToolboxM29Utils.randomPhone();
                    break;
                case 'idcard':
                    value = DogToolboxM29Utils.randomIdCard();
                    break;
                case 'address':
                    value = DogToolboxM29Utils.randomAddress();
                    break;
                case 'uuid':
                    value = DogToolboxM29Utils.randomUuid();
                    break;
                case 'date':
                    value = DogToolboxM29Utils.randomDate();
                    break;
                default:
                    value = DogToolboxM29Utils.randomName();
            }
            results.push(value);
        }

        // 根据输出格式生成结果
        let output;
        switch (format) {
            case 'json':
                output = JSON.stringify(results, null, 2);
                break;
            case 'csv':
                output = results.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',\n');
                break;
            case 'jsonlines':
                output = results.map(v => JSON.stringify(v)).join('\n');
                break;
            case 'lines':
            default:
                output = results.join('\n');
        }

        outputEl.value = output;
    } catch (e) {
        outputEl.value = `错误：${e.message || String(e)}`;
    }
}

function copyMockOutput(btn) {
    const output = document.getElementById('mock-output').value;
    if (!output) {
        if (btn) {
            const orig = btn.textContent;
            btn.textContent = '无内容';
            btn.classList.add('btn-danger');
            setTimeout(() => { btn.textContent = orig; btn.classList.remove('btn-danger'); }, 1200);
        }
        return;
    }
    copyToolText(btn, output, { showTextFeedback: true });
}

// ==================== M30 数据脱敏 ====================
function clearMaskTool() {
    document.getElementById('mask-input').value = '';
    document.getElementById('mask-output').value = '';
}

function updateMaskTool() {
    const input = document.getElementById('mask-input').value;
    const type = document.getElementById('mask-type').value;
    const outputEl = document.getElementById('mask-output');
    const jsonFieldsGroup = document.getElementById('mask-json-fields-group');

    // 显示/隐藏 JSON 字段输入框
    if (jsonFieldsGroup) {
        jsonFieldsGroup.style.display = type === 'json' ? 'block' : 'none';
    }

    if (!input.trim()) {
        outputEl.value = '';
        return;
    }

    try {
        let result;
        if (type === 'auto') {
            result = DogToolboxM30Utils.smartMask(input);
        } else if (type === 'json') {
            // JSON 递归脱敏模式
            const jsonFieldsEl = document.getElementById('mask-json-fields');
            const customFields = jsonFieldsEl ? jsonFieldsEl.value.split(',').map(f => f.trim()).filter(Boolean) : [];
            const parsed = JSON.parse(input);
            const masked = DogToolboxM30Utils.maskJsonRecursive(parsed, customFields);
            result = JSON.stringify(masked, null, 2);
        } else {
            const lines = input.split('\n');
            const masked = lines.map(line => {
                if (!line.trim()) return line;
                switch (type) {
                    case 'phone':
                        return DogToolboxM30Utils.maskPhone(line.trim());
                    case 'idcard':
                        return DogToolboxM30Utils.maskIdCard(line.trim());
                    case 'email':
                        return DogToolboxM30Utils.maskEmail(line.trim());
                    case 'bankcard':
                        return DogToolboxM30Utils.maskBankCard(line.trim());
                    case 'name':
                        return DogToolboxM30Utils.maskName(line.trim());
                    case 'address':
                        return DogToolboxM30Utils.maskAddress(line.trim());
                    default:
                        return line;
                }
            });
            result = masked.join('\n');
        }
        outputEl.value = result;
    } catch (e) {
        outputEl.value = `错误：${e.message || String(e)}`;
    }
}

function copyMaskOutput(btn) {
    const output = document.getElementById('mask-output').value;
    if (!output) return;
    copyToolText(btn, output, { showTextFeedback: true });
}

// ==================== 工具箱：CSV 处理 (M23) ====================
let csvInputFormat = 'csv';
let csvOutputFormat = 'json';

function initCsvTool() {
    const inputEl = document.getElementById('csv-input');
    if (!inputEl) return;

    // Initialize state
    csvInputFormat = 'csv';
    csvOutputFormat = 'json';
    updateCsvToolUi();
}

function setCsvInputFormat(fmt) {
    if (fmt !== 'csv' && fmt !== 'json') return;
    csvInputFormat = fmt;
    updateCsvToolUi();
    updateCsvTool();
}

function setCsvOutputFormat(fmt) {
    if (fmt !== 'csv' && fmt !== 'json') return;
    csvOutputFormat = fmt;
    updateCsvToolUi();
    updateCsvTool();
}

function updateCsvToolUi() {
    document.getElementById('csv-in-csv')?.classList.toggle('active', csvInputFormat === 'csv');
    document.getElementById('csv-in-json')?.classList.toggle('active', csvInputFormat === 'json');
    document.getElementById('csv-out-csv')?.classList.toggle('active', csvOutputFormat === 'csv');
    document.getElementById('csv-out-json')?.classList.toggle('active', csvOutputFormat === 'json');
}

function updateCsvTool() {
    const inputEl = document.getElementById('csv-input');
    const outputEl = document.getElementById('csv-output');
    const errorsEl = document.getElementById('csv-errors');
    const delimiterEl = document.getElementById('csv-delimiter');
    const hasHeaderEl = document.getElementById('csv-has-header');

    if (!inputEl || !outputEl || !errorsEl) return;

    errorsEl.innerHTML = '';
    const input = inputEl.value;
    if (!input.trim()) {
        outputEl.value = '';
        return;
    }

    if (!window.DogToolboxM23Utils) {
        errorsEl.innerHTML = '<div>⚠ 工具模块未加载</div>';
        return;
    }

    try {
        const options = {
            delimiter: delimiterEl?.value || ',',
            hasHeader: hasHeaderEl?.checked ?? true
        };

        let data;
        // Parse input
        if (csvInputFormat === 'csv') {
            data = window.DogToolboxM23Utils.parseCSV(input, options);
        } else {
            data = JSON.parse(input);
        }

        // Generate output
        let output;
        if (csvOutputFormat === 'csv') {
            output = window.DogToolboxM23Utils.stringifyCSV(data, options);
        } else {
            output = JSON.stringify(data, null, 2);
        }

        outputEl.value = output;
    } catch (e) {
        const errorMsg = escapeHtml(e.message || String(e));
        errorsEl.innerHTML = `<div>⚠ ${errorMsg}</div>`;
    }
}

function clearCsvTool() {
    const inputEl = document.getElementById('csv-input');
    const outputEl = document.getElementById('csv-output');
    const errorsEl = document.getElementById('csv-errors');
    if (inputEl) inputEl.value = '';
    if (outputEl) outputEl.value = '';
    if (errorsEl) errorsEl.innerHTML = '';
}

function copyCsvOutput(btn) {
    const outputEl = document.getElementById('csv-output');
    copyToolText(btn, outputEl?.value || '', { showTextFeedback: true });
}

function detectCsvDelimiter() {
    const inputEl = document.getElementById('csv-input');
    const delimiterEl = document.getElementById('csv-delimiter');
    if (!inputEl || !delimiterEl || !window.DogToolboxM23Utils) return;

    const input = inputEl.value;
    if (!input.trim()) return;

    const detected = window.DogToolboxM23Utils.detectDelimiter(input);
    delimiterEl.value = detected;
    updateCsvTool();
}

// ==================== M22 Markdown 工具初始化 ====================
function initMarkdownTool() {
    const inputEl = document.getElementById('markdown-input');
    if (!inputEl) return;
    inputEl.addEventListener('input', updateMarkdownTool);
    updateMarkdownTool();
}

// ==================== 面板过滤功能 ====================
function initPanelFiltering(containerSelector) {
    const container = document.querySelector(containerSelector);
    if (!container) return;

    const panels = container.querySelectorAll('.converter-panel');
    let activePanel = null;

    panels.forEach(panel => {
        const header = panel.querySelector('.panel-header');
        if (!header) return;

        header.addEventListener('click', (e) => {
            // 如果点击的是按钮，不触发过滤
            if (e.target.closest('button')) return;

            // 如果点击的是当前激活的面板，显示所有面板
            if (activePanel === panel) {
                panels.forEach(p => {
                    p.classList.remove('panel-filtered');
                    const h = p.querySelector('.panel-header');
                    if (h) h.classList.remove('active-filter');
                });
                activePanel = null;
            } else {
                // 否则，只显示点击的面板
                panels.forEach(p => {
                    if (p === panel) {
                        p.classList.remove('panel-filtered');
                        const h = p.querySelector('.panel-header');
                        if (h) h.classList.add('active-filter');
                    } else {
                        p.classList.add('panel-filtered');
                        const h = p.querySelector('.panel-header');
                        if (h) h.classList.remove('active-filter');
                    }
                });
                activePanel = panel;
            }
        });
    });
}

function resetPanelFiltering(containerSelector) {
    const container = document.querySelector(containerSelector);
    if (!container) return;

    const panels = container.querySelectorAll('.converter-panel');
    panels.forEach(p => {
        p.classList.remove('panel-filtered');
        const h = p.querySelector('.panel-header');
        if (h) h.classList.remove('active-filter');
    });
}

// ==================== M26 Git 命令生成器初始化 ====================
function initGitTool() {
    // Git 工具使用场景切换和模板加载，无需额外初始化
    // 所有事件处理器已通过 onclick 绑定
    loadGitTemplates();
    initPanelFiltering('.git-tool');
}

// ==================== M27 Docker 命令生成器初始化 ====================
function initDockerTool() {
    // Docker 工具使用场景切换，无需额外初始化
    // 所有事件处理器已通过 onclick 绑定
    initPanelFiltering('.docker-tool');
}

// ==================== M28 JSON Schema 生成器初始化 ====================
function initJsonSchemaTool() {
    const inputEl = document.getElementById('json-schema-input');
    if (!inputEl) return;
    inputEl.addEventListener('input', updateJsonSchemaTool);
    updateJsonSchemaTool();
}

// ==================== M29 Mock 数据生成器初始化 ====================
function initMockTool() {
    // Mock 工具使用按钮触发，无需额外初始化
    // 所有事件处理器已通过 onclick 绑定
}

// ==================== M30 数据脱敏工具初始化 ====================
function initMaskTool() {
    const inputEl = document.getElementById('mask-input');
    if (!inputEl) return;
    inputEl.addEventListener('input', updateMaskTool);
    updateMaskTool();
}

// ==================== M35 二维码生成器 ====================
let qrcodeCanvas = null;
let qrcodeDataUrl = null;

function initQrcodeTool() {
    const inputEl = document.getElementById('qrcode-input');
    if (!inputEl) return;

    // 监听输入更新字节计数
    inputEl.addEventListener('input', () => {
        const text = inputEl.value;
        const bytes = new Blob([text]).size;
        document.getElementById('qrcode-byte-count').textContent = `${bytes} 字节`;
    });
}

function generateQrcode() {
    const text = document.getElementById('qrcode-input').value;
    if (!text) {
        showToast('请输入内容', 'warning');
        return;
    }

    const size = parseInt(document.getElementById('qrcode-size').value);
    const errorLevel = document.getElementById('qrcode-error-level').value;
    const darkColor = document.getElementById('qrcode-dark-color').value;
    const lightColor = document.getElementById('qrcode-light-color').value;

    const result = M35Utils.generate(text, {
        size,
        errorCorrectionLevel: errorLevel,
        darkColor,
        lightColor
    });

    if (result.error) {
        showToast(result.error, 'error');
        return;
    }

    qrcodeCanvas = result.canvas;
    qrcodeDataUrl = result.dataUrl;

    // 显示预览
    const preview = document.getElementById('qrcode-preview');
    preview.innerHTML = '';
    const img = document.createElement('img');
    img.src = qrcodeDataUrl;
    img.alt = '二维码';
    img.style.maxWidth = '100%';
    img.style.borderRadius = '8px';
    preview.appendChild(img);

    // 显示操作按钮
    document.getElementById('qrcode-actions').style.display = 'flex';
    showToast('二维码生成成功', 'success');
}

function downloadQrcode() {
    if (!qrcodeDataUrl) {
        showToast('请先生成二维码', 'warning');
        return;
    }
    M35Utils.download(qrcodeDataUrl, 'qrcode.png');
    showToast('下载成功', 'success');
}

async function copyQrcode() {
    if (!qrcodeCanvas) {
        showToast('请先生成二维码', 'warning');
        return;
    }
    const result = await M35Utils.copyToClipboard(qrcodeCanvas);
    if (result.error) {
        showToast(result.error, 'error');
    } else {
        showToast('已复制到剪贴板', 'success');
    }
}

function clearQrcodeTool() {
    document.getElementById('qrcode-input').value = '';
    document.getElementById('qrcode-byte-count').textContent = '0 字节';
    document.getElementById('qrcode-preview').innerHTML = `
        <div class="qrcode-placeholder">
            <span class="placeholder-icon">📱</span>
            <span class="placeholder-text">二维码将显示在这里</span>
        </div>
    `;
    document.getElementById('qrcode-actions').style.display = 'none';
    qrcodeCanvas = null;
    qrcodeDataUrl = null;
}
