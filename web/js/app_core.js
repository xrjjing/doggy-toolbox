/*
 * 文件总览：前端壳层主入口。
 *
 * 这个文件负责把拆分后的页面和各模块脚本真正串起来，核心职责包括：
 * - 处理页面切换、导航高亮和页面片段按需加载；
 * - 管理 pywebview 就绪检测、前端运行错误提示、窗口控制、主题/设置同步；
 * - 在进入不同页面时，调用对应模块的 initXxx() 入口完成首屏或懒初始化。
 *
 * 调用链大致是：
 * index.html -> app_state.js -> app_core.js -> 根据 pageId 调用 app_computer_usage.js / app_tools_*.js / app_ai_*.js 中的初始化函数。
 *
 * 排查建议：
 * - 页面切不过去、切页后空白、导航状态不对：优先看 switchPage()、ensurePageDom()、ensurePageInitialized()；
 * - pywebview API 一直不可用：优先看 waitForPywebview() 和 _handlePywebviewBecameReady()；
 * - 页面片段加载失败或按钮完全没反应：先看这里的错误边界和页面加载逻辑。
 */

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
// 诊断面板会用它确认 app_core.js 本身是否已成功加载执行。
window.__DOG_TOOLBOX_CORE_LOADED__ = true;

// 开发模式前端自动刷新状态：
// - 由后端维护“资源版本号”，并在文件变更时主动推送事件；
// - 前端在 pywebview 就绪后安装监听、显示开发模式标记；
// - 发现版本变化时整页刷新，避免每次改前端都重启整个 GUI。
const FRONTEND_RELOAD_EVENT_NAME = 'doggy:frontend-reload';
let frontendReloadVersion = null;
let frontendHotReloadEnabled = false;
let frontendHotReloadBridgeStarted = false;

// 毛玻璃透明度映射：用户设置值 -> 实际 CSS 值（幂函数让高值更不透明）
function mapGlassOpacity(percent) {
    return Math.pow(percent / 100, 0.65);
}

// ==================== 模块加载错误边界 ====================
// 这里负责把“脚本报错/资源没加载/Promise 未处理异常”转成可见提示，避免用户只感知为按钮无反应。

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

// 页面到工具 utils 模块的映射表：
// 用于开机自检时判断“某个工具为什么点开后没反应”，
// 也帮助定位 page-id 背后依赖了哪一个 tools_m*_utils.js 模块。
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
// 这一段直接对应标题栏上的关闭、最小化、最大化操作，实际会走 pywebview 的窗口 API。
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

// 页面懒初始化：按需初始化工具页，避免启动时初始化全部工具。
// 这里维护的是“页面 id -> 初始化函数名”的映射。
// 注意使用字符串而不是直接引用函数，目的是避免脚本加载顺序尚未完成时直接抛 ReferenceError。
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
    'ai-chat': 'initAIChatPage',
    'ai-settings': 'initAISettingsPage',
    'prompt-templates': 'initPromptTemplates',
});

// 页面初始化守门函数：
// - PAGE_INIT_MAP 只声明“进入某页时应该调用哪个初始化函数”；
// - 这里负责避免重复初始化，并处理短时间内多次切页到同一页面时的并发问题。
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
// 所有 web/pages/*.html 都通过这里按需拉取、缓存并注入，是“页面 DOM 从哪里来”的关键入口。
// 当前应用不是把全部页面 DOM 一次性塞进 index.html，
// 而是在真正进入某页时，再从 web/pages/{page}.html 拉取片段并注入 page-root。
// 只有 DOM 注入成功后，switchPage() 才会继续执行页面激活和业务初始化。
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

// 窗口关闭前保存配置（修复 Command+W 配置丢失问题）
// 这层兜底只负责“尽可能把当前界面设置落盘”，不处理复杂业务保存。
window.addEventListener('beforeunload', () => {
    try {
        // 保存当前主题
        const theme = document.documentElement.getAttribute('data-theme');
        if (theme) {
            localStorage.setItem('theme', theme);
            if (window.pywebview?.api?.save_theme) {
                window.pywebview.api.save_theme(theme).catch(() => {});
            }
        }

        // 保存毛玻璃透明度
        const slider = document.getElementById('glassOpacitySlider');
        if (slider) {
            const opacity = slider.value;
            localStorage.setItem('glass_opacity', opacity);
            if (window.pywebview?.api?.save_glass_opacity) {
                window.pywebview.api.save_glass_opacity(parseInt(opacity)).catch(() => {});
            }
        }

        // 保存 UI 缩放
        const uiScale = localStorage.getItem('ui_scale');
        if (uiScale && window.pywebview?.api?.save_ui_scale) {
            window.pywebview.api.save_ui_scale(parseInt(uiScale)).catch(() => {});
        }
    } catch (e) {
        console.error('保存配置失败:', e);
    }
});

// 应用启动主流程：
// 1. 先做前端自检与错误边界挂载；
// 2. 初始化不依赖后端的导航；
// 3. 等待 pywebview/api 真正就绪；
// 4. 回填主题/毛玻璃/标题栏等全局设置；
// 5. 进入默认页 credentials，并由 handlePageEnter() 继续触发首屏数据加载。
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
        console.log('[DOMContentLoaded] 开始等待 pywebview...');
        console.log('[DOMContentLoaded] window.pywebview:', !!window.pywebview);
        console.log('[DOMContentLoaded] window.pywebview?.api:', !!(window.pywebview && window.pywebview.api));
        const pywebviewReady = await waitForPywebview({ timeoutMs: 15000 });
        console.log('[DOMContentLoaded] waitForPywebview 返回:', pywebviewReady);
        console.log('[DOMContentLoaded] 等待后 window.pywebview:', !!window.pywebview);
        console.log('[DOMContentLoaded] 等待后 window.pywebview?.api:', !!(window.pywebview && window.pywebview.api));
        if (!pywebviewReady) {
            showBackendNotReadyBanner();
        }

        // 现在 pywebview 已就绪（或超时），执行依赖后端的初始化
        await initTheme();
        await initGlassMode();
        await initTitlebarMode();
        await initUIScale();
        initShortcut();
        initGlobalSearch();
        // 页面片段按需加载：默认进入"密码管理"
        await switchPage('credentials');
    } finally {
        hideAppLoading();
    }
});

// 页面自检：逐个 fetch pages/*.html，适合排查“某个页面片段丢了/没被打包进去/注入后找不到根节点”。
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

// pywebview 就绪链路状态：
// - 一个标记是否已经挂过监听；
// - 一个标记“真正可用后的补同步流程”是否已经执行过。
let _pywebviewReadyListenerInstalled = false;
let _pywebviewReadyHandledOnce = false;

// pywebview 真正就绪后的补偿动作：
// - 同步后端保存的设置；
// - 如有需要刷新当前页数据；
// - 关闭“后端未就绪”横幅；
// - 尝试抓取运行时诊断信息。
async function _handlePywebviewBecameReady() {
    if (_pywebviewReadyHandledOnce) return;
    // 注意：pywebviewready 事件可能早于 window.pywebview.api 注入完成
    // 只有在 api 可用时才允许"只处理一次"，否则会错过后续真正就绪后的同步
    if (!window.pywebview || !window.pywebview.api) return;
    _pywebviewReadyHandledOnce = true;

    startFrontendHotReloadBridge().catch(() => {});

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

// 开发模式前端自动刷新：
// - 后端只负责汇报当前版本号，并在文件变化时主动推送事件；
// - 前端初始化时读取一次当前配置，随后只监听事件，不做周期轮询；
// - 使用 query 参数带上版本号，便于调试时区分这次刷新来自哪次文件改动。
async function startFrontendHotReloadBridge() {
    if (frontendHotReloadBridgeStarted) return;
    if (!window.pywebview || !window.pywebview.api) return;
    if (typeof window.pywebview.api.get_frontend_reload_version !== 'function') return;

    const first = await window.pywebview.api.get_frontend_reload_version();
    if (!first || !first.enabled) return;

    frontendHotReloadBridgeStarted = true;
    frontendHotReloadEnabled = true;
    frontendReloadVersion = first.version;
    ensureFrontendDevBadge();
    window.addEventListener(FRONTEND_RELOAD_EVENT_NAME, handleFrontendReloadEvent);
}

function handleFrontendReloadEvent(event) {
    const nextVersion = event?.detail?.version;
    if (!frontendHotReloadEnabled || !nextVersion) return;
    if (frontendReloadVersion && nextVersion === frontendReloadVersion) return;

    frontendReloadVersion = nextVersion;
    reloadFrontendNow('hot');
}

function reloadFrontendNow(reason = 'manual') {
    console.log(`[dev] 前端刷新触发，原因: ${reason}`);
    const url = new URL(window.location.href);
    url.searchParams.set('__dev_reload', frontendReloadVersion || String(Date.now()));
    window.location.replace(url.toString());
}

function ensureFrontendDevBadge() {
    if (document.getElementById('frontend-dev-badge')) return;

    const badge = document.createElement('div');
    badge.id = 'frontend-dev-badge';
    badge.style.cssText = [
        'position:fixed',
        'right:12px',
        'bottom:12px',
        'z-index:100001',
        'display:flex',
        'align-items:center',
        'gap:8px',
        'padding:8px 10px',
        'border-radius:999px',
        'background:rgba(16,185,129,0.92)',
        'color:#062b1f',
        'font-size:12px',
        'font-weight:600',
        'box-shadow:0 6px 18px rgba(0,0,0,0.22)',
        'backdrop-filter:blur(8px)',
        '-webkit-backdrop-filter:blur(8px)',
    ].join(';');
    badge.innerHTML = [
        '<span>DEV 自动刷新已开启</span>',
        '<button type="button" id="frontend-dev-badge-refresh" style="border:none;border-radius:999px;padding:4px 8px;background:rgba(255,255,255,0.78);color:#062b1f;cursor:pointer;font-size:12px;font-weight:600;">立即刷新</button>',
    ].join('');
    document.body.appendChild(badge);

    const refreshBtn = document.getElementById('frontend-dev-badge-refresh');
    refreshBtn?.addEventListener('click', () => reloadFrontendNow('badge'));
}

// 等待 pywebview API 可用：
// 这是前端与桌面宿主之间最关键的“桥接等待点”。
// 只有确认 window.pywebview.api 以及关键方法已出现，后续页面数据加载才值得继续。
function waitForPywebview({ timeoutMs = 3500 } = {}) {
    return new Promise(resolve => {
        // 检查 API 是否完全就绪（包括关键方法）
        const isApiReady = () => {
            return window.pywebview &&
                   window.pywebview.api &&
                   typeof window.pywebview.api.get_theme === 'function';
        };

        if (isApiReady()) {
            _pywebviewReady = true;
            _handlePywebviewBecameReady().catch(() => {});
            resolve(true);
            return;
        }

        // 安装一次性的全局监听：用于"超时后仍继续初始化"的兜底补刷新
        if (!_pywebviewReadyListenerInstalled) {
            _pywebviewReadyListenerInstalled = true;
            window.addEventListener('pywebviewready', () => {
                // pywebviewready 事件不等于 api 已注入：事件触发后短暂轮询等待 api
                const startedAt = Date.now();
                const pollApi = setInterval(() => {
                    if (isApiReady()) {
                        clearInterval(pollApi);
                        _pywebviewReady = true;
                        _handlePywebviewBecameReady().catch(() => {});
                        return;
                    }
                    // 避免无限轮询（最多等 15 秒）
                    if (Date.now() - startedAt > 15000) {
                        clearInterval(pollApi);
                    }
                }, 50);
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
            if (isApiReady()) {
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
        // 注意：事件触发不代表 api 已注入，需要检查后再 resolve
        window.addEventListener('pywebviewready', () => {
            if (window.pywebview && window.pywebview.api) {
                clearTimeout(timer);
                clearInterval(poll);
                _pywebviewReady = true;
                _handlePywebviewBecameReady().catch(() => {});
                resolve(true);
            }
            // 如果 api 还没注入，继续依赖轮询兜底
        }, { once: true });
    });
}

// 同步后端配置：优先使用后端保存值（数据库为权威），仅在后端不可用时回退到 localStorage。
// 这一步让“桌面端真正保存的主题/毛玻璃/标题栏/UI 缩放”重新回到前端界面。
// 从后端回填全局设置：
// - 当前端刚检测到 pywebview 已真正可用时，会重新把数据库中的主题、毛玻璃、标题栏、缩放配置同步回来；
// - 这样可以避免“首屏先用了 localStorage，稍后又被后端真实配置覆盖”时的状态不一致。
async function syncSettingsFromBackend() {
    if (!window.pywebview || !window.pywebview.api) return;

    // 主题
    try {
        const backendTheme = await window.pywebview.api.get_theme();
        const localTheme = localStorage.getItem('theme');
        const finalTheme = backendTheme || localTheme || 'dark';
        setTheme(finalTheme, false);
        // 不回写 localStorage -> 后端，避免启动兜底值污染数据库
    } catch {}

    // 毛玻璃开关
    try {
        const backendGlass = await window.pywebview.api.get_glass_mode();
        const localGlass = localStorage.getItem('glass_mode');
        const finalGlass = backendGlass != null ? !!backendGlass : (localGlass === 'true');
        setGlassMode(finalGlass, false);
        // 不回写 localStorage -> 后端，避免启动兜底值污染数据库
    } catch {}

    // 毛玻璃透明度
    try {
        const backendOpacity = await window.pywebview.api.get_glass_opacity();
        const localOpacityRaw = localStorage.getItem('glass_opacity');
        const localOpacity = localOpacityRaw != null ? parseInt(localOpacityRaw, 10) : null;
        const finalOpacity = Number.isFinite(backendOpacity) ? backendOpacity : (Number.isFinite(localOpacity) ? localOpacity : 60);
        const slider = document.getElementById('glassOpacitySlider');
        if (slider) slider.value = finalOpacity;
        const valueDisplay = document.getElementById('opacityValue');
        if (valueDisplay) valueDisplay.textContent = finalOpacity + '%';
        document.documentElement.style.setProperty('--glass-opacity', mapGlassOpacity(finalOpacity));
        localStorage.setItem('glass_opacity', String(finalOpacity));
        // 不回写 localStorage -> 后端，避免启动兜底值污染数据库
    } catch {}

    // 标题栏模式
    try {
        const backendMode = await window.pywebview.api.get_titlebar_mode();
        const localMode = localStorage.getItem('titlebar_mode');
        const finalMode = backendMode || localMode || 'fixed';
        setTitlebarMode(finalMode, false);
    } catch {}

    // UI 缩放
    try {
        const backendScale = await window.pywebview.api.get_ui_scale();
        const localScaleRaw = localStorage.getItem('ui_scale');
        const localScale = localScaleRaw != null ? parseInt(localScaleRaw, 10) : null;

        if (backendScale == null) {
            // 数据库无记录，首次同步：优先使用本地值并迁移到后端
            const finalScale = Number.isFinite(localScale) ? localScale : 100;
            setUIScale(finalScale, true);
        } else {
            // 数据库有记录，使用后端值（权威数据源）
            setUIScale(backendScale, false);
        }
    } catch {}
}

// 导航初始化：
// - 叶子项负责切页；
// - 分组头负责展开/收起；
// - 真正的数据加载与页面初始化不在这里做，而是在 switchPage -> handlePageEnter 里做。
function initNavigation() {
    // 叶子页面：点击切换页面
    document.querySelectorAll('.nav-item[data-page]').forEach(item => {
        item.addEventListener('click', () => {
            switchPage(item.dataset.page);
        });
    });

    // 分组：点击展开/收起（仅在侧边栏展开状态下生效）
    document.querySelectorAll('.nav-group-header').forEach(header => {
        header.addEventListener('click', () => {
            const sidebar = document.querySelector('.sidebar');
            // 收起状态下由 initSidebarInteraction 处理
            if (sidebar && sidebar.classList.contains('collapsed')) return;

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

// ==================== 工具联动函数 ====================
// 用于跨页面传递内容，例如在一个工具页生成结果后，跳去另一个工具页继续加工。

/**
 * 将数据传递到目标工具
 * @param {string} targetToolId - 目标工具 ID
 * @param {any} data - 要传递的数据
 * @param {string} dataType - 数据类型标识
 */
// 工具联动入口：
// - 某些工具页会把当前结果“带着数据跳转到另一个工具”；例如一个页面生成的文本想直接送到另一个页面继续处理；
// - 这里只保存桥接状态，不直接切页，真正消费发生在 populateToolWithData()。
function transferDataToTool(targetToolId, data, dataType) {
    // 检查是否有未消费的数据
    if (toolDataBridge.data !== null && toolDataBridge.status === 'pending') {
        console.warn('工具联动：覆盖未消费的数据', toolDataBridge);
    }

    toolDataBridge = {
        sourceToolId: activePage,
        targetToolId: targetToolId,
        data: data,
        dataType: dataType,
        timestamp: Date.now(),
        status: 'pending'
    };
    switchPage(targetToolId);
}

/**
 * 在目标工具中填充联动数据
 * @param {string} toolId - 工具 ID
 */
// 工具联动消费器：
// - 页面进入后，如果发现 toolDataBridge 里有待处理数据，就按目标工具的输入约定回填到对应输入框；
// - 如果用户反馈“页面切过去了，但数据没自动带过去”，优先看这里。
function populateToolWithData(toolId) {
    // 使用 !== null 避免过滤 falsy 值（如空字符串、0）
    if (toolDataBridge.data === null || toolDataBridge.targetToolId !== toolId) return;
    if (toolDataBridge.status !== 'pending') return;

    // 防止重复消费（5秒内有效）
    if (Date.now() - toolDataBridge.timestamp > 5000) {
        showToast('联动数据已过期', 'warning');
        toolDataBridge = { sourceToolId: null, targetToolId: null, data: null, dataType: null, timestamp: null, status: null };
        return;
    }

    const data = toolDataBridge.data;
    const dataType = toolDataBridge.dataType;
    const sourceToolId = toolDataBridge.sourceToolId;
    let success = false;

    try {
        switch (toolId) {
            case 'http-collections':
                if (dataType === 'http-request' && typeof populateHttpFromCurl === 'function') {
                    populateHttpFromCurl(data);
                    success = true;
                }
                break;
            case 'tool-mock':
                if (dataType === 'json-schema' && typeof populateMockFromSchema === 'function') {
                    populateMockFromSchema(data);
                    success = true;
                }
                break;
        }

        if (success) {
            toolDataBridge.status = 'consumed';
            showToast(`已从 ${sourceToolId} 导入数据`, 'success');
        } else {
            toolDataBridge.status = 'error';
            showToast('数据导入失败：不支持的数据类型', 'error');
        }
    } catch (e) {
        toolDataBridge.status = 'error';
        console.error('工具联动数据填充失败:', e);
        showToast('数据导入失败', 'error');
    }

    // 清空桥接数据
    toolDataBridge = { sourceToolId: null, targetToolId: null, data: null, dataType: null, timestamp: null, status: null };
}

// 页面切换主入口：
// 这是“导航点击 -> 页面显示 -> 页面进入逻辑”的总调度点。
// 如果用户反馈“切到某页后空白/未加载/激活态不对”，优先从这里往下追。
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

    // 自动展开所属分组，保证当前项可见（仅在侧边栏展开状态下）
    const sidebar = document.querySelector('.sidebar');
    const isCollapsed = sidebar && sidebar.classList.contains('collapsed');
    const group = document.querySelector(`.nav-item[data-page="${page}"]`)?.closest('.nav-group');
    if (group && !isCollapsed) {
        // 仅在展开状态下自动展开分组
        group.classList.add('expanded');
        group.querySelector('.nav-group-header')?.setAttribute('aria-expanded', 'true');
    }
    // 收起状态下不修改分组的 expanded 状态，让用户手动关闭抽屉

    // 收起状态下重置导航列表的水平滚动位置，防止图标"消失"
    if (isCollapsed) {
        const navList = sidebar.querySelector('.nav-list');
        if (navList) {
            navList.scrollLeft = 0;
        }
    }

    activePage = page;
    await handlePageEnter(page);

    // 触发页面切换事件，供全局 AI 帮助按钮等组件监听
    document.dispatchEvent(new CustomEvent('pageChanged', { detail: { page } }));
}

// 页面进入钩子：
// 这里负责把“显示页面”进一步变成“页面真正可用”：
// - 普通管理页会先拉数据；
// - 工具页会按需初始化；
// - 部分工具页还会在进入时主动刷新结果区或启动定时器。
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
        if (page === 'http-collections') {
            await loadHttpCollections();
        }
        if (page === 'nodes') {
            await loadNodes();
        }
        if (page === 'converter') {
            initConverterOutput();
        }

        await ensurePageInitialized(page);

        // 初始化工具页面的 AI 按钮
        if (typeof initPageAIButtons === 'function') {
            initPageAIButtons(page);
        }

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

        // 检查并填充工具联动数据
        populateToolWithData(page);
    } catch (e) {
        console.error('页面进入处理失败:', page, e);
    }
}

// 页面离开钩子：
// 这里只放“必须在离开时清理”的页面级副作用，例如时间工具的定时器。
function handlePageLeave(page) {
    if (page === 'tool-time') {
        stopTimeNowTicker();
    }
}

// 主题切换：
// 这块既处理前端 DOM 状态，也负责把用户选择同步到 pywebview 后端保存。
const THEME_ICONS = {
    'light': '☀️', 'cute': '🐶', 'office': '📊',
    'neon-light': '🌊', 'cyberpunk-light': '🌸',
    'dark': '🌙', 'neon': '🌈', 'cyberpunk': '🤖', 'void': '🌌'
};

async function initTheme() {
    // 优先从后端获取主题，回退到 localStorage
    let savedTheme = 'dark';
    try {
        if (window.pywebview && window.pywebview.api && typeof window.pywebview.api.get_theme === 'function') {
            savedTheme = await window.pywebview.api.get_theme();
            console.log('[initTheme] 从后端获取主题:', savedTheme);
        } else {
            savedTheme = localStorage.getItem('theme') || 'dark';
            console.log('[initTheme] pywebview 未就绪，使用 localStorage:', savedTheme);
        }
    } catch (e) {
        savedTheme = localStorage.getItem('theme') || 'dark';
        console.error('[initTheme] 获取主题失败，使用 localStorage:', savedTheme, e);
    }
    if (!savedTheme) {
        console.warn('[initTheme] 主题为空，使用默认值 dark');
        savedTheme = 'dark';
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

// ==================== 设置弹窗（预览/保存） ====================
// 这部分负责主题、玻璃效果、标题栏样式等全局体验设置，与具体业务页无关。
// 这里把设置分成“原始快照”和“当前草稿”两套状态：
// - 原始快照用于判断用户有没有改动；
// - 当前草稿用于先预览主题/毛玻璃/UI 缩放，再决定是否真正保存。
let _settingsOriginal = null;
let _settingsDraft = null;

const ALLOWED_THEMES = ['light', 'cute', 'office', 'neon-light', 'cyberpunk-light', 'dark', 'neon', 'cyberpunk', 'void'];
const ALLOWED_TITLEBAR_MODES = ['fixed', 'minimal'];

// 读取当前界面设置快照：
// - 这里读的是“当前浏览器/DOM 已呈现状态”，不是表单草稿；
// - 打开设置弹窗时，会先拿这份快照做 _settingsOriginal 和 _settingsDraft 的初始值。
function _readCurrentSettings() {
    const theme = document.documentElement.getAttribute('data-theme') || localStorage.getItem('theme') || 'dark';
    const glassMode = document.documentElement.getAttribute('data-glass') === 'true';

    let glassOpacity = parseInt(localStorage.getItem('glass_opacity') || '60');
    if (isNaN(glassOpacity)) glassOpacity = 60;
    glassOpacity = Math.max(20, Math.min(90, glassOpacity));

    let uiScale = parseInt(localStorage.getItem('ui_scale') || '100');
    if (isNaN(uiScale)) uiScale = 100;
    uiScale = Math.max(50, Math.min(100, uiScale));

    const titlebarMode = document.documentElement.getAttribute('data-titlebar-mode') || localStorage.getItem('titlebar_mode') || 'fixed';

    return {
        theme: ALLOWED_THEMES.includes(theme) ? theme : 'dark',
        glassMode,
        glassOpacity,
        uiScale,
        titlebarMode: ALLOWED_TITLEBAR_MODES.includes(titlebarMode) ? titlebarMode : 'fixed'
    };
}

function _areSettingsEqual(a, b) {
    return a.theme === b.theme &&
           a.glassMode === b.glassMode &&
           a.glassOpacity === b.glassOpacity &&
           a.uiScale === b.uiScale &&
           a.titlebarMode === b.titlebarMode;
}

// 将一份设置草稿直接预览到界面：
// - 不要求用户先点保存，就可以即时看到主题、毛玻璃、缩放等变化；
// - 这也是为什么设置弹窗关闭前需要比较原始值和草稿值，判断是否有未保存修改。
function _applySettingsPreview(settings) {
    // 主题
    document.documentElement.setAttribute('data-theme', settings.theme);
    updateThemeSelector(settings.theme);

    // 毛玻璃
    document.documentElement.setAttribute('data-glass', settings.glassMode ? 'true' : 'false');
    const glassToggle = document.getElementById('settingsGlassToggle');
    if (glassToggle) glassToggle.checked = settings.glassMode;
    const opacityWrapper = document.getElementById('settingsGlassOpacityWrapper');
    if (opacityWrapper) opacityWrapper.style.display = settings.glassMode ? 'block' : 'none';

    // 透明度
    document.documentElement.style.setProperty('--glass-opacity', mapGlassOpacity(settings.glassOpacity));
    const opacitySlider = document.getElementById('settingsGlassOpacitySlider');
    if (opacitySlider) opacitySlider.value = settings.glassOpacity;
    const opacityValue = document.getElementById('settingsOpacityValue');
    if (opacityValue) opacityValue.value = settings.glassOpacity;

    // UI 缩放
    document.documentElement.style.setProperty('--ui-scale', settings.uiScale / 100);
    const scaleValue = document.getElementById('settingsScaleValue');
    if (scaleValue) scaleValue.textContent = settings.uiScale + '%';
    document.querySelectorAll('#settings-modal .ui-scale-btn').forEach(btn => {
        btn.classList.toggle('active', parseInt(btn.dataset.scale) === settings.uiScale);
    });

    // 标题栏模式
    document.documentElement.setAttribute('data-titlebar-mode', settings.titlebarMode);
    document.querySelectorAll('#settings-modal .titlebar-mode-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.mode === settings.titlebarMode);
    });
}

function _updateSaveButtonState() {
    const saveBtn = document.getElementById('settingsSaveBtn');
    if (!saveBtn || !_settingsOriginal || !_settingsDraft) return;
    const dirty = !_areSettingsEqual(_settingsOriginal, _settingsDraft);
    saveBtn.disabled = !dirty;
}

function openSettingsModal() {
    const snapshot = _readCurrentSettings();
    _settingsOriginal = { ...snapshot };
    _settingsDraft = { ...snapshot };

    _applySettingsPreview(snapshot);
    _updateSaveButtonState();
    initDevToolsButton();

    openModal('settings-modal');

    // ESC 键关闭
    document.addEventListener('keydown', _settingsEscHandler);
}

function _settingsEscHandler(e) {
    if (e.key === 'Escape') {
        e.preventDefault();
        const confirmModal = document.getElementById('settings-confirm-modal');
        if (confirmModal && confirmModal.classList.contains('active')) {
            cancelCloseSettingsModal();
        } else {
            requestCloseSettingsModal();
        }
    }
}

function settingsPreviewTheme(theme) {
    if (!_settingsDraft || !ALLOWED_THEMES.includes(theme)) return;
    _settingsDraft.theme = theme;
    document.documentElement.setAttribute('data-theme', theme);
    updateThemeSelector(theme);
    _updateSaveButtonState();
}

function settingsPreviewGlassMode(enabled) {
    if (!_settingsDraft) return;
    _settingsDraft.glassMode = enabled;
    document.documentElement.setAttribute('data-glass', enabled ? 'true' : 'false');
    const opacityWrapper = document.getElementById('settingsGlassOpacityWrapper');
    if (opacityWrapper) opacityWrapper.style.display = enabled ? 'block' : 'none';
    _updateSaveButtonState();
}

function settingsPreviewGlassOpacity(value) {
    if (!_settingsDraft) return;
    const v = Math.max(45, Math.min(95, parseInt(value) || 60));
    _settingsDraft.glassOpacity = v;
    document.documentElement.style.setProperty('--glass-opacity', mapGlassOpacity(v));
    const opacityValue = document.getElementById('settingsOpacityValue');
    if (opacityValue) opacityValue.value = v;
    const slider = document.getElementById('settingsGlassOpacitySlider');
    if (slider) slider.value = v;
    _updateSaveButtonState();
}

function settingsClampGlassOpacity(input) {
    const v = Math.max(45, Math.min(95, parseInt(input.value) || 60));
    input.value = v;
    settingsPreviewGlassOpacity(v);
}

function settingsPreviewUIScale(scale) {
    if (!_settingsDraft) return;
    const v = Math.max(50, Math.min(100, parseInt(scale) || 100));
    _settingsDraft.uiScale = v;
    document.documentElement.style.setProperty('--ui-scale', v / 100);
    const scaleValue = document.getElementById('settingsScaleValue');
    if (scaleValue) scaleValue.textContent = v + '%';
    document.querySelectorAll('#settings-modal .ui-scale-btn').forEach(btn => {
        btn.classList.toggle('active', parseInt(btn.dataset.scale) === v);
    });
    _updateSaveButtonState();
}

function settingsPreviewTitlebarMode(mode) {
    if (!_settingsDraft || !ALLOWED_TITLEBAR_MODES.includes(mode)) return;
    _settingsDraft.titlebarMode = mode;
    document.documentElement.setAttribute('data-titlebar-mode', mode);
    document.querySelectorAll('#settings-modal .titlebar-mode-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.mode === mode);
    });
    _updateSaveButtonState();
}

async function initDevToolsButton() {
    const btn = document.getElementById('devtoolsBtn');
    const hint = document.getElementById('devtoolsHint');
    if (!btn || !hint) return;

    try {
        const result = await pywebview.api.is_debug_mode();
        if (result.debug) {
            btn.disabled = false;
            hint.textContent = '检查页面元素和调试';
        } else {
            btn.disabled = true;
            hint.textContent = '使用 python main.py -d 启动以启用';
        }
    } catch (e) {
        btn.disabled = true;
        hint.textContent = '无法获取调试状态';
    }
}

async function openDevTools() {
    try {
        const result = await pywebview.api.open_devtools();
        if (result.success) {
            showToast(result.message, 'success');
        } else {
            showToast(result.message, 'warning');
        }
    } catch (e) {
        showToast('打开开发者工具失败', 'error');
    }
}

function requestCloseSettingsModal() {
    if (!_settingsOriginal || !_settingsDraft) {
        _closeSettingsModalCleanup();
        return;
    }

    const dirty = !_areSettingsEqual(_settingsOriginal, _settingsDraft);
    if (dirty) {
        openModal('settings-confirm-modal');
    } else {
        _closeSettingsModalCleanup();
    }
}

function cancelCloseSettingsModal() {
    closeModal('settings-confirm-modal');
}

function discardAndCloseSettingsModal() {
    // 恢复原始设置
    if (_settingsOriginal) {
        _applySettingsPreview(_settingsOriginal);
    }
    closeModal('settings-confirm-modal');
    _closeSettingsModalCleanup();
}

// 保存设置弹窗：
// - 先把当前草稿应用到 localStorage 和 DOM；
// - 再通过 pywebview.api 持久化到后端；
// - 保存完成后关闭弹窗并清理 ESC 监听等临时状态。
function saveSettingsModal() {
    if (!_settingsDraft) return;

    // 持久化保存
    setTheme(_settingsDraft.theme);
    setGlassMode(_settingsDraft.glassMode);
    updateGlassOpacity(String(_settingsDraft.glassOpacity));
    setUIScale(_settingsDraft.uiScale);
    setTitlebarMode(_settingsDraft.titlebarMode);

    closeModal('settings-confirm-modal');
    _closeSettingsModalCleanup();
}

function _closeSettingsModalCleanup() {
    closeModal('settings-modal');
    document.removeEventListener('keydown', _settingsEscHandler);
    _settingsOriginal = null;
    _settingsDraft = null;
}

// ==================== 毛玻璃模式 ====================
// 处理视觉层的玻璃透明度与启停逻辑，页面看起来“毛玻璃失效”时优先检查这里。
// 这组函数围绕窗口视觉效果工作：初始化、切换开关、透明度持久化。
async function initGlassMode() {
    let enabled = false;
    try {
        if (window.pywebview && window.pywebview.api && typeof window.pywebview.api.get_glass_mode === 'function') {
            enabled = await window.pywebview.api.get_glass_mode();
            console.log('[initGlassMode] 从后端获取毛玻璃:', enabled);
        } else {
            enabled = localStorage.getItem('glass_mode') === 'true';
            console.log('[initGlassMode] pywebview 未就绪，使用 localStorage:', enabled);
        }
    } catch (e) {
        enabled = localStorage.getItem('glass_mode') === 'true';
        console.error('[initGlassMode] 获取毛玻璃失败:', e);
    }
    setGlassMode(enabled, false);
    // 加载透明度设置
    await loadGlassOpacity();
}

// 开关毛玻璃模式：
// - 直接操作 documentElement 上的 data-glass 属性，让全局 CSS 选择器立即生效；
// - save=true 时会把最终开关同步给后端保存，false 则用于初始化/预览场景。
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
    const opacity = parseInt(value);
    document.documentElement.style.setProperty('--glass-opacity', mapGlassOpacity(opacity));
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
    document.documentElement.style.setProperty('--glass-opacity', mapGlassOpacity(opacity));
}

// ==================== 标题栏模式 ====================
// 管理自定义标题栏/简约模式等窗口外观切换，对桌面壳层体验影响最大。
// 标题栏模式会影响顶部拖拽/固定/融合表现，属于典型的“前端 UI + 桌面宿主配置”双向同步项。
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

// 切换标题栏模式：
// - fixed / minimal 本质上是切换顶栏 DOM 的展示策略；
// - 与毛玻璃类似，既要改前端 DOM 状态，也要视情况把结果回写到后端。
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
// 方便开发或排障时快速打开诊断信息，适合定位模块加载和环境就绪问题。
// 这里不是业务功能，而是给开发/排障时使用的快捷诊断入口。
// 全局快捷键初始化：
// - 这里负责把搜索、设置、诊断等“无论当前在哪个页面都能触发”的热键挂起来；
// - 如果某个快捷键在所有页面都失效，通常先从这里看而不是去具体业务文件里找。
function initShortcut() {
    document.addEventListener('keydown', function(e) {
        if (e.repeat) return;
        const isMac = /mac/i.test(navigator.platform);
        const cmdOrCtrl = isMac ? e.metaKey : e.ctrlKey;
        // Ctrl/Cmd + Shift + B - 开机自检
        if (cmdOrCtrl && e.shiftKey && !e.altKey && e.key.toLowerCase() === 'b') {
            e.preventDefault();
            toggleDiagnosticsPanel();
        }
        // Ctrl/Cmd + K - 全局搜索
        if (cmdOrCtrl && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'k') {
            e.preventDefault();
            openSearchModal();
        }
        // Ctrl/Cmd + Shift + R / F5 - 手动刷新前端（开发模式更常用）
        if ((cmdOrCtrl && e.shiftKey && !e.altKey && e.key.toLowerCase() === 'r') || e.key === 'F5') {
            e.preventDefault();
            reloadFrontendNow('shortcut');
        }
        // F12 - 打开开发者工具
        if (e.key === 'F12') {
            e.preventDefault();
            if (window.pywebview && window.pywebview.api && typeof window.pywebview.api.open_devtools === 'function') {
                window.pywebview.api.open_devtools();
            }
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
// 全局轻提示统一走这里；如果多个页面的“保存成功/复制成功”样式不一致，也要回看这一段。
// 各业务模块成功/失败提示尽量统一走这里，避免每个页面重复实现自己的轻提示。
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

// 侧边栏收起/展开
function toggleSidebar() {
    const sidebar = document.querySelector('.sidebar');
    const toggleBtn = document.getElementById('sidebarToggleBtn');

    if (!sidebar) return;

    const isCollapsed = sidebar.classList.contains('collapsed');

    if (isCollapsed) {
        // 展开
        sidebar.classList.remove('collapsed');
        if (toggleBtn) {
            toggleBtn.title = '收起侧边栏';
        }
        localStorage.setItem('sidebar_collapsed', 'false');

        // 清理浮动菜单（毛玻璃模式下收起状态创建的）
        const floatingMenu = document.getElementById('floating-nav-sublist');
        if (floatingMenu) {
            floatingMenu.remove();
        }
        // 清理收起状态下展开的分组
        document.querySelectorAll('.nav-group.expanded').forEach(group => {
            group.classList.remove('expanded');
            group.querySelector('.nav-group-header')?.setAttribute('aria-expanded', 'false');
        });
    } else {
        // 收起
        sidebar.classList.add('collapsed');
        if (toggleBtn) {
            toggleBtn.title = '展开侧边栏';
        }
        localStorage.setItem('sidebar_collapsed', 'true');

        // 如果有展开的分组，收起它们
        document.querySelectorAll('.nav-group.expanded').forEach(group => {
            group.classList.remove('expanded');
            const header = group.querySelector('.nav-group-header');
            if (header) {
                header.setAttribute('aria-expanded', 'false');
            }
        });
    }
}

// 展开侧边栏（不切换，只展开）
function expandSidebar() {
    const sidebar = document.querySelector('.sidebar');
    const toggleBtn = document.getElementById('sidebarToggleBtn');

    if (!sidebar) return;

    const isCollapsed = sidebar.classList.contains('collapsed');
    if (isCollapsed) {
        sidebar.classList.remove('collapsed');
        if (toggleBtn) {
            toggleBtn.title = '收起侧边栏';
        }
        localStorage.setItem('sidebar_collapsed', 'false');
    }
}

// 初始化侧边栏状态
function initSidebarState() {
    const sidebar = document.querySelector('.sidebar');
    const isCollapsed = localStorage.getItem('sidebar_collapsed') === 'true';

    if (sidebar && isCollapsed) {
        sidebar.classList.add('collapsed');
        const toggleBtn = document.getElementById('sidebarToggleBtn');
        if (toggleBtn) {
            toggleBtn.title = '展开侧边栏';
        }
    }
}

// 初始化侧边栏交互
function initSidebarInteraction() {
    const sidebar = document.querySelector('.sidebar');
    if (!sidebar) return;

    // 为所有导航项添加 tooltip 属性
    document.querySelectorAll('.nav-item').forEach(item => {
        const textEl = item.querySelector('.nav-text');
        if (textEl && textEl.textContent) {
            item.setAttribute('data-tooltip', textEl.textContent.trim());
        }
    });

    document.querySelectorAll('.nav-group-header').forEach(header => {
        const textEl = header.querySelector('.nav-text');
        if (textEl && textEl.textContent) {
            header.setAttribute('data-tooltip', textEl.textContent.trim());
        }
    });

    // 收起态下：显式 open/close，避免"先全关再重开"造成状态抖动
    const closeCollapsedGroup = (group) => {
        if (!group) return;
        group.classList.remove('expanded');
        group.querySelector('.nav-group-header')?.setAttribute('aria-expanded', 'false');
        // 移除浮动菜单
        const floatingMenu = document.getElementById('floating-nav-sublist');
        if (floatingMenu) {
            floatingMenu.remove();
        }
    };

    const openCollapsedGroup = (group, navGroupHeader) => {
        if (!group) return;
        group.classList.add('expanded');
        navGroupHeader?.setAttribute('aria-expanded', 'true');

        // 动态设置抽屉位置
        const sublist = group.querySelector('.nav-sublist');
        if (!sublist || !navGroupHeader) return;

        const rect = navGroupHeader.getBoundingClientRect();
        const viewportHeight = window.innerHeight;
        let top = rect.top;

        // sublist 有 max-height: 70vh，按可见高度上限做一次夹取，避免过度计算/抖动
        const maxVisibleHeight = Math.floor(viewportHeight * 0.7);
        const sublistHeight = Math.min(sublist.scrollHeight + 16, maxVisibleHeight);
        if (top + sublistHeight > viewportHeight - 20) {
            top = Math.max(20, viewportHeight - sublistHeight - 20);
        }

        sublist.style.top = `${top}px`;

        // 毛玻璃模式下，将菜单克隆到 body 以避免堆叠上下文问题
        const isGlassMode = document.documentElement.getAttribute('data-glass') === 'true';
        if (isGlassMode) {
            // 移除旧的浮动菜单
            const oldFloating = document.getElementById('floating-nav-sublist');
            if (oldFloating) oldFloating.remove();

            // 克隆菜单到 body
            const floatingMenu = sublist.cloneNode(true);
            floatingMenu.id = 'floating-nav-sublist';
            floatingMenu.style.cssText = `
                display: block !important;
                position: fixed !important;
                left: 72px;
                top: ${top}px;
                width: 180px;
                max-height: 70vh;
                overflow-y: auto;
                background: var(--bg-card);
                border: 1px solid var(--border);
                border-radius: 12px;
                box-shadow: 0 8px 32px rgba(0, 0, 0, 0.25);
                z-index: 2147483647;
                padding: 8px;
                opacity: 1;
                visibility: visible;
                pointer-events: auto;
                -webkit-backdrop-filter: blur(20px);
                backdrop-filter: blur(20px);
            `;
            document.body.appendChild(floatingMenu);

            // 为克隆的菜单项添加点击事件
            floatingMenu.querySelectorAll('.nav-item[data-page]').forEach(item => {
                item.addEventListener('click', () => {
                    switchPage(item.dataset.page);
                    // 重置滚动位置
                    const navList = sidebar.querySelector('.nav-list');
                    if (navList) setTimeout(() => { navList.scrollLeft = 0; }, 0);
                });
            });
        }
    };

    // 收起状态下的交互逻辑
    sidebar.addEventListener('click', (e) => {
        const isCollapsed = sidebar.classList.contains('collapsed');
        if (!isCollapsed) return;

        const navItem = e.target.closest('.nav-item');
        const navGroupHeader = e.target.closest('.nav-group-header');

        // 点击抽屉内的导航项：不关闭抽屉，让用户点击外部关闭
        // switchPage 会自动处理页面切换
        if (navItem && navItem.closest('.nav-sublist')) {
            // 重置滚动位置，防止图标"消失"
            const navList = sidebar.querySelector('.nav-list');
            if (navList) {
                setTimeout(() => { navList.scrollLeft = 0; }, 0);
            }
            return;
        }

        // 点击分组头部：显示/隐藏抽屉菜单
        if (navGroupHeader) {
            e.preventDefault();
            e.stopPropagation();
            const group = navGroupHeader.closest('.nav-group');
            if (!group) return;

            const expandedGroup = sidebar.querySelector('.nav-group.expanded');
            if (expandedGroup && expandedGroup !== group) {
                closeCollapsedGroup(expandedGroup);
            }

            if (group.classList.contains('expanded')) {
                closeCollapsedGroup(group);
                return;
            }

            openCollapsedGroup(group, navGroupHeader);
            return;
        }

        // 点击普通导航项（一级菜单）：直接切换页面，不展开侧边栏
        // switchPage 会自动处理页面切换
    });

    // 点击外部关闭抽屉菜单
    document.addEventListener('click', (e) => {
        const isCollapsed = sidebar.classList.contains('collapsed');
        if (!isCollapsed) return;

        const expandedGroup = sidebar.querySelector('.nav-group.expanded');
        const floatingMenu = document.getElementById('floating-nav-sublist');

        if (!expandedGroup && !floatingMenu) return;

        // 如果点击的不是展开的分组内部，也不是浮动菜单内部，则关闭抽屉
        const clickedInGroup = expandedGroup && expandedGroup.contains(e.target);
        const clickedInFloating = floatingMenu && floatingMenu.contains(e.target);

        if (!clickedInGroup && !clickedInFloating) {
            if (expandedGroup) closeCollapsedGroup(expandedGroup);
            if (floatingMenu) floatingMenu.remove();
        }
    });
}

// 在页面加载时初始化
document.addEventListener('DOMContentLoaded', () => {
    initSidebarState();
    initSidebarInteraction();
});

// UI 缩放功能
function setUIScale(scale, save = true) {
    // 范围校验和 NaN 处理
    let validScale = parseInt(scale, 10);
    if (isNaN(validScale)) validScale = 100;
    validScale = Math.max(50, Math.min(200, validScale));

    // 更新 CSS 变量
    document.documentElement.style.setProperty('--ui-scale', validScale / 100);

    // 更新显示值
    const scaleValue = document.getElementById('scaleValue');
    if (scaleValue) {
        scaleValue.textContent = `${validScale}%`;
    }

    // 更新按钮激活状态
    document.querySelectorAll('.ui-scale-btn').forEach(btn => {
        if (parseInt(btn.dataset.scale) === validScale) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
    });

    // 始终更新 localStorage（作为本地缓存，确保离线启动时有最新值）
    localStorage.setItem('ui_scale', validScale.toString());

    // save 参数只控制是否同步到后端
    if (save) {
        if (window.pywebview?.api?.save_ui_scale) {
            window.pywebview.api.save_ui_scale(validScale).catch(() => {});
        }
    }
}

// 初始化 UI 缩放
async function initUIScale() {
    let scale = 100;

    // 先从 localStorage 读取默认值
    const localScale = localStorage.getItem('ui_scale');
    if (localScale) {
        scale = parseInt(localScale, 10);
    }

    // 尝试从后端读取（如果有的话会覆盖）
    try {
        if (window.pywebview?.api?.get_ui_scale) {
            const backendScale = await window.pywebview.api.get_ui_scale();
            console.log('[initUIScale] 从后端获取缩放:', backendScale);
            if (backendScale != null) {
                scale = backendScale;
            }
        } else {
            console.log('[initUIScale] pywebview 未就绪，使用 localStorage:', scale);
        }
    } catch (e) {
        console.error('[initUIScale] 获取缩放失败:', e);
    }

    console.log('[initUIScale] 最终缩放值:', scale);
    // 应用缩放
    setUIScale(scale);
}

// ==================== 全局搜索 ====================
// 负责搜索框、结果面板和页面跳转，是跨页面定位功能的统一入口。
// 全局搜索并不直接依赖后端，而是基于侧边栏导航构建工具注册表，
// 再结合本地收藏/最近使用/使用频次做前端内搜索与跳转。

const TOOLS_REGISTRY = {};
let searchDebounceTimer = null;

// 从导航 DOM 构建工具注册表：
// - 避免重复维护一份独立的工具搜索配置；
// - 也让“导航里能点开的页面”和“搜索里能搜到的页面”天然保持一致；
// - 后续 performSearch()、selectSearchResult() 都依赖这份注册表做排序和跳转。
function buildToolsRegistry() {
    if (Object.keys(TOOLS_REGISTRY).length > 0) return;

    document.querySelectorAll('.nav-item[data-page]').forEach(item => {
        const id = item.dataset.page;
        const name = item.querySelector('.nav-text')?.textContent?.trim() || id;
        const iconSvg = item.querySelector('.nav-icon')?.innerHTML || '';
        const group = item.closest('.nav-group');
        const categoryName = group?.querySelector('.nav-group-header .nav-text')?.textContent?.trim() || '';

        TOOLS_REGISTRY[id] = {
            id,
            name,
            icon: iconSvg,
            category: group?.dataset?.group || '',
            categoryName,
            keywords: generateKeywords(name, id)
        };
    });
}

function generateKeywords(name, id) {
    const keywords = [name.toLowerCase(), id.toLowerCase()];
    const pinyin = {
        '密码': ['mima', 'password'], '命令': ['mingling', 'command'], '节点': ['jiedian', 'node'],
        '编码': ['bianma', 'encode'], '解码': ['jiema', 'decode'], '转换': ['zhuanhuan', 'convert'],
        '加密': ['jiami', 'encrypt'], '解密': ['jiemi', 'decrypt'], '哈希': ['haxi', 'hash'],
        '格式': ['geshi', 'format'], '生成': ['shengcheng', 'generate'], '工具': ['gongju', 'tool'],
        '时间': ['shijian', 'time'], '日期': ['riqi', 'date'], '颜色': ['yanse', 'color'],
        '文本': ['wenben', 'text'], '对比': ['duibi', 'diff'], '正则': ['zhengze', 'regex'],
        '数据': ['shuju', 'data'], '备份': ['beifen', 'backup'], '设置': ['shezhi', 'settings']
    };
    Object.entries(pinyin).forEach(([cn, pys]) => {
        if (name.includes(cn)) keywords.push(...pys);
    });
    return keywords;
}

// 初始化搜索弹窗输入逻辑：
// - 负责绑定防抖输入与键盘上下选择；
// - 真正的排序、分组和结果渲染由 performSearch() 完成。
function initGlobalSearch() {
    buildToolsRegistry();
    loadSearchPreferences();

    const input = document.getElementById('global-search-input');
    if (input) {
        input.addEventListener('input', (e) => {
            clearTimeout(searchDebounceTimer);
            searchDebounceTimer = setTimeout(() => {
                globalSearchState.query = e.target.value;
                globalSearchState.selectedIndex = -1;
                performSearch();
            }, 150);
        });

        input.addEventListener('keydown', handleSearchKeydown);
    }
}

function loadSearchPreferences() {
    try {
        const favs = localStorage.getItem('tool_favorites');
        if (favs) globalSearchState.favorites = new Set(JSON.parse(favs));

        const recent = localStorage.getItem('recent_tools');
        if (recent) globalSearchState.recentTools = JSON.parse(recent);

        const stats = localStorage.getItem('tool_usage_stats');
        if (stats) globalSearchState.usageStats = new Map(JSON.parse(stats));
    } catch {}
}

function saveSearchPreferences() {
    try {
        localStorage.setItem('tool_favorites', JSON.stringify([...globalSearchState.favorites]));
        localStorage.setItem('recent_tools', JSON.stringify(globalSearchState.recentTools));
        localStorage.setItem('tool_usage_stats', JSON.stringify([...globalSearchState.usageStats]));
    } catch {}
}

function openSearchModal() {
    buildToolsRegistry();
    const modal = document.getElementById('search-modal');
    if (!modal) return;

    modal.classList.add('active');
    globalSearchState.isOpen = true;
    globalSearchState.query = '';
    globalSearchState.selectedIndex = -1;

    const input = document.getElementById('global-search-input');
    if (input) {
        input.value = '';
        input.focus();
    }

    performSearch();
}

function closeSearchModal() {
    const modal = document.getElementById('search-modal');
    if (modal) modal.classList.remove('active');
    globalSearchState.isOpen = false;
}

// 执行搜索与结果渲染：
// - 无关键字时展示收藏、最近使用和全量分类；
// - 有关键字时按名称、关键词和使用频次综合排序；
// - 最终点击结果仍会回到 switchPage() 完成页面切换。
function performSearch() {
    const query = globalSearchState.query.toLowerCase().trim();
    const resultsContainer = document.getElementById('search-results');
    if (!resultsContainer) return;

    let html = '';

    // 收藏工具
    const favTools = [...globalSearchState.favorites]
        .map(id => TOOLS_REGISTRY[id])
        .filter(t => t && (!query || matchTool(t, query)));

    if (favTools.length > 0) {
        html += '<div class="search-section-title">收藏工具</div>';
        favTools.forEach(tool => {
            html += renderSearchItem(tool, true);
        });
    }

    // 最近使用
    if (!query) {
        const recentTools = globalSearchState.recentTools
            .slice(0, 5)
            .map(id => TOOLS_REGISTRY[id])
            .filter(t => t && !globalSearchState.favorites.has(t.id));

        if (recentTools.length > 0) {
            html += '<div class="search-section-title">最近使用</div>';
            recentTools.forEach(tool => {
                html += renderSearchItem(tool, false);
            });
        }
    }

    // 搜索结果
    if (query) {
        const results = Object.values(TOOLS_REGISTRY)
            .filter(t => !globalSearchState.favorites.has(t.id) && matchTool(t, query))
            .sort((a, b) => calculateScore(b, query) - calculateScore(a, query))
            .slice(0, 10);

        if (results.length > 0) {
            html += '<div class="search-section-title">搜索结果</div>';
            results.forEach(tool => {
                html += renderSearchItem(tool, false);
            });
        }
    } else {
        // 无搜索时显示所有工具（按分类）
        const categories = {};
        Object.values(TOOLS_REGISTRY).forEach(tool => {
            if (globalSearchState.favorites.has(tool.id)) return;
            if (globalSearchState.recentTools.includes(tool.id)) return;
            const cat = tool.categoryName || '其他';
            if (!categories[cat]) categories[cat] = [];
            categories[cat].push(tool);
        });

        Object.entries(categories).forEach(([cat, tools]) => {
            html += `<div class="search-section-title">${escapeHtml(cat)}</div>`;
            tools.forEach(tool => {
                html += renderSearchItem(tool, false);
            });
        });
    }

    if (!html) {
        html = '<div class="search-empty">未找到匹配的工具</div>';
    }

    resultsContainer.innerHTML = html;
    globalSearchState.results = resultsContainer.querySelectorAll('.search-result-item');
    updateSearchSelection();
}

function matchTool(tool, query) {
    if (tool.name.toLowerCase().includes(query)) return true;
    return tool.keywords.some(kw => kw.includes(query));
}

function calculateScore(tool, query) {
    let score = 0;
    if (tool.name.toLowerCase().startsWith(query)) score += 100;
    else if (tool.name.toLowerCase().includes(query)) score += 50;
    tool.keywords.forEach(kw => {
        if (kw.startsWith(query)) score += 30;
        else if (kw.includes(query)) score += 10;
    });
    score += (globalSearchState.usageStats.get(tool.id) || 0) * 2;
    return score;
}

function renderSearchItem(tool, isFavorite) {
    const favClass = isFavorite ? 'is-favorite' : '';
    return `
        <div class="search-result-item ${favClass}" data-tool-id="${tool.id}" onclick="selectSearchResult('${tool.id}')">
            <span class="search-result-icon">${tool.icon}</span>
            <div class="search-result-content">
                <div class="search-result-title">${escapeHtml(tool.name)}</div>
                <div class="search-result-desc">${escapeHtml(tool.categoryName)}</div>
            </div>
            <button class="search-favorite-btn" onclick="event.stopPropagation(); toggleToolFavorite('${tool.id}')" title="${isFavorite ? '取消收藏' : '收藏'}">
                ${isFavorite ? '★' : '☆'}
            </button>
        </div>
    `;
}

function handleSearchKeydown(e) {
    if (!globalSearchState.isOpen) return;

    const items = globalSearchState.results;
    const len = items?.length || 0;

    switch (e.key) {
        case 'ArrowDown':
            e.preventDefault();
            globalSearchState.selectedIndex = Math.min(globalSearchState.selectedIndex + 1, len - 1);
            updateSearchSelection();
            break;
        case 'ArrowUp':
            e.preventDefault();
            globalSearchState.selectedIndex = Math.max(globalSearchState.selectedIndex - 1, -1);
            updateSearchSelection();
            break;
        case 'Enter':
            e.preventDefault();
            if (globalSearchState.selectedIndex >= 0 && items[globalSearchState.selectedIndex]) {
                const toolId = items[globalSearchState.selectedIndex].dataset.toolId;
                selectSearchResult(toolId);
            }
            break;
        case 'Escape':
            e.preventDefault();
            closeSearchModal();
            break;
    }
}

function updateSearchSelection() {
    const items = globalSearchState.results;
    if (!items) return;

    items.forEach((item, idx) => {
        item.classList.toggle('active', idx === globalSearchState.selectedIndex);
        if (idx === globalSearchState.selectedIndex) {
            item.scrollIntoView({ block: 'nearest' });
        }
    });
}

// 选择搜索结果：
// - 搜索弹窗里的条目最终都会落到这里；
// - 这里会关闭弹窗、记录最近使用和使用频次，并回到 switchPage() 完成实际跳转。
function selectSearchResult(toolId) {
    trackToolUsage(toolId);
    closeSearchModal();
    switchPage(toolId);
}

function toggleToolFavorite(toolId) {
    if (globalSearchState.favorites.has(toolId)) {
        globalSearchState.favorites.delete(toolId);
        showToast('已取消收藏', 'info');
    } else {
        globalSearchState.favorites.add(toolId);
        showToast('已添加到收藏', 'success');
    }
    saveSearchPreferences();
    performSearch();
}

// 记录工具使用频次：
// - 只维护轻量统计，用于全局搜索排序和“最近使用”展示；
// - 不涉及后端持久化，因此适合做快速交互反馈。
function trackToolUsage(toolId) {
    const count = globalSearchState.usageStats.get(toolId) || 0;
    globalSearchState.usageStats.set(toolId, count + 1);

    globalSearchState.recentTools = globalSearchState.recentTools.filter(id => id !== toolId);
    globalSearchState.recentTools.unshift(toolId);
    globalSearchState.recentTools = globalSearchState.recentTools.slice(0, 10);

    saveSearchPreferences();
}
