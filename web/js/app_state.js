// ==================== 全局状态（集中管理） ====================
// 说明：
// 1) 本文件只放"跨页面/跨模块共享的状态变量"，避免拆分后状态散落在各个文件里。
// 2) 变量保持为全局绑定（与原 app.js 一致），以便在无构建链场景下被其他脚本直接访问。

// 脚本加载标记（供开机自检使用）
window.__DOG_TOOLBOX_STATE_LOADED__ = true;

// ==================== 通用工具函数（全局依赖，必须最早加载） ====================
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

function openModal(id) {
    document.getElementById(id).classList.add('active');
}

function closeModal(id) {
    document.getElementById(id).classList.remove('active');
}

// pywebview 就绪标记
let _pywebviewReady = false;

// 全局数据缓存
let allCredentials = [];
let allCommands = [];
let allTabs = [];
let currentTabId = null;
let convertedNodes = [];
let expandedCredentialIds = new Set(); // 凭证附加信息展开状态

// 节点转换输出状态
let convertOutputFormat = 'yaml'; // yaml/json
let lastConvertedYaml = '';
let lastConvertedJson = '';

// 工具状态（尽量只保留与 UI/交互相关的轻量状态）
let base64Mode = 'encode'; // encode/decode
let b64HexMode = 'b64_to_hex'; // b64_to_hex/hex_to_b64
let urlMode = 'encode'; // encode/decode
let cryptoMode = 'encrypt'; // encrypt/decrypt
let cryptoLevel = 'advanced'; // advanced/simple
let diffDirection = 'ltr'; // ltr/rtl

// 页面状态
let activePage = null; // 当前激活页面（page-xxx 的 xxx）
let timeNowIntervalId = null; // 时间戳工具：实时刷新定时器
let diffUpdateTimerId = null; // 文本对比：防抖更新

// 页面懒初始化状态
const initializedPages = new Set();
const initializingPages = new Map();

// 页面片段缓存（HTML 字符串）与“是否已注入 DOM”的标记
const pageHtmlCache = new Map();
const pageDomLoaded = new Set();

// ==================== 工具级状态（集中管理） ====================
// 说明：以下为各工具页面的轻量状态/连接句柄等，全局集中在此文件，避免散落在多个 app_tools_* 文件里。

// Markdown 预览
let markdownViewMode = 'split';

// Git / Docker 命令生成器
let currentGitScene = 'commit';
let currentDockerScene = 'run';

// HTTP / WebSocket 工具
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

// ==================== 拖拽/交互瞬态状态（集中管理） ====================
let draggedTabId = null;
let draggedManageTabId = null;
let draggedCommandId = null;
let draggedCredentialId = null;
