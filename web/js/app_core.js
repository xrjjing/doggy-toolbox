/*
==================== 性能瓶颈与优化建议（文档区，不影响运行逻辑） ====================

现状（以当前仓库文件为准）：
- web/index.html 已壳化（约 600 行），各页面片段拆分至 web/pages/*.html。
- 前端主逻辑已拆分至 web/js/app_*.js（原 web/app.js 保留为兼容占位）。
- 页面切换时按需 fetch 注入页面片段，并缓存 HTML，避免首次解析超大 DOM。
- waitForPywebview() 在“非 pywebview 环境”不再阻塞首屏，仅监听就绪事件。

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
3) 迁移为 ESM：index.html 只保留一个入口（type="module"），工具模块通过 import() 动态加载并按页分包。
4) CDN 依赖（js-yaml/fast-xml-parser）：
   - 若运行环境允许外网：按需加载（首次使用该工具再加载）；
   - 若外网不稳定/离线：本地化 vendor 并打包进构建产物，避免首屏卡在网络。
5) 页面拆分（已实现）：各工具页面为独立片段文件，首次访问 fetch 注入并缓存，降低初始 DOM 体积。
*/

// 脚本加载标记（供开机自检使用）
window.__DOG_TOOLBOX_CORE_LOADED__ = true;

// ==================== 模块加载错误边界 ====================

function showJsRuntimeErrorBanner(error, extraTitle = '') {
    const banner = document.getElementById('global-error-banner');
    const textEl = document.getElementById('error-banner-text');
    if (!banner || !textEl) return;

    const title = extraTitle ? `前端运行错误：${extraTitle}` : '前端运行错误';
    const msg = error?.message ? String(error.message) : String(error);
    const stack = error?.stack ? String(error.stack) : '';
    const safeMsg = escapeHtml(msg);
    const safeStack = escapeHtml(stack);

    banner.dataset.bannerKind = 'js-runtime-error';
    textEl.innerHTML = `
        <strong>${escapeHtml(title)}</strong><br>
        <div style="margin-top:6px">错误：${safeMsg}</div>
        ${stack ? `<details style="margin-top:8px;opacity:0.95"><summary>展开堆栈</summary><pre style="white-space:pre-wrap;margin:8px 0 0">${safeStack}</pre></details>` : ''}
        <div style="margin-top:8px;opacity:0.85">提示：如果你看到的是“xxx is not defined”，通常意味着某个脚本未加载成功或初始化顺序异常。</div>
    `;
    banner.style.display = 'block';
}

// 捕获未处理异常：避免用户只看到“按钮没反应”
window.addEventListener('error', (event) => {
    // script load error（例如 404）会是 event.target 有 src/href
    const target = event?.target;
    const src = target && (target.src || target.href);
    if (src) {
        showJsRuntimeErrorBanner(new Error(`资源加载失败：${src}`), '资源加载失败');
        return;
    }
    if (event?.error) {
        showJsRuntimeErrorBanner(event.error, 'window.error');
    }
});

window.addEventListener('unhandledrejection', (event) => {
    const reason = event?.reason instanceof Error ? event.reason : new Error(String(event?.reason ?? 'Promise rejection'));
    showJsRuntimeErrorBanner(reason, 'unhandledrejection');
});

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
    'tool-data-convert': 'DogToolboxM14Utils',
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

function showBackendNotReadyBanner() {
    const banner = document.getElementById('global-error-banner');
    const textEl = document.getElementById('error-banner-text');
    if (!banner || !textEl) return;

    banner.dataset.bannerKind = 'backend-not-ready';
    textEl.innerHTML = `
        <strong>后端接口尚未就绪</strong>，部分功能（新增/导入/导出等）可能暂不可用。<br>
        如果这是桌面应用启动过程：请稍候 1-2 秒，系统会在就绪后自动刷新当前页面。<br>
        如果你是在浏览器直接打开 <code>web/index.html</code>：这是预期行为（没有 pywebview 后端）。
    `;
    banner.style.display = 'block';
}

function checkCriticalGlobals() {
    // 这些函数缺失会导致“按钮点了没反应”但用户看不到控制台错误
    const required = [
        'openModal',
        'closeModal',
        'escapeHtml',
        'showCredentialModal',
        'showImportModal',
        'saveCredential',
        'exportBackup',
        'importBackup',
    ];
    const missing = required.filter(name => typeof globalThis[name] !== 'function');
    if (missing.length === 0) return;
    showJsRuntimeErrorBanner(
        new Error(`关键函数缺失：${missing.join(', ')}`),
        '关键脚本未加载或初始化失败'
    );
}

// 启动加载遮罩：在关键初始化完成后关闭
function hideAppLoading() {
    // 加载动画已移除，保留函数以兼容调用
    document.documentElement.classList.remove('is-booting');
}

// ==================== 窗口控制 ====================
function windowClose() {
    if (window.pywebview && window.pywebview.api) {
        _pywebviewReady = true;
        window.pywebview.api.window_close();
    }
}

function windowMinimize() {
    if (window.pywebview && window.pywebview.api) {
        _pywebviewReady = true;
        window.pywebview.api.window_minimize();
    }
}

function windowMaximize() {
    if (window.pywebview && window.pywebview.api) {
        _pywebviewReady = true;
        window.pywebview.api.window_toggle_fullscreen();
    }
}

// 页面懒初始化：按需初始化工具页，避免启动时初始化全部工具
const PAGE_INIT_MAP = Object.freeze({
    // 重要：这里必须使用“函数名字符串”，避免在拆分为多文件后提前引用未定义标识符导致脚本直接报错。
    'tool-base64': 'initBase64Tool',
    'tool-uuid': 'initUuidTool',
    'tool-hash': 'initHashTool',
    'tool-crypto': 'initCryptoTool',
    'tool-b64hex': 'initB64HexTool',
    'tool-diff': 'initDiffTool',
    'tool-jwt': 'initJwtTool',
    'tool-time': 'initTimeTool',
    'tool-naming': 'initNamingTool',
    'tool-url': 'initUrlTool',
    'tool-radix': 'initRadixTool',
    'tool-unicode': 'initUnicodeTool',
    'tool-charcount': 'initCharCountTool',
    'tool-password': 'initPasswordTool',
    'tool-hmac': 'initHmacTool',
    'tool-rsa': 'initRsaTool',
    'tool-json': 'initJsonTool',
    'tool-data-convert': 'initDataConvertTool',
    'tool-text': 'initTextTool',
    'tool-regex': 'initRegexTool',
    'tool-curl': 'initCurlTool',
    'tool-color': 'initColorTool',
    'tool-ip': 'initIpTool',
    'tool-cron': 'initCronTool',
    'tool-sql': 'initSqlTool',
    'tool-csv': 'initCsvTool',
    'tool-markdown': 'initMarkdownTool',
    'tool-datecalc': 'initDateCalcTool',
    'tool-git': 'initGitTool',
    'tool-docker': 'initDockerTool',
    'tool-json-schema': 'initJsonSchemaTool',
    'tool-http': 'initHttpTool',
    'tool-websocket': 'initWebSocketTool',
    'tool-mock': 'initMockTool',
    'tool-mask': 'initMaskTool',
    'tool-qrcode': 'initQrcodeTool',
    'tool-html-entity': 'initHtmlEntityTool',
    'tool-img-base64': 'initImgBase64Tool',
    'tool-text-sort': 'initTextSortTool',
    'tool-toml': 'initTomlTool',
    'tool-ua': 'initUATool',
    'tool-jsonpath': 'initJsonPathTool',
    'tool-nginx': 'initNginxTool',
});

async function ensurePageInitialized(page) {
    const initFnName = PAGE_INIT_MAP[page];
    if (!initFnName) return;
    if (initializedPages.has(page)) return;

    const pending = initializingPages.get(page);
    if (pending) return pending;

    const task = (async () => {
        try {
            const initFn = globalThis[initFnName];
            if (typeof initFn !== 'function') {
                console.warn(`页面初始化函数未找到或不是函数: ${page} -> ${initFnName}`);
                return;
            }
            await initFn();
            initializedPages.add(page);
        } finally {
            initializingPages.delete(page);
        }
    })();

    initializingPages.set(page, task);
    return task;
}

// ==================== 页面片段按需注入（拆分 index.html） ====================
async function ensurePageDom(page) {
    if (!page) return;
    const pageId = `page-${page}`;
    if (document.getElementById(pageId)) {
        pageDomLoaded.add(page);
        return;
    }

    const root = document.getElementById('page-root');
    if (!root) {
        console.error('找不到页面容器 #page-root，无法加载页面:', page);
        return;
    }

    try {
        let html = pageHtmlCache.get(page);
        if (!html) {
            const res = await fetch(`pages/${page}.html`, { cache: 'no-cache' });
            if (!res.ok) {
                throw new Error(`HTTP ${res.status} ${res.statusText}`);
            }
            html = await res.text();
            pageHtmlCache.set(page, html);
        }

        const tpl = document.createElement('template');
        tpl.innerHTML = html;
        root.appendChild(tpl.content);

        if (!document.getElementById(pageId)) {
            throw new Error(`页面片段已注入，但未找到元素 #${pageId}`);
        }
        pageDomLoaded.add(page);
    } catch (e) {
        console.error('页面片段加载失败:', page, e);
        showPageLoadError(page, e);
    }
}

function showPageLoadError(page, error) {
    const banner = document.getElementById('global-error-banner');
    const textEl = document.getElementById('error-banner-text');
    if (!banner || !textEl) return;

    const safePage = escapeHtml(String(page || 'unknown'));
    const safeErr = escapeHtml(error?.message ? String(error.message) : String(error));
    textEl.innerHTML = `
        <strong>页面加载失败</strong>：${safePage}<br>
        错误：${safeErr}<br>
        <span style="opacity:0.85">提示：本项目已启用“页面片段拆分”，需要 pywebview 以本地 HTTP 服务模式运行。</span>
    `;
    banner.style.display = 'block';

    const navItem = document.querySelector(`.nav-item[data-page="${page}"]`);
    if (navItem) {
        navItem.style.opacity = '0.5';
        navItem.style.cursor = 'not-allowed';
        navItem.title = '页面加载失败，暂不可用';
    }
}

// 初始化
document.addEventListener('DOMContentLoaded', async () => {
    try {
        checkCriticalGlobals();

        // 快捷诊断：Ctrl/Cmd + Shift + D 弹出运行信息（后端就绪后可用）
        document.addEventListener('keydown', async (e) => {
            const isMac = navigator.platform && /mac/i.test(navigator.platform);
            const cmdOrCtrl = isMac ? e.metaKey : e.ctrlKey;
            if (!cmdOrCtrl || !e.shiftKey || (e.key || '').toLowerCase() !== 'd') return;
            e.preventDefault();
            try {
                if (globalThis.__dogToolboxRuntimeInfo) {
                    alert(JSON.stringify(globalThis.__dogToolboxRuntimeInfo, null, 2));
                    return;
                }
                if (window.pywebview && window.pywebview.api && typeof window.pywebview.api.get_runtime_info === 'function') {
                    const info = await window.pywebview.api.get_runtime_info();
                    globalThis.__dogToolboxRuntimeInfo = info;
                    alert(JSON.stringify(info, null, 2));
                    return;
                }
                alert('后端尚未就绪，无法获取运行信息。');
            } catch (err) {
                showJsRuntimeErrorBanner(err, '运行诊断失败');
            }
        }, { passive: false });

        // 快捷诊断：Ctrl/Cmd + Shift + P 逐页面自检（验证 pages/*.html 是否可加载）
        document.addEventListener('keydown', async (e) => {
            const isMac = navigator.platform && /mac/i.test(navigator.platform);
            const cmdOrCtrl = isMac ? e.metaKey : e.ctrlKey;
            if (!cmdOrCtrl || !e.shiftKey || (e.key || '').toLowerCase() !== 'p') return;
            e.preventDefault();
            try {
                const report = await runPagesIntegrityCheck();
                alert(report);
            } catch (err) {
                showJsRuntimeErrorBanner(err, '页面自检失败');
            }
        }, { passive: false });

        // 🔴 首先检测模块加载情况（错误边界）
        checkModuleLoading();

        // 🎨 关键：先让浏览器绘制一次,确保加载动画可见
        await new Promise(resolve => requestAnimationFrame(resolve));

        // 导航初始化不依赖后端，可以先执行
        initNavigation();

        // ✅ 关键修复：必须先等待 pywebview 就绪，再执行依赖后端的初始化
        // 打包环境下 pywebviewready 事件通常在 DOMContentLoaded 之后才触发
        // 如果不等待，initTheme/initGlassMode/loadCredentials 等会因 API 未就绪而失败
        const pywebviewReady = await waitForPywebview({ timeoutMs: 15000 });
        if (!pywebviewReady) {
            showBackendNotReadyBanner();
        }

        // 现在 pywebview 已就绪（或超时），执行依赖后端的初始化
        await initTheme();
        await initGlassMode();
        await initTitlebarMode();
        initShortcut();
        // 页面片段按需加载：默认进入"密码管理"
        await switchPage('credentials');
    } finally {
        hideAppLoading();
    }
});

async function runPagesIntegrityCheck() {
    const pages = Array.from(document.querySelectorAll('.nav-item[data-page]'))
        .map(el => el.getAttribute('data-page'))
        .filter(Boolean);

    const uniquePages = Array.from(new Set(pages));
    if (uniquePages.length === 0) {
        return '未发现任何 data-page 导航项，无法自检。';
    }

    const lines = [];
    lines.push(`页面自检（共 ${uniquePages.length} 个）`);
    lines.push(`当前 location: ${String(location.href)}`);
    lines.push(`pywebview: ${!!(window.pywebview && window.pywebview.api)}`);
    lines.push('');

    for (const page of uniquePages) {
        const url = `pages/${page}.html`;
        try {
            const res = await fetch(url, { cache: 'no-cache' });
            if (!res.ok) {
                lines.push(`✗ ${page}: HTTP ${res.status} ${res.statusText} (${url})`);
                continue;
            }
            const html = await res.text();
            const expectedId = `page-${page}`;
            if (!html.includes(`id="${expectedId}"`) && !html.includes(`id='${expectedId}'`)) {
                lines.push(`⚠ ${page}: 可加载，但未发现 ${expectedId}（可能页面片段内容不匹配）`);
                continue;
            }
            lines.push(`✓ ${page}: OK`);
        } catch (e) {
            lines.push(`✗ ${page}: fetch 失败 (${url})，原因：${e?.message || String(e)}`);
        }
    }

    return lines.join('\n');
}

let _pywebviewReadyListenerInstalled = false;
let _pywebviewReadyHandledOnce = false;

async function _handlePywebviewBecameReady() {
    if (_pywebviewReadyHandledOnce) return;
    _pywebviewReadyHandledOnce = true;

    // pywebview 就绪后再同步一次后端配置（主题/毛玻璃/标题栏等）
    syncSettingsFromBackend().catch(() => {});

    // 如果顶部横幅是“后端未就绪”，则自动关闭（避免误导用户）
    const banner = document.getElementById('global-error-banner');
    if (banner?.dataset?.bannerKind === 'backend-not-ready') {
        closeErrorBanner();
    }

    // 如果此前因为“后端未就绪”导致页面数据没加载，这里补一次刷新
    // 说明：handlePageEnter 内部已做 try/catch，不会影响整体运行
    if (activePage) {
        try {
            await handlePageEnter(activePage);
        } catch (e) {
            console.error('pywebview 就绪后补刷新失败:', e);
        }
    }

    // 轻量诊断：将后端选中的数据路径与统计打到全局，便于用户/开发者定位
    try {
        if (window.pywebview && window.pywebview.api && typeof window.pywebview.api.get_runtime_info === 'function') {
            globalThis.__dogToolboxRuntimeInfo = await window.pywebview.api.get_runtime_info();
        }
    } catch (e) {
        console.warn('获取运行信息失败:', e);
    }
}

function waitForPywebview({ timeoutMs = 3500 } = {}) {
    return new Promise(resolve => {
        if (window.pywebview && window.pywebview.api) {
            _pywebviewReady = true;
            _handlePywebviewBecameReady().catch(() => {});
            resolve(true);
            return;
        }

        // 安装一次性的全局监听：用于“超时后仍继续初始化”的兜底补刷新
        if (!_pywebviewReadyListenerInstalled) {
            _pywebviewReadyListenerInstalled = true;
            window.addEventListener('pywebviewready', () => {
                _pywebviewReady = true;
                _handlePywebviewBecameReady().catch(() => {});
            });
        }

        // 双保险：
        // 1) 监听 pywebviewready 事件
        // 2) 轮询 window.pywebview.api（某些环境下事件可能不触发或被错过）
        const startedAt = Date.now();
        const timer = setTimeout(() => {
            clearInterval(poll);
            resolve(false);
        }, timeoutMs);

        const poll = setInterval(() => {
            if (window.pywebview && window.pywebview.api) {
                clearTimeout(timer);
                clearInterval(poll);
                _pywebviewReady = true;
                _handlePywebviewBecameReady().catch(() => {});
                resolve(true);
            } else if (Date.now() - startedAt > timeoutMs) {
                // 兜底：理论上 timer 会处理，这里只防止极端情况下 interval 不清
                clearInterval(poll);
            }
        }, 50);

        // 如果在 timeout 之前就绪，提前 resolve
        window.addEventListener('pywebviewready', () => {
            clearTimeout(timer);
            clearInterval(poll);
            resolve(true);
        }, { once: true });
    });
}

// 同步后端配置：优先使用 localStorage（用户当前选择），否则使用后端保存值
async function syncSettingsFromBackend() {
    if (!window.pywebview || !window.pywebview.api) return;

    // 主题
    try {
        const backendTheme = await window.pywebview.api.get_theme();
        const localTheme = localStorage.getItem('theme');
        const finalTheme = localTheme || backendTheme || 'dark';
        setTheme(finalTheme, false);
        if (localTheme && backendTheme && localTheme !== backendTheme) {
            window.pywebview.api.save_theme(localTheme).catch(() => {});
        }
    } catch {}

    // 毛玻璃开关
    try {
        const backendGlass = await window.pywebview.api.get_glass_mode();
        const localGlass = localStorage.getItem('glass_mode');
        const finalGlass = localGlass != null ? (localGlass === 'true') : !!backendGlass;
        setGlassMode(finalGlass, false);
        if (localGlass != null && finalGlass !== !!backendGlass) {
            window.pywebview.api.save_glass_mode(finalGlass).catch(() => {});
        }
    } catch {}

    // 毛玻璃透明度
    try {
        const backendOpacity = await window.pywebview.api.get_glass_opacity();
        const localOpacityRaw = localStorage.getItem('glass_opacity');
        const localOpacity = localOpacityRaw != null ? parseInt(localOpacityRaw, 10) : null;
        const finalOpacity = Number.isFinite(localOpacity) ? localOpacity : backendOpacity;
        const slider = document.getElementById('glassOpacitySlider');
        if (slider) slider.value = finalOpacity;
        const valueDisplay = document.getElementById('opacityValue');
        if (valueDisplay) valueDisplay.textContent = finalOpacity + '%';
        document.documentElement.style.setProperty('--glass-opacity', finalOpacity / 100);
        localStorage.setItem('glass_opacity', String(finalOpacity));
        if (localOpacity != null && finalOpacity !== backendOpacity) {
            window.pywebview.api.save_glass_opacity(finalOpacity).catch(() => {});
        }
    } catch {}

    // 标题栏模式
    try {
        const backendMode = await window.pywebview.api.get_titlebar_mode();
        const localMode = localStorage.getItem('titlebar_mode');
        const finalMode = localMode || backendMode || 'fixed';
        setTitlebarMode(finalMode, false);
        if (localMode && backendMode && localMode !== backendMode) {
            window.pywebview.api.save_titlebar_mode(localMode).catch(() => {});
        }
    } catch {}
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

async function switchPage(page) {
    if (!page) return;
    await ensurePageDom(page);
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
    await handlePageEnter(page);
}

async function handlePageEnter(page) {
    try {
        // 业务页面：进入时加载数据（避免启动时访问不存在的 DOM）
        if (page === 'credentials') {
            await loadCredentials();
        }
        if (page === 'commands') {
            await loadTabs();
            await loadCommands();
        }
        if (page === 'nodes') {
            await loadNodes();
        }
        if (page === 'converter') {
            initConverterOutput();
        }

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

async function initTheme() {
    // 优先从后端获取主题，回退到 localStorage
    let savedTheme = 'dark';
    try {
        if (window.pywebview && window.pywebview.api && typeof window.pywebview.api.get_theme === 'function') {
            savedTheme = await window.pywebview.api.get_theme();
        } else {
            savedTheme = localStorage.getItem('theme') || 'dark';
        }
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
        if (window.pywebview && window.pywebview.api) {
            window.pywebview.api.save_theme(theme).catch(() => {});
        }
    }
}

function updateThemeIcon(theme) {
    const iconEl = document.getElementById('currentThemeIcon');
    if (iconEl && THEME_ICONS[theme]) {
        iconEl.textContent = THEME_ICONS[theme];
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
        if (window.pywebview && window.pywebview.api && typeof window.pywebview.api.get_glass_mode === 'function') {
            enabled = await window.pywebview.api.get_glass_mode();
        } else {
            enabled = localStorage.getItem('glass_mode') === 'true';
        }
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
        if (window.pywebview && window.pywebview.api) {
            window.pywebview.api.save_glass_mode(enabled).catch(() => {});
        }
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
    if (window.pywebview && window.pywebview.api) {
        window.pywebview.api.save_glass_opacity(parseInt(value)).catch(() => {});
    }
}

// 加载毛玻璃透明度
async function loadGlassOpacity() {
    let opacity = 60;
    try {
        if (window.pywebview && window.pywebview.api && typeof window.pywebview.api.get_glass_opacity === 'function') {
            opacity = await window.pywebview.api.get_glass_opacity();
        } else {
            opacity = parseInt(localStorage.getItem('glass_opacity') || '60');
        }
    } catch {
        opacity = parseInt(localStorage.getItem('glass_opacity') || '60');
    }
    const slider = document.getElementById('glassOpacitySlider');
    if (slider) slider.value = opacity;
    const valueDisplay = document.getElementById('opacityValue');
    if (valueDisplay) valueDisplay.textContent = opacity + '%';
    document.documentElement.style.setProperty('--glass-opacity', opacity / 100);
}

// ==================== 标题栏模式 ====================
async function initTitlebarMode() {
    let mode = 'fixed';
    try {
        if (window.pywebview && window.pywebview.api && typeof window.pywebview.api.get_titlebar_mode === 'function') {
            mode = await window.pywebview.api.get_titlebar_mode();
        } else {
            mode = localStorage.getItem('titlebar_mode') || 'fixed';
        }
    } catch {
        mode = localStorage.getItem('titlebar_mode') || 'fixed';
    }
    setTitlebarMode(mode, false);
}

function setTitlebarMode(mode, save = true) {
    document.documentElement.setAttribute('data-titlebar-mode', mode);
    localStorage.setItem('titlebar_mode', mode);
    // 更新按钮状态
    document.querySelectorAll('.titlebar-mode-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.mode === mode);
    });
    if (save && window.pywebview && window.pywebview.api) {
        _pywebviewReady = true;
        window.pywebview.api.save_titlebar_mode(mode).catch(() => {});
    }
}

// ==================== 诊断面板快捷键 ====================
function initShortcut() {
    document.addEventListener('keydown', function(e) {
        if (e.repeat) return;
        const isMac = /mac/i.test(navigator.platform);
        const cmdOrCtrl = isMac ? e.metaKey : e.ctrlKey;
        // Ctrl/Cmd + Shift + B
        if (cmdOrCtrl && e.shiftKey && !e.altKey && e.key.toLowerCase() === 'b') {
            e.preventDefault();
            toggleDiagnosticsPanel();
        }
    });
}

function toggleDiagnosticsPanel() {
    let panel = document.getElementById('boot-diagnostics');
    // 如果面板不存在，创建它
    if (!panel) {
        panel = document.createElement('div');
        panel.id = 'boot-diagnostics';
        panel.className = 'hidden';
        panel.innerHTML = [
            '<div class="title">开机自检 <span style="font-size:11px;opacity:0.7">(Ctrl/Cmd+Shift+B)</span></div>',
            '<div class="row" id="boot-row-1">DOM 已就绪</div>',
            '<div class="row" id="boot-row-2">pywebview: ' + (!!(window.pywebview && window.pywebview.api)) + '</div>',
            '<div class="row" id="boot-row-3">app_state: ' + (!!window.__DOG_TOOLBOX_STATE_LOADED__) + ' / app_core: ' + (!!window.__DOG_TOOLBOX_CORE_LOADED__) + '</div>',
            '<div class="row" id="boot-row-4"></div>',
            '<div class="btns">',
            '  <button id="boot-copy">复制信息</button>',
            '  <button id="boot-hide">隐藏</button>',
            '</div>',
            '<div class="hint">如果主脚本没跑起来，这里会显示"缺失/资源失败"。</div>',
        ].join('');
        document.body.appendChild(panel);
        panel.querySelector('#boot-hide').addEventListener('click', function() {
            panel.classList.add('hidden');
        });
        panel.querySelector('#boot-copy').addEventListener('click', function() {
            const text = [
                document.getElementById('boot-row-1')?.textContent || '',
                document.getElementById('boot-row-2')?.textContent || '',
                document.getElementById('boot-row-3')?.textContent || '',
                document.getElementById('boot-row-4')?.textContent || '',
                'location: ' + String(location.href),
            ].join('\n');
            try {
                navigator.clipboard?.writeText?.(text);
            } catch (e) {}
            alert(text);
        });
    }
    panel.classList.toggle('hidden');
}

// ==================== Toast 通知 ====================
const TOAST_ICONS = {
    success: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>',
    error: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>',
    warning: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
    info: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>'
};

function getToastContainer() {
    let container = document.getElementById('toast-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'toast-container';
        container.className = 'toast-container';
        document.body.appendChild(container);
    }
    return container;
}

function showToast(message, type = 'info', duration = 3000) {
    const container = getToastContainer();
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.innerHTML = `
        <span class="toast-icon">${TOAST_ICONS[type] || TOAST_ICONS.info}</span>
        <span class="toast-message">${escapeHtml(message)}</span>
    `;
    container.appendChild(toast);

    setTimeout(() => {
        toast.classList.add('toast-out');
        toast.addEventListener('animationend', () => toast.remove());
    }, duration);
}
