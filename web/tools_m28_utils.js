/* 工具箱（M28）JSON Schema 生成工具
 *
 * 设计目标：
 * - 纯算法、无 DOM 依赖
 * - 从 JSON 数据生成 JSON Schema
 * - 使用 Schema 验证 JSON 数据
 * - 支持基本类型推断：string, number, integer, boolean, null, array, object
 */
(function (root, factory) {
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = factory();
    } else {
        root.DogToolboxM28Utils = factory();
    }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    /**
     * 从 JSON 数据生成 JSON Schema
     * @param {string} json - JSON 字符串
     * @returns {{schema: object|null, error: string|null}}
     */
    function generateSchema(json) {
        const text = String(json ?? '').trim();
        if (!text) {
            return { schema: null, error: 'JSON 数据不能为空' };
        }

        try {
            const data = JSON.parse(text);
            const schema = inferSchema(data);
            return { schema, error: null };
        } catch (e) {
            return { schema: null, error: `JSON 解析错误: ${e.message}` };
        }
    }

    /**
     * 推断数据的 Schema
     * @param {*} value - 任意 JSON 值
     * @returns {object} - JSON Schema 对象
     */
    function inferSchema(value) {
        // null
        if (value === null) {
            return { type: 'null' };
        }

        // boolean
        if (typeof value === 'boolean') {
            return { type: 'boolean' };
        }

        // number (区分 integer 和 number)
        if (typeof value === 'number') {
            if (Number.isInteger(value)) {
                return { type: 'integer' };
            }
            return { type: 'number' };
        }

        // string
        if (typeof value === 'string') {
            return { type: 'string' };
        }

        // array
        if (Array.isArray(value)) {
            if (value.length === 0) {
                return { type: 'array', items: {} };
            }

            // 推断数组元素的 schema（取第一个元素）
            // 实际应用中可以合并多个元素的 schema，这里简化处理
            const itemSchema = inferSchema(value[0]);

            // 检查所有元素是否同类型
            const allSameType = value.every(item => {
                const schema = inferSchema(item);
                return schema.type === itemSchema.type;
            });

            if (allSameType) {
                return { type: 'array', items: itemSchema };
            } else {
                // 如果类型不一致，使用空 schema
                return { type: 'array', items: {} };
            }
        }

        // object
        if (typeof value === 'object') {
            const properties = {};
            const required = [];

            for (const key in value) {
                if (Object.prototype.hasOwnProperty.call(value, key)) {
                    properties[key] = inferSchema(value[key]);
                    // 所有键都视为必填（可以根据需要调整）
                    required.push(key);
                }
            }

            const schema = {
                type: 'object',
                properties
            };

            if (required.length > 0) {
                schema.required = required;
            }

            return schema;
        }

        // 未知类型
        return {};
    }

    /**
     * 使用 Schema 验证 JSON 数据
     * @param {string} json - JSON 字符串
     * @param {object|string} schema - Schema 对象或 JSON 字符串
     * @returns {{valid: boolean, errors: string[]}}
     */
    function validateJson(json, schema) {
        const jsonText = String(json ?? '').trim();
        if (!jsonText) {
            return { valid: false, errors: ['JSON 数据不能为空'] };
        }

        let schemaObj = schema;
        if (typeof schema === 'string') {
            try {
                schemaObj = JSON.parse(schema);
            } catch (e) {
                return { valid: false, errors: [`Schema 解析错误: ${e.message}`] };
            }
        }

        if (!schemaObj || typeof schemaObj !== 'object') {
            return { valid: false, errors: ['Schema 必须是对象'] };
        }

        try {
            const data = JSON.parse(jsonText);
            const errors = validateValue(data, schemaObj, 'root');
            return { valid: errors.length === 0, errors };
        } catch (e) {
            return { valid: false, errors: [`JSON 解析错误: ${e.message}`] };
        }
    }

    /**
     * 验证单个值
     * @param {*} value - 待验证的值
     * @param {object} schema - Schema
     * @param {string} path - 当前路径（用于错误消息）
     * @returns {string[]} - 错误列表
     */
    function validateValue(value, schema, path) {
        const errors = [];

        // 空 schema 接受任意值
        if (!schema || Object.keys(schema).length === 0) {
            return errors;
        }

        const { type, properties, required, items } = schema;

        // 类型验证
        if (type) {
            const actualType = getJsonType(value);

            if (Array.isArray(type)) {
                // 多类型（如 ["string", "null"]）
                if (!type.includes(actualType)) {
                    errors.push(`${path}: 类型错误，期望 ${type.join(' 或 ')}，实际为 ${actualType}`);
                    return errors;
                }
            } else {
                // 单类型
                if (actualType !== type) {
                    errors.push(`${path}: 类型错误，期望 ${type}，实际为 ${actualType}`);
                    return errors;
                }
            }
        }

        // object 验证
        if (type === 'object' && typeof value === 'object' && value !== null && !Array.isArray(value)) {
            // required 字段验证
            if (required && Array.isArray(required)) {
                for (const key of required) {
                    if (!(key in value)) {
                        errors.push(`${path}: 缺少必填字段 "${key}"`);
                    }
                }
            }

            // properties 验证
            if (properties) {
                for (const key in value) {
                    if (Object.prototype.hasOwnProperty.call(value, key)) {
                        if (properties[key]) {
                            const subErrors = validateValue(value[key], properties[key], `${path}.${key}`);
                            errors.push(...subErrors);
                        }
                        // 如果 properties 中没有定义该字段，默认允许（additionalProperties: true）
                    }
                }
            }
        }

        // array 验证
        if (type === 'array' && Array.isArray(value)) {
            if (items) {
                value.forEach((item, index) => {
                    const subErrors = validateValue(item, items, `${path}[${index}]`);
                    errors.push(...subErrors);
                });
            }
        }

        return errors;
    }

    /**
     * 获取 JSON 值的类型
     * @param {*} value
     * @returns {string}
     */
    function getJsonType(value) {
        if (value === null) return 'null';
        if (typeof value === 'boolean') return 'boolean';
        if (typeof value === 'number') {
            return Number.isInteger(value) ? 'integer' : 'number';
        }
        if (typeof value === 'string') return 'string';
        if (Array.isArray(value)) return 'array';
        if (typeof value === 'object') return 'object';
        return 'unknown';
    }

    /**
     * 格式化 Schema（美化输出）
     * @param {object} schema
     * @param {number|string} indent
     * @returns {string}
     */
    function formatSchema(schema, indent) {
        if (!schema) return '';
        const indentVal = indent === 'tab' ? '\t' : (parseInt(String(indent), 10) || 2);
        return JSON.stringify(schema, null, indentVal);
    }

    // 导出
    return {
        generateSchema,
        validateJson,
        formatSchema,
        inferSchema  // 供测试使用
    };
});
