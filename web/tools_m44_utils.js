/* 工具箱（M44）命令安全检查 & 工作流组合工具
 *
 * 设计目标：
 * - 纯算法、无 DOM 依赖
 * - 检测危险命令模式
 * - 组合命令片段为工作流
 */
(function (root, factory) {
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = factory();
    } else {
        root.DogToolboxM44Utils = factory();
    }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    // ==================== 危险模式定义 ====================

    const DANGEROUS_PATTERNS = {
        shell: [
            { pattern: /;\s*rm\s+-rf\s+\/(?!\w)/i, severity: 'critical', message: '检测到危险的 rm -rf / 命令' },
            { pattern: /rm\s+-rf\s+~\//i, severity: 'critical', message: '检测到删除用户目录的命令' },
            { pattern: /rm\s+-rf\s+\*/, severity: 'warning', message: '检测到递归删除通配符' },
            { pattern: />\s*\/dev\/sd[a-z]/i, severity: 'critical', message: '检测到直接写入磁盘设备' },
            { pattern: /mkfs\./i, severity: 'critical', message: '检测到格式化磁盘命令' },
            { pattern: /dd\s+if=.*of=\/dev\//i, severity: 'critical', message: '检测到 dd 写入设备' },
            { pattern: /:\(\)\s*{\s*:\|:&\s*};\s*:/i, severity: 'critical', message: '检测到 Fork Bomb' },
            { pattern: /\$\([^)]+\)/g, severity: 'info', message: '包含命令替换 $()' },
            { pattern: /`[^`]+`/g, severity: 'info', message: '包含反引号命令替换' },
            { pattern: /chmod\s+777/i, severity: 'warning', message: '设置过于宽松的权限 777' },
            { pattern: /chmod\s+-R\s+777/i, severity: 'warning', message: '递归设置 777 权限' },
            { pattern: />\s*\/etc\//i, severity: 'warning', message: '写入系统配置目录' },
            { pattern: /sudo\s+rm/i, severity: 'warning', message: '使用 sudo 执行删除操作' }
        ],
        git: [
            { pattern: /git\s+push\s+.*--force(?!-with-lease)\b/i, severity: 'warning', message: '强制推送可能覆盖远程历史' },
            { pattern: /git\s+push\s+-f\b/i, severity: 'warning', message: '强制推送可能覆盖远程历史' },
            { pattern: /git\s+reset\s+--hard/i, severity: 'warning', message: '硬重置会丢失未提交的更改' },
            { pattern: /git\s+clean\s+-[a-z]*f/i, severity: 'warning', message: '清理命令会删除未跟踪的文件' },
            { pattern: /git\s+checkout\s+--\s+\./i, severity: 'warning', message: '会丢弃所有未暂存的更改' },
            { pattern: /git\s+branch\s+-D/i, severity: 'info', message: '强制删除分支' },
            { pattern: /git\s+rebase\s+-i/i, severity: 'info', message: '交互式变基会修改提交历史' }
        ],
        docker: [
            { pattern: /--privileged/i, severity: 'warning', message: '特权模式容器具有完全主机访问权限' },
            { pattern: /-v\s+\/:/i, severity: 'critical', message: '挂载根目录到容器非常危险' },
            { pattern: /-v\s+\/etc:/i, severity: 'warning', message: '挂载 /etc 目录可能泄露敏感配置' },
            { pattern: /-v\s+\/var\/run\/docker\.sock/i, severity: 'warning', message: '挂载 Docker socket 允许容器控制宿主机 Docker' },
            { pattern: /--net=host/i, severity: 'warning', message: '主机网络模式可能暴露敏感端口' },
            { pattern: /--pid=host/i, severity: 'warning', message: '主机 PID 命名空间可能泄露进程信息' },
            { pattern: /docker\s+system\s+prune\s+-a/i, severity: 'warning', message: '会删除所有未使用的镜像' },
            { pattern: /docker\s+rm\s+-f\s+\$\(docker\s+ps/i, severity: 'warning', message: '批量删除容器' },
            { pattern: /docker\s+rmi\s+-f/i, severity: 'info', message: '强制删除镜像' }
        ],
        curl: [
            { pattern: /curl\s+[^|]*\|\s*sh\b/i, severity: 'critical', message: '直接执行远程脚本非常危险' },
            { pattern: /curl\s+[^|]*\|\s*bash\b/i, severity: 'critical', message: '直接执行远程脚本非常危险' },
            { pattern: /curl\s+[^|]*\|\s*sudo\s+sh/i, severity: 'critical', message: '以 root 权限执行远程脚本极其危险' },
            { pattern: /wget\s+[^|]*\|\s*sh/i, severity: 'critical', message: '直接执行远程脚本非常危险' },
            { pattern: /-k\b|--insecure\b/i, severity: 'warning', message: '禁用 SSL 验证可能导致中间人攻击' },
            { pattern: /--output\s+\/etc\//i, severity: 'warning', message: '下载文件到系统配置目录' },
            { pattern: /-o\s+\/etc\//i, severity: 'warning', message: '下载文件到系统配置目录' }
        ],
        npm: [
            { pattern: /npm\s+install\s+-g\s+[^@\s]+$/i, severity: 'info', message: '全局安装包，建议指定版本' },
            { pattern: /npm\s+run\s+.*--unsafe-perm/i, severity: 'warning', message: '使用不安全权限运行脚本' },
            { pattern: /npm\s+config\s+set\s+registry/i, severity: 'info', message: '修改 npm 源' }
        ]
    };

    // ==================== 安全检查函数 ====================

    /**
     * 检查命令安全性
     * @param {string} command - 命令字符串
     * @param {string|string[]} types - 命令类型：shell, git, docker, curl, npm 或数组
     * @returns {{safe: boolean, issues: Array<{severity: string, message: string, pattern: string}>}}
     */
    function checkCommandSecurity(command, types = ['shell']) {
        if (!command || typeof command !== 'string') {
            return { safe: true, issues: [] };
        }

        const typeList = Array.isArray(types) ? types : [types];
        const issues = [];

        // 始终检查 shell 基础模式
        if (!typeList.includes('shell')) {
            typeList.unshift('shell');
        }

        for (const type of typeList) {
            const patterns = DANGEROUS_PATTERNS[type] || [];
            for (const { pattern, severity, message } of patterns) {
                // 重置正则状态
                pattern.lastIndex = 0;
                if (pattern.test(command)) {
                    issues.push({
                        severity,
                        message,
                        pattern: pattern.toString()
                    });
                }
            }
        }

        // 去重
        const uniqueIssues = issues.filter((issue, idx, arr) =>
            arr.findIndex(i => i.message === issue.message) === idx
        );

        // 按严重程度排序
        const severityOrder = { critical: 0, warning: 1, info: 2 };
        uniqueIssues.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

        return {
            safe: uniqueIssues.filter(i => i.severity === 'critical').length === 0,
            issues: uniqueIssues
        };
    }

    /**
     * 获取命令类型的所有危险模式
     * @param {string} type - 命令类型
     * @returns {Array}
     */
    function getDangerousPatterns(type) {
        return DANGEROUS_PATTERNS[type] || [];
    }

    /**
     * 获取所有支持的命令类型
     * @returns {string[]}
     */
    function getSupportedTypes() {
        return Object.keys(DANGEROUS_PATTERNS);
    }

    // ==================== 工作流组合函数 ====================

    /**
     * 组合多个命令片段为工作流
     * @param {Array<{command: string, description: string}>} snippets - 命令片段
     * @param {object} options - 选项
     * @param {string} options.separator - 分隔符：'&&' 顺序执行，';' 独立执行，'\n' 换行
     * @param {boolean} options.addComments - 是否添加注释
     * @param {boolean} options.checkSecurity - 是否进行安全检查
     * @param {string|string[]} options.commandTypes - 命令类型
     * @returns {{workflow: string, description: string, securityIssues: Array}}
     */
    function combineSnippets(snippets, options = {}) {
        if (!Array.isArray(snippets) || snippets.length === 0) {
            return { workflow: '', description: '', securityIssues: [] };
        }

        const {
            separator = ' && ',
            addComments = true,
            checkSecurity = true,
            commandTypes = ['shell']
        } = options;

        const securityIssues = [];

        // 安全检查
        if (checkSecurity) {
            for (const snippet of snippets) {
                const check = checkCommandSecurity(snippet.command, commandTypes);
                if (check.issues.length > 0) {
                    securityIssues.push({
                        command: snippet.command,
                        description: snippet.description,
                        issues: check.issues
                    });
                }
            }
        }

        // 生成工作流
        let workflow;
        if (addComments && separator !== ' && ' && separator !== '; ') {
            // 带注释的多行格式
            workflow = snippets.map(s =>
                `# ${s.description}\n${s.command}`
            ).join('\n\n');
        } else if (addComments) {
            // 单行带注释
            workflow = snippets.map(s =>
                `${s.command}  # ${s.description}`
            ).join(separator);
        } else {
            // 纯命令
            workflow = snippets.map(s => s.command).join(separator);
        }

        return {
            workflow,
            description: snippets.map(s => s.description).join(' → '),
            securityIssues
        };
    }

    /**
     * 解析工作流为命令片段
     * @param {string} workflow - 工作流字符串
     * @param {string} separator - 分隔符
     * @returns {Array<{command: string, description: string}>}
     */
    function parseWorkflow(workflow, separator = ' && ') {
        if (!workflow || typeof workflow !== 'string') {
            return [];
        }

        const lines = workflow.split(separator);
        return lines.map((line, idx) => {
            // 尝试提取注释作为描述
            const commentMatch = line.match(/#\s*(.+)$/);
            const command = line.replace(/#.*$/, '').trim();
            return {
                command,
                description: commentMatch ? commentMatch[1].trim() : `步骤 ${idx + 1}`
            };
        }).filter(s => s.command);
    }

    // ==================== 命令转义函数 ====================

    /**
     * 转义命令行参数
     * @param {string} arg - 参数
     * @returns {string}
     */
    function escapeArg(arg) {
        const str = String(arg ?? '');
        if (!str) return "''";
        // 如果包含特殊字符，使用单引号包裹
        if (/[\s'"$`\\!*?#&|()<>;\[\]{}]/.test(str)) {
            return "'" + str.replace(/'/g, "'\\''") + "'";
        }
        return str;
    }

    /**
     * 转义用于双引号内的字符串
     * @param {string} str - 字符串
     * @returns {string}
     */
    function escapeDoubleQuoted(str) {
        return String(str ?? '').replace(/["\\$`]/g, '\\$&');
    }

    return {
        checkCommandSecurity,
        getDangerousPatterns,
        getSupportedTypes,
        combineSnippets,
        parseWorkflow,
        escapeArg,
        escapeDoubleQuoted,
        DANGEROUS_PATTERNS
    };
});
