/* 工具箱（M40）User-Agent 解析
 *
 * 设计目标：
 * - 解析 User-Agent 字符串
 * - 识别浏览器、操作系统、设备类型
 * - 检测机器人/爬虫
 */
(function (root, factory) {
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = factory();
    } else {
        root.DogToolboxM40Utils = factory();
    }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    // 浏览器匹配规则（顺序重要，优先匹配更具体的）
    const BROWSERS = [
        // 国内应用优先（内嵌浏览器通常也包含 Chrome 标识）
        { name: 'WeChat', pattern: /MicroMessenger\/(\d+[\d.]*)/ },
        { name: 'Alipay', pattern: /AlipayClient\/(\d+[\d.]*)/ },
        { name: 'DingTalk', pattern: /DingTalk\/(\d+[\d.]*)/ },
        { name: 'QQ Browser', pattern: /(?:QQBrowser|MQQBrowser)\/(\d+[\d.]*)/ },
        // 国际浏览器
        { name: 'Edge', pattern: /Edg(?:e|A|iOS)?\/(\d+[\d.]*)/ },
        { name: 'Opera', pattern: /(?:OPR|Opera)\/(\d+[\d.]*)/ },
        { name: 'Samsung Internet', pattern: /SamsungBrowser\/(\d+[\d.]*)/ },
        { name: 'UC Browser', pattern: /UCBrowser\/(\d+[\d.]*)/ },
        { name: 'Sogou Explorer', pattern: /SE (\d+[\d.]*)/ },
        { name: 'Vivaldi', pattern: /Vivaldi\/(\d+[\d.]*)/ },
        { name: 'Brave', pattern: /Brave\/(\d+[\d.]*)/ },
        { name: 'Yandex', pattern: /YaBrowser\/(\d+[\d.]*)/ },
        { name: 'Firefox', pattern: /Firefox\/(\d+[\d.]*)/ },
        { name: 'Electron', pattern: /Electron\/(\d+[\d.]*)/ },
        { name: 'Chrome', pattern: /Chrome\/(\d+[\d.]*)/ },
        { name: 'Safari', pattern: /Version\/(\d+[\d.]*).*Safari/ },
        { name: 'IE', pattern: /(?:MSIE |Trident.*rv:)(\d+[\d.]*)/ },
    ];

    // 操作系统匹配规则
    // 注意：Windows 10 和 11 的 UA 都是 NT 10.0，无法通过 UA 准确区分
    const OS_RULES = [
        { name: 'iOS', pattern: /(?:iPhone|iPad|iPod).*OS (\d+[_\d.]*)/, normalize: v => v.replace(/_/g, '.') },
        { name: 'Android', pattern: /Android (\d+[\d.]*)/ },
        { name: 'macOS', pattern: /Mac OS X (\d+[_\d.]*)/, normalize: v => v.replace(/_/g, '.') },
        { name: 'Windows 10/11', pattern: /Windows NT 10\.0/, version: '10/11' },
        { name: 'Windows 8.1', pattern: /Windows NT 6\.3/, version: '8.1' },
        { name: 'Windows 8', pattern: /Windows NT 6\.2/, version: '8' },
        { name: 'Windows 7', pattern: /Windows NT 6\.1/, version: '7' },
        { name: 'Windows Vista', pattern: /Windows NT 6\.0/, version: 'Vista' },
        { name: 'Windows XP', pattern: /Windows NT 5\.[12]/, version: 'XP' },
        { name: 'Windows', pattern: /Windows/ },
        { name: 'Chrome OS', pattern: /CrOS/ },
        { name: 'HarmonyOS', pattern: /HarmonyOS/ },
        { name: 'Linux', pattern: /Linux/ },
    ];

    // 设备类型检测
    const DEVICE_RULES = [
        { type: 'mobile', pattern: /(?:iPhone|iPod|Android.*Mobile|Windows Phone|BlackBerry|webOS)/i },
        { type: 'tablet', pattern: /(?:iPad|Android(?!.*Mobile)|Tablet)/i },
        { type: 'desktop', pattern: /.*/ }, // 默认
    ];

    // 机器人/爬虫检测
    const BOT_PATTERNS = [
        { name: 'Googlebot', pattern: /Googlebot/i },
        { name: 'Bingbot', pattern: /bingbot/i },
        { name: 'Baiduspider', pattern: /Baiduspider/i },
        { name: 'Sogou Spider', pattern: /Sogou/i },
        { name: '360Spider', pattern: /360Spider/i },
        { name: 'YandexBot', pattern: /YandexBot/i },
        { name: 'DuckDuckBot', pattern: /DuckDuckBot/i },
        { name: 'Slurp', pattern: /Slurp/i },
        { name: 'FacebookBot', pattern: /facebookexternalhit/i },
        { name: 'TwitterBot', pattern: /Twitterbot/i },
        { name: 'LinkedInBot', pattern: /LinkedInBot/i },
        { name: 'Applebot', pattern: /Applebot/i },
        { name: 'GPTBot', pattern: /GPTBot/i },
        { name: 'Claude-Web', pattern: /Claude-Web/i },
        { name: 'curl', pattern: /^curl\//i },
        { name: 'wget', pattern: /^Wget\//i },
        { name: 'Python Requests', pattern: /python-requests/i },
        { name: 'Axios', pattern: /axios/i },
        { name: 'Generic Bot', pattern: /bot|crawler|spider|scraper/i },
    ];

    // 渲染引擎检测
    const ENGINES = [
        { name: 'Blink', pattern: /Chrome\/.*Safari/ },
        { name: 'WebKit', pattern: /AppleWebKit/ },
        { name: 'Gecko', pattern: /Gecko\/\d+/ },
        { name: 'Trident', pattern: /Trident/ },
        { name: 'EdgeHTML', pattern: /Edge\/\d+/ },
        { name: 'Presto', pattern: /Presto/ },
    ];

    /**
     * 解析 User-Agent 字符串
     * @param {string} ua - User-Agent 字符串
     * @returns {object} 解析结果
     */
    function parse(ua) {
        const s = String(ua || '').trim();
        if (!s) {
            return { raw: '', browser: null, os: null, device: null, engine: null, bot: null, isBot: false };
        }

        return {
            raw: s,
            browser: detectBrowser(s),
            os: detectOS(s),
            device: detectDevice(s),
            engine: detectEngine(s),
            bot: detectBot(s),
            isBot: !!detectBot(s),
        };
    }

    function detectBrowser(ua) {
        for (const rule of BROWSERS) {
            const match = ua.match(rule.pattern);
            if (match) {
                return { name: rule.name, version: match[1] || null };
            }
        }
        return null;
    }

    function detectOS(ua) {
        for (const rule of OS_RULES) {
            const match = ua.match(rule.pattern);
            if (match) {
                let version = rule.version || match[1] || null;
                if (version && rule.normalize) {
                    version = rule.normalize(version);
                }
                return { name: rule.name, version };
            }
        }
        return null;
    }

    function detectDevice(ua) {
        for (const rule of DEVICE_RULES) {
            if (rule.pattern.test(ua)) {
                return { type: rule.type };
            }
        }
        return { type: 'unknown' };
    }

    function detectEngine(ua) {
        for (const rule of ENGINES) {
            if (rule.pattern.test(ua)) {
                return { name: rule.name };
            }
        }
        return null;
    }

    function detectBot(ua) {
        for (const rule of BOT_PATTERNS) {
            if (rule.pattern.test(ua)) {
                return { name: rule.name };
            }
        }
        return null;
    }

    /**
     * 格式化解析结果为可读字符串
     */
    function formatResult(result) {
        if (!result || !result.raw) {
            return '无有效的 User-Agent';
        }

        const lines = [];

        if (result.isBot && result.bot) {
            lines.push(`🤖 机器人/爬虫: ${result.bot.name}`);
        }

        if (result.browser) {
            lines.push(`🌐 浏览器: ${result.browser.name}${result.browser.version ? ' ' + result.browser.version : ''}`);
        }

        if (result.os) {
            lines.push(`💻 操作系统: ${result.os.name}${result.os.version ? ' ' + result.os.version : ''}`);
        }

        if (result.device) {
            const deviceIcons = { mobile: '📱', tablet: '📲', desktop: '🖥️' };
            const deviceNames = { mobile: '移动设备', tablet: '平板设备', desktop: '桌面设备' };
            lines.push(`${deviceIcons[result.device.type] || '❓'} 设备类型: ${deviceNames[result.device.type] || result.device.type}`);
        }

        if (result.engine) {
            lines.push(`⚙️ 渲染引擎: ${result.engine.name}`);
        }

        return lines.join('\n');
    }

    /**
     * 生成常见 User-Agent 示例
     */
    function getSamples() {
        return [
            { name: 'Chrome (Windows)', ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' },
            { name: 'Chrome (macOS)', ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' },
            { name: 'Firefox (Windows)', ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0' },
            { name: 'Safari (macOS)', ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_2) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15' },
            { name: 'Safari (iPhone)', ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Mobile/15E148 Safari/604.1' },
            { name: 'Chrome (Android)', ua: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36' },
            { name: 'Edge (Windows)', ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0' },
            { name: 'WeChat (Android)', ua: 'Mozilla/5.0 (Linux; Android 14; Pixel 8 Build/UQ1A.240205.002) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/116.0.0.0 Mobile Safari/537.36 MicroMessenger/8.0.43.2400' },
            { name: 'Googlebot', ua: 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)' },
            { name: 'curl', ua: 'curl/8.4.0' },
        ];
    }

    return {
        parse,
        format: formatResult,
        getSamples,
        detectBrowser,
        detectOS,
        detectDevice,
        detectEngine,
        detectBot,
    };
});
