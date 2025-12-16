/* 工具箱（M29）Mock 数据生成工具
 *
 * 设计目标：
 * - 纯算法、无 DOM 依赖，便于在浏览器与 Node 环境复用与单元测试
 * - 生成各种类型的模拟数据：姓名、邮箱、手机号、身份证、地址等
 * - 支持模板解析和批量生成
 */
(function (root, factory) {
    // UMD：浏览器挂到 window；Node 通过 module.exports 导出
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = factory();
    } else {
        root.DogToolboxM29Utils = factory();
    }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    // 中文姓氏库（常见姓氏）
    const SURNAMES = [
        '王', '李', '张', '刘', '陈', '杨', '黄', '赵', '周', '吴',
        '徐', '孙', '马', '朱', '胡', '郭', '何', '高', '林', '罗',
        '郑', '梁', '谢', '宋', '唐', '许', '韩', '冯', '邓', '曹',
        '彭', '曾', '肖', '田', '董', '袁', '潘', '于', '蒋', '蔡',
        '余', '杜', '叶', '程', '苏', '魏', '吕', '丁', '任', '沈'
    ];

    // 中文名字常用字库
    const NAME_CHARS = [
        '伟', '芳', '娜', '秀', '敏', '静', '丽', '强', '磊', '军',
        '洋', '勇', '艳', '杰', '娟', '涛', '明', '超', '秀', '英',
        '华', '文', '慧', '玉', '萍', '红', '鹏', '宇', '婷', '霞',
        '建', '亮', '雷', '东', '波', '辉', '俊', '峰', '飞', '平',
        '阳', '健', '斌', '琳', '鑫', '云', '龙', '浩', '刚', '帆'
    ];

    // 省份列表
    const PROVINCES = [
        '北京', '上海', '天津', '重庆', '河北', '山西', '辽宁', '吉林',
        '黑龙江', '江苏', '浙江', '安徽', '福建', '江西', '山东', '河南',
        '湖北', '湖南', '广东', '海南', '四川', '贵州', '云南', '陕西',
        '甘肃', '青海', '台湾', '内蒙古', '广西', '西藏', '宁夏', '新疆'
    ];

    // 城市列表（示例）
    const CITIES = [
        '市', '县', '区', '镇', '街道'
    ];

    // 街道名称常用字
    const STREET_WORDS = [
        '中山', '人民', '建设', '解放', '胜利', '和平', '光明', '新华',
        '文化', '民主', '工业', '朝阳', '东风', '西湖', '南京', '北京',
        '上海', '天府', '长江', '黄河', '春天', '幸福', '平安', '富强'
    ];

    const STREET_TYPES = ['路', '街', '大道', '巷', '弄'];

    // 邮箱域名
    const EMAIL_DOMAINS = [
        'qq.com', '163.com', '126.com', 'gmail.com', 'outlook.com',
        'hotmail.com', 'sina.com', 'sohu.com', 'yahoo.com', 'foxmail.com'
    ];

    // 手机号段（中国大陆）
    const MOBILE_PREFIXES = [
        '130', '131', '132', '133', '134', '135', '136', '137', '138', '139',
        '145', '147', '149', '150', '151', '152', '153', '155', '156', '157',
        '158', '159', '162', '165', '166', '167', '170', '171', '172', '173',
        '175', '176', '177', '178', '180', '181', '182', '183', '184', '185',
        '186', '187', '188', '189', '190', '191', '192', '193', '195', '196',
        '197', '198', '199'
    ];

    // 身份证地区码（前6位）示例
    const ID_CARD_AREA_CODES = [
        '110101', '110102', '310101', '310104', '320101', '320102',
        '330101', '330102', '440101', '440103', '440104', '440105',
        '500101', '500102', '510101', '510104', '610101', '610102'
    ];

    // ========== 工具函数 ==========

    function randomInt(min, max) {
        return Math.floor(Math.random() * (max - min + 1)) + min;
    }

    function randomItem(array) {
        if (!array || array.length === 0) return null;
        return array[randomInt(0, array.length - 1)];
    }

    function randomBoolean() {
        return Math.random() < 0.5;
    }

    function randomFloat(min, max, decimals = 2) {
        const value = Math.random() * (max - min) + min;
        return Number(value.toFixed(decimals));
    }

    function padZero(num, length = 2) {
        return String(num).padStart(length, '0');
    }

    // ========== 基础数据生成 ==========

    /**
     * 生成随机中文姓名
     * @param {Object} options - 选项 {length: 2|3, surname: '指定姓氏'}
     * @returns {string}
     */
    function randomName(options = {}) {
        const length = options.length || (randomBoolean() ? 2 : 3);
        const surname = options.surname || randomItem(SURNAMES);

        const nameLength = length - 1;
        let name = surname;

        for (let i = 0; i < nameLength; i++) {
            name += randomItem(NAME_CHARS);
        }

        return name;
    }

    /**
     * 生成随机邮箱
     * @param {Object} options - 选项 {prefix: '前缀', domain: '域名'}
     * @returns {string}
     */
    function randomEmail(options = {}) {
        const prefix = options.prefix || `user${randomInt(1000, 99999)}`;
        const domain = options.domain || randomItem(EMAIL_DOMAINS);
        return `${prefix}@${domain}`;
    }

    /**
     * 生成随机手机号（中国大陆）
     * @returns {string}
     */
    function randomPhone() {
        const prefix = randomItem(MOBILE_PREFIXES);
        const suffix = padZero(randomInt(0, 99999999), 8);
        return prefix + suffix;
    }

    /**
     * 生成随机身份证号（18位，简化版）
     * @param {Object} options - 选项 {birthYear: 年份范围}
     * @returns {string}
     */
    function randomIdCard(options = {}) {
        const areaCode = randomItem(ID_CARD_AREA_CODES);
        const birthYear = options.birthYear || randomInt(1970, 2005);
        const birthMonth = padZero(randomInt(1, 12));
        const birthDay = padZero(randomInt(1, 28));
        const birthDate = `${birthYear}${birthMonth}${birthDay}`;
        const sequence = padZero(randomInt(1, 999), 3);

        // 前17位
        const id17 = areaCode + birthDate + sequence;

        // 计算校验码（简化版，使用随机）
        const checkCodes = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', 'X'];
        const checkCode = randomItem(checkCodes);

        return id17 + checkCode;
    }

    /**
     * 生成随机地址
     * @returns {string}
     */
    function randomAddress() {
        const province = randomItem(PROVINCES);
        const city = randomItem(['市', '县']);
        const district = randomItem(['区', '县', '市']);
        const street = randomItem(STREET_WORDS) + randomItem(STREET_TYPES);
        const number = randomInt(1, 999);
        const building = randomInt(1, 30);
        const unit = randomInt(1, 6);
        const room = padZero(randomInt(1, 99), 2) + padZero(randomInt(1, 10), 2);

        return `${province}省${city}${district}${street}${number}号${building}栋${unit}单元${room}`;
    }

    /**
     * 生成随机 UUID v4
     * @returns {string}
     */
    function randomUuid() {
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
            const r = Math.random() * 16 | 0;
            const v = c === 'x' ? r : (r & 0x3 | 0x8);
            return v.toString(16);
        });
    }

    /**
     * 生成随机日期
     * @param {Object} options - 选项 {start: Date, end: Date, format: 'iso'|'date'|'datetime'|'timestamp'}
     * @returns {string|number}
     */
    function randomDate(options = {}) {
        const start = options.start || new Date(1970, 0, 1);
        const end = options.end || new Date();
        const format = options.format || 'iso';

        const startTime = start instanceof Date ? start.getTime() : new Date(start).getTime();
        const endTime = end instanceof Date ? end.getTime() : new Date(end).getTime();

        const timestamp = randomInt(startTime, endTime);
        const date = new Date(timestamp);

        switch (format) {
            case 'timestamp':
                return timestamp;
            case 'date':
                return `${date.getFullYear()}-${padZero(date.getMonth() + 1)}-${padZero(date.getDate())}`;
            case 'datetime':
                return `${date.getFullYear()}-${padZero(date.getMonth() + 1)}-${padZero(date.getDate())} ${padZero(date.getHours())}:${padZero(date.getMinutes())}:${padZero(date.getSeconds())}`;
            case 'iso':
            default:
                return date.toISOString();
        }
    }

    /**
     * 生成随机整数
     * @param {number} min - 最小值
     * @param {number} max - 最大值
     * @returns {number}
     */
    function randomInteger(min, max) {
        return randomInt(min, max);
    }

    /**
     * 生成随机浮点数
     * @param {number} min - 最小值
     * @param {number} max - 最大值
     * @param {number} decimals - 小数位数
     * @returns {number}
     */
    function randomNumber(min, max, decimals = 2) {
        return randomFloat(min, max, decimals);
    }

    /**
     * 生成随机金额（保留2位小数）
     * @param {number} min - 最小值
     * @param {number} max - 最大值
     * @returns {string}
     */
    function randomAmount(min = 0, max = 10000) {
        return randomFloat(min, max, 2).toFixed(2);
    }

    /**
     * 生成随机颜色
     * @param {string} format - 格式：'hex'|'rgb'|'rgba'
     * @returns {string}
     */
    function randomColor(format = 'hex') {
        const r = randomInt(0, 255);
        const g = randomInt(0, 255);
        const b = randomInt(0, 255);

        switch (format) {
            case 'rgb':
                return `rgb(${r}, ${g}, ${b})`;
            case 'rgba':
                const a = randomFloat(0, 1, 2);
                return `rgba(${r}, ${g}, ${b}, ${a})`;
            case 'hex':
            default:
                return '#' + [r, g, b].map(x => x.toString(16).padStart(2, '0')).join('');
        }
    }

    /**
     * 生成随机 IP 地址
     * @returns {string}
     */
    function randomIp() {
        return [
            randomInt(1, 255),
            randomInt(0, 255),
            randomInt(0, 255),
            randomInt(1, 254)
        ].join('.');
    }

    /**
     * 生成随机 URL
     * @param {Object} options - 选项 {protocol: 'http'|'https', domain: '域名'}
     * @returns {string}
     */
    function randomUrl(options = {}) {
        const protocol = options.protocol || (randomBoolean() ? 'https' : 'http');
        const domain = options.domain || `example${randomInt(1, 100)}.com`;
        const path = options.path || `/path/${randomInt(1, 1000)}`;
        return `${protocol}://${domain}${path}`;
    }

    // ========== 模板解析和生成 ==========

    /**
     * 解析模板字符串中的占位符
     * 支持的占位符格式：
     * - {{name}} - 姓名
     * - {{email}} - 邮箱
     * - {{phone}} - 手机号
     * - {{idCard}} - 身份证
     * - {{address}} - 地址
     * - {{uuid}} - UUID
     * - {{int:min:max}} - 整数范围
     * - {{float:min:max:decimals}} - 浮点数范围
     * - {{date:format}} - 日期
     * - {{boolean}} - 布尔值
     * - {{color:format}} - 颜色
     * - {{ip}} - IP地址
     * - {{url}} - URL
     *
     * @param {string} template - 模板字符串
     * @returns {string}
     */
    function parseTemplate(template) {
        if (typeof template !== 'string') {
            return String(template);
        }

        return template.replace(/\{\{([^}]+)\}\}/g, (match, expr) => {
            const parts = expr.trim().split(':');
            const type = parts[0];

            try {
                switch (type) {
                    case 'name':
                        return randomName();
                    case 'email':
                        return randomEmail();
                    case 'phone':
                        return randomPhone();
                    case 'idCard':
                        return randomIdCard();
                    case 'address':
                        return randomAddress();
                    case 'uuid':
                        return randomUuid();
                    case 'int':
                    case 'integer': {
                        const min = parseInt(parts[1]) || 0;
                        const max = parseInt(parts[2]) || 100;
                        return randomInteger(min, max);
                    }
                    case 'float':
                    case 'number': {
                        const min = parseFloat(parts[1]) || 0;
                        const max = parseFloat(parts[2]) || 100;
                        const decimals = parseInt(parts[3]) || 2;
                        return randomNumber(min, max, decimals);
                    }
                    case 'amount': {
                        const min = parseFloat(parts[1]) || 0;
                        const max = parseFloat(parts[2]) || 10000;
                        return randomAmount(min, max);
                    }
                    case 'date': {
                        const format = parts[1] || 'iso';
                        return randomDate({ format });
                    }
                    case 'boolean':
                    case 'bool':
                        return randomBoolean();
                    case 'color': {
                        const format = parts[1] || 'hex';
                        return randomColor(format);
                    }
                    case 'ip':
                        return randomIp();
                    case 'url':
                        return randomUrl();
                    default:
                        return match; // 未识别的保持原样
                }
            } catch (e) {
                return match; // 出错时保持原样
            }
        });
    }

    /**
     * 根据模板对象生成 Mock 数据
     * @param {Object} template - 模板对象，支持嵌套
     * @returns {Object}
     */
    function generateFromTemplate(template) {
        if (template === null || template === undefined) {
            return template;
        }

        // 字符串：解析占位符
        if (typeof template === 'string') {
            // 检测是否是纯占位符（保持原始类型）
            const purePlaceholder = template.match(/^\{\{([^}]+)\}\}$/);
            if (purePlaceholder) {
                const expr = purePlaceholder[1];
                const parts = expr.trim().split(':');
                const type = parts[0];

                try {
                    switch (type) {
                        case 'name':
                            return randomName();
                        case 'email':
                            return randomEmail();
                        case 'phone':
                            return randomPhone();
                        case 'idCard':
                            return randomIdCard();
                        case 'address':
                            return randomAddress();
                        case 'uuid':
                            return randomUuid();
                        case 'int':
                        case 'integer': {
                            const min = parseInt(parts[1]) || 0;
                            const max = parseInt(parts[2]) || 100;
                            return randomInteger(min, max); // 返回数字类型
                        }
                        case 'float':
                        case 'number': {
                            const min = parseFloat(parts[1]) || 0;
                            const max = parseFloat(parts[2]) || 100;
                            const decimals = parseInt(parts[3]) || 2;
                            return randomNumber(min, max, decimals); // 返回数字类型
                        }
                        case 'amount': {
                            const min = parseFloat(parts[1]) || 0;
                            const max = parseFloat(parts[2]) || 10000;
                            return randomAmount(min, max); // 返回数字类型
                        }
                        case 'bool':
                        case 'boolean':
                            return randomBoolean(); // 返回布尔类型
                        case 'date': {
                            const format = parts[1] || 'iso';
                            return randomDate({ format });
                        }
                        default:
                            return template;
                    }
                } catch (e) {
                    return template;
                }
            }

            // 非纯占位符，使用字符串替换
            return parseTemplate(template);
        }

        // 数组：递归处理每个元素
        if (Array.isArray(template)) {
            return template.map(item => generateFromTemplate(item));
        }

        // 对象：递归处理每个属性
        if (typeof template === 'object') {
            const result = {};
            for (const key in template) {
                if (template.hasOwnProperty(key)) {
                    result[key] = generateFromTemplate(template[key]);
                }
            }
            return result;
        }

        // 其他类型：原样返回
        return template;
    }

    /**
     * 批量生成 Mock 数据
     * @param {Object|string} template - 模板（对象或字符串）
     * @param {number} count - 生成数量
     * @returns {Array}
     */
    function generateMock(template, count = 1) {
        if (count < 1) {
            throw new Error('生成数量必须大于 0');
        }

        const result = [];
        for (let i = 0; i < count; i++) {
            result.push(generateFromTemplate(template));
        }

        return result;
    }

    /**
     * 从预设模板生成数据
     * @param {string} presetName - 预设名称
     * @param {number} count - 生成数量
     * @returns {Array}
     */
    function generateFromPreset(presetName, count = 1) {
        const presets = {
            'user': {
                id: '{{int:1:99999}}',
                name: '{{name}}',
                email: '{{email}}',
                phone: '{{phone}}',
                age: '{{int:18:60}}',
                address: '{{address}}'
            },
            'order': {
                orderId: '{{uuid}}',
                userId: '{{int:1:10000}}',
                amount: '{{amount:10:5000}}',
                status: '{{int:0:3}}',
                createdAt: '{{date:datetime}}'
            },
            'product': {
                id: '{{int:1:9999}}',
                name: 'Product {{int:1:100}}',
                price: '{{amount:0.01:999.99}}',
                stock: '{{int:0:1000}}',
                color: '{{color:hex}}'
            }
        };

        const template = presets[presetName];
        if (!template) {
            throw new Error(`未找到预设模板: ${presetName}`);
        }

        return generateMock(template, count);
    }

    // ========== 格式化输出 ==========
    /**
     * 将 mock 数据按指定格式序列化输出
     * @param {Array<Object>} data - 数据数组
     * @param {'json'|'jsonlines'|'csv'|'sql'} format - 输出格式
     * @returns {string} 格式化后的字符串
     */
    function formatOutput(data, format) {
        const rows = Array.isArray(data) ? data : [];
        const fmt = (format || '').toLowerCase();

        if (fmt === 'jsonlines') {
            return rows.map(r => JSON.stringify(r)).join('\n');
        }

        if (fmt === 'csv') {
            if (!rows.length) return '';
            const headers = Object.keys(rows[0]);
            const esc = v => {
                if (v === null || v === undefined) return '';
                const s = String(v);
                const needsWrap = /[",\n]/.test(s);
                const body = s.replace(/"/g, '""');
                return needsWrap ? `"${body}"` : body;
            };
            const lines = [
                headers.join(','),
                ...rows.map(r => headers.map(h => esc(r[h])).join(','))
            ];
            return lines.join('\n');
        }

        if (fmt === 'sql') {
            if (!rows.length) return '';
            const table = 'mock_table';
            const cols = Object.keys(rows[0]);
            const escVal = v => {
                if (v === null || v === undefined) return 'NULL';
                if (typeof v === 'number' || typeof v === 'boolean') return String(v);
                return `'${String(v).replace(/'/g, "''")}'`;
            };
            const values = rows
                .map(r => `(${cols.map(c => escVal(r[c])).join(', ')})`)
                .join(',\n');
            return `INSERT INTO ${table} (${cols.join(', ')}) VALUES\n${values};`;
        }

        // 默认或 json
        return JSON.stringify(rows, null, 2);
    }

    // ========== 导出接口 ==========
    return {
        // 基础数据生成函数
        randomName,
        randomEmail,
        randomPhone,
        randomIdCard,
        randomAddress,
        randomUuid,
        randomDate,
        randomInteger,
        randomNumber,
        randomAmount,
        randomBoolean,
        randomColor,
        randomIp,
        randomUrl,

        // 工具函数
        randomInt,
        randomItem,
        randomFloat,

        // 模板解析和生成
        parseTemplate,
        generateFromTemplate,
        generateMock,
        generateFromPreset,

        // 格式化输出
        formatOutput
    };
});
