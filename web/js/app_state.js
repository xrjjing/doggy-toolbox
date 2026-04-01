/*
 * 文件总览：前端全局共享状态与最早加载的通用工具。
 *
 * 这个文件的定位是“无构建链场景下的全局地基”：
 * - 放跨页面、跨模块都要共用的状态变量；
 * - 放其他脚本一进来就可能调用的基础函数，比如 escape、弹窗开关；
 * - 尽量不放业务流程本身，避免状态和行为混在一起难追踪。
 *
 * 调用关系：
 * - web/index.html 会优先加载本文件；
 * - 后续 app_core.js、app_computer_usage.js、app_tools_*.js、app_ai_*.js 都会直接依赖这里暴露的全局函数和状态；
 * - 如果多个页面同时出现“变量未定义”或弹窗/转义函数失效，优先回看这里是否被正确加载。
 */

// ==================== 全局状态（集中管理） ====================
// 这里存放跨页面共享的运行时变量，目标是让其他脚本无需重复声明同名状态。
// 说明：
// 1) 本文件只放“跨页面/跨模块共享的状态变量”，避免拆分后状态散落在各个文件里。
// 2) 变量保持为全局绑定（与原 app.js 一致），以便在无构建链场景下被其他脚本直接访问。

// 脚本加载标记（供开机自检使用）
window.__DOG_TOOLBOX_STATE_LOADED__ = true;

// ==================== 通用工具函数（全局依赖，必须最早加载） ====================
// 这些函数通常会在页面切换、模板渲染、弹窗开关时被直接调用，是前端最底层的公共能力。
// 这几类函数属于“所有模块都可能直接调用”的基础设施：
// - HTML / 属性转义：避免模板拼接时把用户输入直接打进 innerHTML；
// - 模态框开关：让各业务文件可以统一用 openModal / closeModal 控制弹窗。
/**
 * 把普通文本安全地转成可放进 innerHTML 的字符串。
 *
 * 适用场景：
 * - 列表项标题
 * - 说明文字
 * - 卡片中的文本块
 * - 任何“原始输入最终要显示在页面上”的位置
 *
 * 它不是做样式处理，而是做“显示安全处理”：
 * 通过借助浏览器原生 DOM 的 textContent 编码能力，
 * 避免用户输入中的 `<script>`、`<div>`、`&` 之类内容被当成真正 HTML 解析。
 *
 * 排查建议：
 * - 页面上出现被意外解析的标签、文本断裂、HTML 注入风险时，先确认渲染前是否经过这里。
 */
function escapeHtml(text) {
    if (text === null || text === undefined) return '';
    const div = document.createElement('div');
    div.textContent = String(text);
    return div.innerHTML;
}

/**
 * 把字符串安全地转成可放进 HTML 属性里的值。
 *
 * 典型用途：
 * - data-* 属性
 * - title / value / placeholder 这类属性值
 * - 需要拼进双引号或单引号属性的动态内容
 *
 * 相比 escapeHtml()，这里会额外处理单双引号和反引号，
 * 因为属性上下文里最容易出问题的，就是“字符串把引号提前闭合”。
 *
 * 排查建议：
 * - 某个按钮的 data-id、title、value 异常截断或出现引号错位时，优先回看是否用了这里。
 */
function escapeAttr(text) {
    if (text === null || text === undefined) return '';
    return String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;')
        .replace(/`/g, '&#96;');
}

/**
 * 打开指定 id 的模态框。
 *
 * 这里的打开方式很简单：给目标元素加上 `active` class。
 * 也就是说，真正控制“弹窗是否可见、遮罩是否出现、动画怎么播”的，
 * 主要还是对应 HTML 结构和 CSS 样式。
 *
 * 排查建议：
 * - 调用了 openModal() 但弹窗没显示：先看 DOM 中是否存在这个 id；
 * - 再看 CSS 是否为 `.active` 提供了显示样式。
 */
function openModal(id) {
    document.getElementById(id).classList.add('active');
}

/**
 * 关闭指定 id 的模态框。
 *
 * 关闭动作与 openModal() 相反：
 * - 通过移除 `active` class，让弹窗回到隐藏状态。
 *
 * 这属于全局公共关闭入口，所以很多业务文件只会传入弹窗 id，
 * 真正的隐藏效果同样由 HTML + CSS 决定。
 *
 * 排查建议：
 * - 点关闭按钮没反应：先看按钮事件有没有走到这里；
 * - 如果走到了这里还不消失，再看目标节点 class 是否真的被移除。
 */
function closeModal(id) {
    document.getElementById(id).classList.remove('active');
}

// pywebview 就绪标记：
// - app_core.js 会结合 waitForPywebview() 和事件监听更新它；
// - 其它模块看到它为 false 时，通常意味着后端 API 还没真正可用。
let _pywebviewReady = false;

// 全局数据缓存：
// 这些数据大多来自 window.pywebview.api，再由各页面渲染函数消费。
// 之所以放在这里，是为了在“切页返回”“搜索过滤”“拖拽排序”时避免重复定义。
let allCredentials = [];
let allCommands = [];
let allTabs = [];
let currentTabId = null;
let convertedNodes = [];
let expandedCredentialIds = new Set(); // 凭证附加信息展开状态

// 节点转换输出状态：
// app_nodes_converter.js 会根据这些值决定输出面板渲染 YAML 还是 JSON。
let convertOutputFormat = 'yaml'; // yaml/json
let lastConvertedYaml = '';
let lastConvertedJson = '';

// 工具状态（尽量只保留与 UI/交互相关的轻量状态）：
// 这里不存业务结果明细，主要记录“当前模式”“当前方向”“当前等级”这类 UI 选择。
let base64Mode = 'encode'; // encode/decode
let b64HexMode = 'b64_to_hex'; // b64_to_hex/hex_to_b64
let urlMode = 'encode'; // encode/decode
let cryptoMode = 'encrypt'; // encrypt/decrypt
let cryptoLevel = 'advanced'; // advanced/simple
let diffDirection = 'ltr'; // ltr/rtl

// 页面状态：
// - activePage 是页面切换、全局 AI 按钮刷新、工具联动的核心判断依据；
// - timeNowIntervalId / diffUpdateTimerId 属于页面进入/离开时要清理的瞬态句柄。
let activePage = null; // 当前激活页面（page-xxx 的 xxx）
let timeNowIntervalId = null; // 时间戳工具：实时刷新定时器
let diffUpdateTimerId = null; // 文本对比：防抖更新

// 页面懒初始化状态：
// app_core.js 会用这两份状态避免“同一页重复初始化”或“初始化过程中被再次触发”。
const initializedPages = new Set();
const initializingPages = new Map();

// 页面片段缓存（HTML 字符串）与“是否已注入 DOM”的标记：
// 项目当前是“index.html 壳 + web/pages/*.html 动态注入”的结构，
// 因此页面 HTML 会先缓存文本，再标记是否已真正挂进 DOM。
const pageHtmlCache = new Map();
const pageDomLoaded = new Set();

// ==================== 工具级状态（集中管理） ====================
// 这一段保存各工具页自己的当前模式/缓存结果，页面切换后再次进入时会继续复用。
// 说明：以下为各工具页面的轻量状态/连接句柄等，全局集中在此文件，避免散落在多个 app_tools_* 文件里。
// 这里的设计目标不是“统一处理业务”，而是统一保存当前工具的界面模式和临时句柄。

// Markdown 预览
let markdownViewMode = 'split';

// Git / Docker 命令生成器
let currentGitScene = 'commit';
let currentDockerScene = 'run';

// HTTP / WebSocket 工具：
// - httpBodyType 影响请求体编辑器渲染；
// - wsConnection / wsMessages / 自动重连状态用于 WebSocket 调试页生命周期管理。
let httpBodyType = 'none';
let wsConnection = null;
let wsMessages = [];
let wsAutoReconnect = false;
let wsReconnectTimer = null;

// CSV 工具
let csvInputFormat = 'csv';
let csvOutputFormat = 'json';

// 二维码工具
let qrcodeCanvas = null;
let qrcodeDataUrl = null;

// Unicode / RSA / JSON / 数据转换等工具状态
let unicodeMode = 'encode';
let rsaMode = 'encrypt';
let jsonIndent = 2;
let jsonViewMode = 'text';
let dataInputFormat = 'auto';
let dataOutputFormat = 'yaml';
let curlState = {
    parsed: null,
    lang: 'fetch',
};
let sqlMode = 'format';

// ==================== 工具联动状态 ====================
// 用于“从一个页面把数据带到另一个工具页”的临时桥接，例如格式转换后跳去下游工具继续处理。
// “工具联动”指一个工具把结果直接带到另一个工具继续处理。
// 例如 curl 解析后跳转到 HTTP 请求页、JSON Schema 跳到 Mock 工具继续生成数据。
let toolDataBridge = {
    sourceToolId: null,
    targetToolId: null,
    data: null,
    dataType: null,
    timestamp: null,
    status: null  // pending | consumed | error
};

// ==================== 全局搜索状态 ====================
// 全局搜索会跨页面检索入口，因此状态单独集中，避免切页时搜索条件莫名丢失。
// 全局搜索弹窗会依赖这些状态保存：
// - 当前是否打开
// - 当前查询词
// - 当前高亮项
// - 收藏、最近使用、使用频次
let globalSearchState = {
    isOpen: false,
    query: '',
    selectedIndex: -1,
    results: [],
    favorites: new Set(),
    recentTools: [],
    usageStats: new Map()
};

// ==================== 拖拽/交互瞬态状态（集中管理） ====================
// 这里保存拖拽排序、临时选中项等瞬时 UI 状态，排查“拖不动/顺序错乱”时应一起看。
// 这些变量只在拖拽排序时短暂生效，用来记录“当前正在被拖动的是谁”。
let draggedTabId = null;
let draggedManageTabId = null;
let draggedCommandId = null;
let draggedCredentialId = null;
