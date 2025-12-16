/* 工具箱（M32）日期计算器
 *
 * 设计目标：
 * - 纯算法、无 DOM 依赖
 * - 支持日期差值计算（天/月/年）
 * - 支持日期加减运算
 * - 支持星期计算、周数计算
 * - 支持闰年判断、月天数计算
 * - 支持多种日期格式解析
 * - 支持年龄计算
 */
(function (root, factory) {
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = factory();
    } else {
        root.DogToolboxM32Utils = factory();
    }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    // ==================== 日期解析 ====================
    /**
     * 解析日期字符串为 Date 对象
     * 支持格式：YYYY-MM-DD, YYYY/MM/DD, YYYY.MM.DD, ISO 8601
     */
    function parseDate(dateStr) {
        if (!dateStr) throw new Error('日期不能为空');

        const str = String(dateStr).trim();

        // 尝试 ISO 格式
        let date = new Date(str);
        if (!isNaN(date.getTime())) {
            return date;
        }

        // 尝试常见格式：YYYY-MM-DD, YYYY/MM/DD, YYYY.MM.DD
        const patterns = [
            /^(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})$/,
        ];

        for (const pattern of patterns) {
            const match = str.match(pattern);
            if (match) {
                const [, year, month, day] = match;
                date = new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
                if (!isNaN(date.getTime())) {
                    return date;
                }
            }
        }

        throw new Error(`无法解析日期：${dateStr}`);
    }

    // ==================== 日期格式化 ====================
    /**
     * 格式化日期
     * @param {Date} date - 日期对象
     * @param {string} format - 格式字符串，默认 'YYYY-MM-DD'
     */
    function formatDate(date, format = 'YYYY-MM-DD') {
        if (!(date instanceof Date) || isNaN(date.getTime())) {
            throw new Error('无效的日期对象');
        }

        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        const hours = String(date.getHours()).padStart(2, '0');
        const minutes = String(date.getMinutes()).padStart(2, '0');
        const seconds = String(date.getSeconds()).padStart(2, '0');

        return format
            .replace('YYYY', year)
            .replace('MM', month)
            .replace('DD', day)
            .replace('HH', hours)
            .replace('mm', minutes)
            .replace('ss', seconds);
    }

    // ==================== 闰年判断 ====================
    function isLeapYear(year) {
        return (year % 4 === 0 && year % 100 !== 0) || (year % 400 === 0);
    }

    // ==================== 获取月份天数 ====================
    function getDaysInMonth(year, month) {
        // month: 1-12
        if (month === 2) {
            return isLeapYear(year) ? 29 : 28;
        }
        if ([4, 6, 9, 11].includes(month)) {
            return 30;
        }
        return 31;
    }

    // ==================== 日期差值计算 ====================
    /**
     * 计算两个日期之间的差值
     * @param {string|Date} date1 - 起始日期
     * @param {string|Date} date2 - 结束日期
     * @returns {object} 包含天数、月数、年数等信息
     */
    function dateDifference(date1, date2) {
        const d1 = date1 instanceof Date ? date1 : parseDate(date1);
        const d2 = date2 instanceof Date ? date2 : parseDate(date2);

        // 确保 d1 <= d2
        const [start, end] = d1 <= d2 ? [d1, d2] : [d2, d1];

        // 计算总天数差
        const msPerDay = 24 * 60 * 60 * 1000;
        const totalDays = Math.floor((end - start) / msPerDay);

        // 计算年月日差
        let years = end.getFullYear() - start.getFullYear();
        let months = end.getMonth() - start.getMonth();
        let days = end.getDate() - start.getDate();

        if (days < 0) {
            months--;
            const prevMonth = new Date(end.getFullYear(), end.getMonth(), 0);
            days += prevMonth.getDate();
        }

        if (months < 0) {
            years--;
            months += 12;
        }

        // 计算周数
        const weeks = Math.floor(totalDays / 7);

        // 计算小时、分钟、秒
        const totalSeconds = Math.floor((end - start) / 1000);
        const hours = Math.floor(totalSeconds / 3600);
        const minutes = Math.floor(totalSeconds / 60);

        return {
            years,
            months,
            days,
            totalDays,
            weeks,
            hours,
            minutes,
            seconds: totalSeconds
        };
    }

    // ==================== 日期加减 ====================
    /**
     * 对日期进行加减运算
     * @param {string|Date} date - 基准日期
     * @param {number} value - 数值（正数为加，负数为减）
     * @param {string} unit - 单位：'days', 'weeks', 'months', 'years'
     * @returns {Date} 计算后的日期
     */
    function dateAdd(date, value, unit = 'days') {
        const d = date instanceof Date ? new Date(date) : parseDate(date);
        const val = parseInt(value);

        if (isNaN(val)) {
            throw new Error('数值必须是有效的整数');
        }

        switch (unit.toLowerCase()) {
            case 'days':
            case 'day':
                d.setDate(d.getDate() + val);
                break;
            case 'weeks':
            case 'week':
                d.setDate(d.getDate() + val * 7);
                break;
            case 'months':
            case 'month':
                d.setMonth(d.getMonth() + val);
                break;
            case 'years':
            case 'year':
                d.setFullYear(d.getFullYear() + val);
                break;
            default:
                throw new Error(`不支持的单位：${unit}`);
        }

        return d;
    }

    // ==================== 星期计算 ====================
    /**
     * 获取星期信息
     * @param {string|Date} date - 日期
     * @returns {object} 包含中英文星期名称
     */
    function getWeekday(date) {
        const d = date instanceof Date ? date : parseDate(date);
        const dayIndex = d.getDay(); // 0-6, 0为周日

        const weekdaysEn = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
        const weekdaysCn = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];
        const weekdaysShort = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

        return {
            index: dayIndex,
            nameEn: weekdaysEn[dayIndex],
            nameCn: weekdaysCn[dayIndex],
            nameShort: weekdaysShort[dayIndex],
            isWeekend: dayIndex === 0 || dayIndex === 6
        };
    }

    // ==================== 周数计算 ====================
    /**
     * 获取 ISO 周数（一年的第几周）
     * @param {string|Date} date - 日期
     * @returns {object} 包含周数信息
     */
    function getWeekNumber(date) {
        const d = date instanceof Date ? new Date(date) : parseDate(date);

        // ISO 8601 周数
        const temp = new Date(d.getTime());
        temp.setHours(0, 0, 0, 0);
        temp.setDate(temp.getDate() + 3 - (temp.getDay() + 6) % 7);
        const week1 = new Date(temp.getFullYear(), 0, 4);
        const isoWeek = 1 + Math.round(((temp - week1) / 86400000 - 3 + (week1.getDay() + 6) % 7) / 7);

        // 月内周数
        const firstDayOfMonth = new Date(d.getFullYear(), d.getMonth(), 1);
        const weekOfMonth = Math.ceil((d.getDate() + firstDayOfMonth.getDay()) / 7);

        return {
            isoWeek,
            weekOfMonth,
            year: temp.getFullYear()
        };
    }

    // ==================== 年龄计算 ====================
    /**
     * 根据出生日期计算年龄
     * @param {string|Date} birthdate - 出生日期
     * @param {string|Date} referenceDate - 参考日期（默认为今天）
     * @returns {object} 包含年龄信息
     */
    function calculateAge(birthdate, referenceDate = new Date()) {
        const birth = birthdate instanceof Date ? birthdate : parseDate(birthdate);
        const ref = referenceDate instanceof Date ? referenceDate : parseDate(referenceDate);

        if (birth > ref) {
            throw new Error('出生日期不能晚于参考日期');
        }

        const diff = dateDifference(birth, ref);

        return {
            years: diff.years,
            months: diff.months,
            days: diff.days,
            totalDays: diff.totalDays,
            description: `${diff.years}岁${diff.months}个月${diff.days}天`
        };
    }

    // ==================== 月/年剩余天数 ====================
    /**
     * 计算距离月末/年末的剩余天数
     * @param {string|Date} date - 日期
     * @returns {object} 包含剩余天数信息
     */
    function getRemainingDays(date) {
        const d = date instanceof Date ? date : parseDate(date);

        // 月末
        const endOfMonth = new Date(d.getFullYear(), d.getMonth() + 1, 0);
        const daysInMonth = endOfMonth.getDate();
        const daysRemainingInMonth = daysInMonth - d.getDate();

        // 年末
        const endOfYear = new Date(d.getFullYear(), 11, 31);
        const daysRemainingInYear = Math.floor((endOfYear - d) / (24 * 60 * 60 * 1000));

        return {
            daysInMonth,
            daysRemainingInMonth,
            daysInYear: isLeapYear(d.getFullYear()) ? 366 : 365,
            daysRemainingInYear
        };
    }

    // ==================== 导出 API ====================
    // ==================== 工作日计算 ====================
    /**
     * 判断是否为周末
     * @param {Date} date - 日期对象
     * @returns {boolean}
     */
    function isWeekend(date) {
        const day = date.getDay();
        return day === 0 || day === 6; // 0=周日, 6=周六
    }

    /**
     * 计算两个日期之间的工作日天数（排除周末）
     * @param {string|Date} startDate - 开始日期
     * @param {string|Date} endDate - 结束日期
     * @returns {number} 工作日天数
     */
    function calculateWorkingDays(startDate, endDate) {
        const start = startDate instanceof Date ? startDate : parseDate(startDate);
        const end = endDate instanceof Date ? endDate : parseDate(endDate);

        // 验证日期有效性
        if (isNaN(start.getTime()) || isNaN(end.getTime())) {
            throw new Error('无效的日期');
        }

        // 标准化为零点
        const startNorm = new Date(start.getFullYear(), start.getMonth(), start.getDate());
        const endNorm = new Date(end.getFullYear(), end.getMonth(), end.getDate());

        if (endNorm < startNorm) return 0;

        let count = 0;
        const current = new Date(startNorm);

        while (current <= endNorm) {
            if (!isWeekend(current)) {
                count++;
            }
            current.setDate(current.getDate() + 1);
        }

        return count;
    }

    /**
     * 在指定日期上增加工作日
     * @param {string|Date} date - 起始日期
     * @param {number} days - 要增加的工作日天数（可以为负数）
     * @returns {Date} 计算后的日期
     */
    function addWorkingDays(date, days) {
        const d = date instanceof Date ? new Date(date) : parseDate(date);

        // 验证日期有效性
        if (isNaN(d.getTime())) {
            throw new Error('无效的日期');
        }

        let remaining = Math.abs(days);
        const step = days >= 0 ? 1 : -1;

        while (remaining > 0) {
            d.setDate(d.getDate() + step);
            if (!isWeekend(d)) {
                remaining--;
            }
        }

        return d;
    }

    // ==================== 季度计算 ====================
    /**
     * 获取日期所属季度
     * @param {string|Date} date - 日期
     * @returns {object} { year, quarter, startDate, endDate }
     */
    function getQuarter(date) {
        const d = date instanceof Date ? date : parseDate(date);
        const year = d.getFullYear();
        const month = d.getMonth(); // 0-11

        const quarter = Math.floor(month / 3) + 1; // 1-4

        // 计算季度的开始和结束日期
        const startMonth = (quarter - 1) * 3;
        const endMonth = startMonth + 2;

        const startDate = new Date(year, startMonth, 1);
        const endDate = new Date(year, endMonth + 1, 0); // 下个月的第0天 = 本月最后一天

        return {
            year: year,
            quarter: quarter,
            startDate: formatDate(startDate, 'YYYY-MM-DD'),
            endDate: formatDate(endDate, 'YYYY-MM-DD'),
            description: `${year}年第${quarter}季度`
        };
    }

    return {
        parseDate,
        formatDate,
        isLeapYear,
        getDaysInMonth,
        dateDifference,
        dateAdd,
        getWeekday,
        getWeekNumber,
        calculateAge,
        getRemainingDays,
        isWeekend,
        calculateWorkingDays,
        addWorkingDays,
        getQuarter
    };
});
