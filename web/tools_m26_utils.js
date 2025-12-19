/* 工具箱（M26）Git 命令生成器工具
 *
 * 设计目标：
 * - 纯算法、无 DOM 依赖，便于在浏览器与 Node 环境复用与单元测试
 * - 提供常用 Git 命令生成函数
 * - 返回命令字符串和相应的说明
 */
(function (root, factory) {
    // UMD：浏览器挂到 window；Node 通过 module.exports 导出
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = factory();
    } else {
        root.DogToolboxM26Utils = factory();
    }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    /**
     * 生成克隆命令
     * @param {string} url - 仓库 URL
     * @param {object} options - 选项
     *   - branch: 指定分支
     *   - depth: 浅克隆深度
     *   - singleBranch: 是否仅克隆单个分支
     *   - recursive: 是否递归克隆子模块
     *   - targetDir: 目标目录
     * @returns {object} { command, description }
     */
    function generateCloneCommand(url, options = {}) {
        if (!url || typeof url !== 'string' || !url.trim()) {
            throw new Error('仓库 URL 不能为空');
        }

        const parts = ['git clone'];
        const descriptions = [];

        if (options.branch) {
            parts.push(`-b ${escapeArg(options.branch)}`);
            descriptions.push(`克隆分支：${options.branch}`);
        }

        if (options.depth && Number.isInteger(options.depth) && options.depth > 0) {
            parts.push(`--depth ${options.depth}`);
            descriptions.push(`浅克隆深度：${options.depth}`);
        }

        if (options.singleBranch) {
            parts.push('--single-branch');
            descriptions.push('仅克隆单个分支');
        }

        if (options.recursive) {
            parts.push('--recursive');
            descriptions.push('递归克隆子模块');
        }

        parts.push(escapeArg(url));

        if (options.targetDir) {
            parts.push(escapeArg(options.targetDir));
            descriptions.push(`目标目录：${options.targetDir}`);
        }

        return {
            command: parts.join(' '),
            description: descriptions.length > 0
                ? `克隆仓库 (${descriptions.join('，')})`
                : '克隆仓库'
        };
    }

    /**
     * 生成提交命令
     * @param {string} message - 提交消息
     * @param {object} options - 选项
     *   - amend: 是否修改上次提交
     *   - noVerify: 是否跳过钩子
     *   - all: 是否提交所有已跟踪文件的修改
     * @returns {object} { command, description }
     */
    function generateCommitCommand(message, options = {}) {
        if (!message || typeof message !== 'string' || !message.trim()) {
            throw new Error('提交消息不能为空');
        }

        const parts = ['git commit'];
        const descriptions = [];

        if (options.all) {
            parts.push('-a');
            descriptions.push('自动暂存已跟踪文件');
        }

        if (options.amend) {
            parts.push('--amend');
            descriptions.push('修改上次提交');
        }

        if (options.noVerify) {
            parts.push('--no-verify');
            descriptions.push('跳过 pre-commit 和 commit-msg 钩子');
        }

        parts.push(`-m ${escapeArg(message)}`);

        return {
            command: parts.join(' '),
            description: descriptions.length > 0
                ? `提交更改 (${descriptions.join('，')})`
                : '提交更改'
        };
    }

    /**
     * 生成分支命令
     * @param {string} action - 操作类型：create, delete, list, rename, switch
     * @param {string} name - 分支名称
     * @param {object} options - 选项
     *   - newName: 新分支名（用于 rename）
     *   - force: 是否强制操作
     *   - remote: 是否操作远程分支
     *   - track: 创建分支时是否设置跟踪
     * @returns {object} { command, description }
     */
    function generateBranchCommand(action, name, options = {}) {
        const parts = ['git'];
        let description = '';

        switch (action) {
            case 'create':
                if (!name) throw new Error('分支名称不能为空');
                parts.push('branch');
                if (options.track) {
                    parts.push('--track');
                }
                parts.push(escapeArg(name));
                description = `创建分支：${name}`;
                break;

            case 'delete':
                if (!name) throw new Error('分支名称不能为空');
                parts.push('branch');
                parts.push(options.force ? '-D' : '-d');
                parts.push(escapeArg(name));
                description = options.force ? `强制删除分支：${name}` : `删除分支：${name}`;
                break;

            case 'list':
                parts.push('branch');
                if (options.remote) {
                    parts.push('-r');
                    description = '列出远程分支';
                } else {
                    description = '列出本地分支';
                }
                break;

            case 'rename':
                if (!name) throw new Error('原分支名称不能为空');
                if (!options.newName) throw new Error('新分支名称不能为空');
                parts.push('branch', '-m');
                parts.push(escapeArg(name));
                parts.push(escapeArg(options.newName));
                description = `重命名分支：${name} → ${options.newName}`;
                break;

            case 'switch':
                if (!name) throw new Error('分支名称不能为空');
                parts.push('switch');
                parts.push(escapeArg(name));
                description = `切换到分支：${name}`;
                break;

            default:
                throw new Error(`不支持的分支操作：${action}`);
        }

        return {
            command: parts.join(' '),
            description
        };
    }

    /**
     * 生成合并命令
     * @param {string} branch - 要合并的分支
     * @param {object} options - 选项
     *   - noFf: 禁用快进合并
     *   - squash: 压缩合并
     *   - message: 合并消息
     * @returns {object} { command, description }
     */
    function generateMergeCommand(branch, options = {}) {
        if (!branch || typeof branch !== 'string' || !branch.trim()) {
            throw new Error('分支名称不能为空');
        }

        const parts = ['git merge'];
        const descriptions = [];

        if (options.noFf) {
            parts.push('--no-ff');
            descriptions.push('禁用快进合并');
        }

        if (options.squash) {
            parts.push('--squash');
            descriptions.push('压缩合并');
        }

        if (options.message) {
            parts.push(`-m ${escapeArg(options.message)}`);
        }

        parts.push(escapeArg(branch));

        return {
            command: parts.join(' '),
            description: descriptions.length > 0
                ? `合并分支 ${branch} (${descriptions.join('，')})`
                : `合并分支 ${branch}`
        };
    }

    /**
     * 生成变基命令
     * @param {string} branch - 变基目标分支
     * @param {object} options - 选项
     *   - interactive: 是否交互式变基
     *   - onto: 指定新的基底分支
     * @returns {object} { command, description }
     */
    function generateRebaseCommand(branch, options = {}) {
        if (!branch || typeof branch !== 'string' || !branch.trim()) {
            throw new Error('分支名称不能为空');
        }

        const parts = ['git rebase'];
        const descriptions = [];

        if (options.interactive) {
            parts.push('-i');
            descriptions.push('交互式变基');
        }

        if (options.onto) {
            parts.push(`--onto ${escapeArg(options.onto)}`);
            descriptions.push(`新基底：${options.onto}`);
        }

        parts.push(escapeArg(branch));

        return {
            command: parts.join(' '),
            description: descriptions.length > 0
                ? `变基到 ${branch} (${descriptions.join('，')})`
                : `变基到 ${branch}`
        };
    }

    /**
     * 生成暂存命令
     * @param {string} action - 操作类型：save, list, pop, apply, drop, clear
     * @param {object} options - 选项
     *   - message: 暂存消息（用于 save）
     *   - index: 暂存索引（用于 pop, apply, drop）
     *   - keepIndex: 是否保留暂存区（用于 save）
     * @returns {object} { command, description }
     */
    function generateStashCommand(action, options = {}) {
        const parts = ['git stash'];
        let description = '';

        switch (action) {
            case 'save':
                parts.push('push');
                if (options.keepIndex) {
                    parts.push('--keep-index');
                }
                if (options.message) {
                    parts.push(`-m ${escapeArg(options.message)}`);
                    description = `暂存工作目录：${options.message}`;
                } else {
                    description = '暂存工作目录';
                }
                break;

            case 'list':
                parts.push('list');
                description = '查看暂存列表';
                break;

            case 'pop':
                parts.push('pop');
                if (options.index !== undefined) {
                    parts.push(`stash@{${options.index}}`);
                    description = `弹出暂存 stash@{${options.index}}`;
                } else {
                    description = '弹出最新暂存';
                }
                break;

            case 'apply':
                parts.push('apply');
                if (options.index !== undefined) {
                    parts.push(`stash@{${options.index}}`);
                    description = `应用暂存 stash@{${options.index}}`;
                } else {
                    description = '应用最新暂存';
                }
                break;

            case 'drop':
                parts.push('drop');
                if (options.index !== undefined) {
                    parts.push(`stash@{${options.index}}`);
                    description = `删除暂存 stash@{${options.index}}`;
                } else {
                    description = '删除最新暂存';
                }
                break;

            case 'clear':
                parts.push('clear');
                description = '清空所有暂存';
                break;

            default:
                throw new Error(`不支持的暂存操作：${action}`);
        }

        return {
            command: parts.join(' '),
            description
        };
    }

    /**
     * 生成重置命令
     * @param {string} mode - 重置模式：soft, mixed, hard
     * @param {string} ref - 目标引用（commit hash / branch / tag / HEAD~n）
     * @returns {object} { command, description }
     */
    function generateResetCommand(mode, ref) {
        if (!mode || !['soft', 'mixed', 'hard'].includes(mode)) {
            throw new Error('重置模式必须是 soft、mixed 或 hard');
        }

        const parts = ['git reset'];
        let description = '';

        switch (mode) {
            case 'soft':
                parts.push('--soft');
                description = '软重置（保留工作目录和暂存区）';
                break;
            case 'mixed':
                parts.push('--mixed');
                description = '混合重置（保留工作目录）';
                break;
            case 'hard':
                parts.push('--hard');
                description = '硬重置（丢弃所有修改）';
                break;
        }

        if (ref) {
            parts.push(escapeArg(ref));
            description += ` 到 ${ref}`;
        }

        return {
            command: parts.join(' '),
            description
        };
    }

    /**
     * 生成日志命令
     * @param {object} options - 选项
     *   - oneline: 单行显示
     *   - graph: 显示分支图
     *   - maxCount: 最大显示数量
     *   - author: 按作者过滤
     *   - since: 起始日期
     *   - until: 结束日期
     *   - grep: 按消息过滤
     * @returns {object} { command, description }
     */
    function generateLogCommand(options = {}) {
        const parts = ['git log'];
        const descriptions = [];

        if (options.oneline) {
            parts.push('--oneline');
            descriptions.push('单行显示');
        }

        if (options.graph) {
            parts.push('--graph');
            descriptions.push('显示分支图');
        }

        if (options.maxCount && Number.isInteger(options.maxCount) && options.maxCount > 0) {
            parts.push(`-n ${options.maxCount}`);
            descriptions.push(`最近 ${options.maxCount} 条`);
        }

        if (options.author) {
            parts.push(`--author=${escapeArg(options.author)}`);
            descriptions.push(`作者：${options.author}`);
        }

        if (options.since) {
            parts.push(`--since=${escapeArg(options.since)}`);
            descriptions.push(`起始：${options.since}`);
        }

        if (options.until) {
            parts.push(`--until=${escapeArg(options.until)}`);
            descriptions.push(`截止：${options.until}`);
        }

        if (options.grep) {
            parts.push(`--grep=${escapeArg(options.grep)}`);
            descriptions.push(`消息过滤：${options.grep}`);
        }

        return {
            command: parts.join(' '),
            description: descriptions.length > 0
                ? `查看提交历史 (${descriptions.join('，')})`
                : '查看提交历史'
        };
    }

    /**
     * 转义命令行参数（处理空格和特殊字符）
     */
    function escapeArg(arg) {
        const str = String(arg ?? '');
        // 如果包含空格或特殊字符，使用单引号包裹
        if (/[\s'"$`\\!*?#&|()<>]/.test(str)) {
            return `'${str.replace(/'/g, "'\\''")}'`;
        }
        return str;
    }

    /**
     * 获取常用 Git 命令模板
     */
    function getCommonTemplates() {
        return [
            {
                name: '初始化仓库',
                command: 'git init',
                description: '在当前目录初始化 Git 仓库'
            },
            {
                name: '查看状态',
                command: 'git status',
                description: '查看工作目录和暂存区状态'
            },
            {
                name: '添加所有文件',
                command: 'git add .',
                description: '将所有修改添加到暂存区'
            },
            {
                name: '查看差异',
                command: 'git diff',
                description: '查看工作目录与暂存区的差异'
            },
            {
                name: '查看暂存差异',
                command: 'git diff --staged',
                description: '查看暂存区与上次提交的差异'
            },
            {
                name: '推送到远程',
                command: 'git push origin main',
                description: '推送本地分支到远程仓库'
            },
            {
                name: '拉取远程更新',
                command: 'git pull',
                description: '从远程仓库拉取并合并更新'
            },
            {
                name: '查看远程仓库',
                command: 'git remote -v',
                description: '查看远程仓库地址'
            },
            {
                name: '添加远程仓库',
                command: 'git remote add origin <url>',
                description: '添加远程仓库地址'
            },
            {
                name: '标签管理',
                command: 'git tag v1.0.0',
                description: '创建标签'
            },
            {
                name: '推送标签',
                command: 'git push origin --tags',
                description: '推送所有标签到远程'
            },
            {
                name: '检出文件',
                command: 'git checkout -- <file>',
                description: '丢弃工作目录的修改'
            },
            {
                name: '查看提交详情',
                command: 'git show <commit>',
                description: '查看指定提交的详细信息'
            },
            {
                name: '清理未跟踪文件',
                command: 'git clean -fd',
                description: '删除未跟踪的文件和目录'
            }
        ];
    }

    /**
     * 生成远程仓库命令
     * @param {string} action - 操作类型：add, set-url, remove, show
     * @param {string} name - 远程仓库名称
     * @param {string} url - 仓库 URL（add 和 set-url 需要）
     * @returns {object} { command, description }
     */
    function generateRemoteCommand(action, name, url) {
        const remoteName = name || 'origin';
        const act = (action || '').toLowerCase();

        if (act === 'add') {
            if (!url) throw new Error('添加远程仓库需要提供 URL');
            return {
                command: `git remote add ${escapeArg(remoteName)} ${escapeArg(url)}`,
                description: `添加远程仓库 ${remoteName}`
            };
        }

        if (act === 'set-url') {
            if (!url) throw new Error('修改远程仓库 URL 需要提供新 URL');
            return {
                command: `git remote set-url ${escapeArg(remoteName)} ${escapeArg(url)}`,
                description: `修改远程仓库 ${remoteName} 的 URL`
            };
        }

        if (act === 'remove') {
            return {
                command: `git remote remove ${escapeArg(remoteName)}`,
                description: `删除远程仓库 ${remoteName}`
            };
        }

        if (act === 'show') {
            return {
                command: `git remote show ${escapeArg(remoteName)}`,
                description: `查看远程仓库 ${remoteName} 详情`
            };
        }

        if (act === 'rename') {
            if (!url) throw new Error('重命名需要提供新名称');
            return {
                command: `git remote rename ${escapeArg(remoteName)} ${escapeArg(url)}`,
                description: `将远程仓库 ${remoteName} 重命名为 ${url}`
            };
        }

        throw new Error(`未知的远程操作: ${action}`);
    }

    /**
     * 生成抓取命令
     * @param {string} remote - 远程仓库名称，默认 origin
     * @param {object} options - 选项
     *   - all: 抓取所有远程仓库
     *   - prune: 删除远程已删除的分支
     *   - tags: 抓取所有标签
     * @returns {object} { command, description }
     */
    function generateFetchCommand(remote = 'origin', options = {}) {
        const parts = ['git fetch'];
        const descriptions = [];

        if (options.all) {
            parts.push('--all');
            descriptions.push('抓取所有远程仓库');
        } else {
            parts.push(escapeArg(remote));
            descriptions.push(`从 ${remote} 抓取`);
        }

        if (options.prune) {
            parts.push('--prune');
            descriptions.push('清理已删除的远程分支');
        }

        if (options.tags) {
            parts.push('--tags');
            descriptions.push('抓取所有标签');
        }

        return {
            command: parts.join(' '),
            description: descriptions.join('，')
        };
    }

    /**
     * 生成标签命令
     * @param {string} action - 操作类型：create, delete, push, list
     * @param {string} tagName - 标签名称
     * @param {object} options - 选项
     *   - message: 附注标签的消息（create 时使用）
     *   - annotate: 是否创建附注标签（create 时使用）
     *   - force: 是否强制操作
     *   - remote: 远程仓库名称（push 时使用）
     * @returns {object} { command, description }
     */
    function generateTagCommand(action, tagName, options = {}) {
        const act = (action || '').toLowerCase();

        if (act === 'create') {
            if (!tagName) throw new Error('创建标签需要提供标签名称');

            if (options.annotate && options.message) {
                return {
                    command: `git tag -a ${escapeArg(tagName)} -m ${escapeArg(options.message)}`,
                    description: `创建附注标签 ${tagName}`
                };
            }

            return {
                command: `git tag ${escapeArg(tagName)}`,
                description: `创建轻量标签 ${tagName}`
            };
        }

        if (act === 'delete') {
            if (!tagName) throw new Error('删除标签需要提供标签名称');
            return {
                command: `git tag -d ${escapeArg(tagName)}`,
                description: `删除本地标签 ${tagName}`
            };
        }

        if (act === 'push') {
            if (!tagName) throw new Error('推送标签需要提供标签名称');
            const remote = options.remote || 'origin';
            const force = options.force ? ' -f' : '';
            return {
                command: `git push${force} ${escapeArg(remote)} ${escapeArg(tagName)}`,
                description: `推送标签 ${tagName} 到 ${remote}${force ? '（强制）' : ''}`
            };
        }

        if (act === 'list') {
            return {
                command: 'git tag --list',
                description: '列出所有标签'
            };
        }

        throw new Error(`未知的标签操作: ${action}`);
    }

    /**
     * 生成 cherry-pick 命令
     * @param {string} commits - 提交哈希（多个用空格分隔）
     * @param {object} options - 选项
     *   - noCommit: 不自动提交 (-n)
     *   - edit: 编辑提交消息 (-e)
     *   - signoff: 添加签名 (-s)
     *   - mainline: 指定主线（合并提交时使用）
     * @returns {object} { command, description }
     */
    function generateCherryPickCommand(commits, options = {}) {
        if (!commits || typeof commits !== 'string' || !commits.trim()) {
            throw new Error('提交哈希不能为空');
        }

        const parts = ['git cherry-pick'];
        const descriptions = [];

        if (options.noCommit) {
            parts.push('-n');
            descriptions.push('不自动提交');
        }

        if (options.edit) {
            parts.push('-e');
            descriptions.push('编辑消息');
        }

        if (options.signoff) {
            parts.push('-s');
            descriptions.push('添加签名');
        }

        if (options.mainline) {
            parts.push(`-m ${options.mainline}`);
            descriptions.push(`主线 ${options.mainline}`);
        }

        parts.push(commits.trim());

        const commitList = commits.trim().split(/\s+/);
        const commitDesc = commitList.length > 1 ? `${commitList.length} 个提交` : commitList[0].substring(0, 7);

        return {
            command: parts.join(' '),
            description: descriptions.length > 0
                ? `挑选 ${commitDesc} (${descriptions.join('，')})`
                : `挑选提交 ${commitDesc}`
        };
    }

    /**
     * 生成 revert 命令
     * @param {string} commits - 提交哈希（多个用空格分隔）
     * @param {object} options - 选项
     *   - noCommit: 不自动提交 (-n)
     *   - edit: 编辑提交消息 (-e)
     *   - mainline: 指定主线（合并提交时使用）
     *   - noEdit: 不编辑消息 (--no-edit)
     * @returns {object} { command, description }
     */
    function generateRevertCommand(commits, options = {}) {
        if (!commits || typeof commits !== 'string' || !commits.trim()) {
            throw new Error('提交哈希不能为空');
        }

        const parts = ['git revert'];
        const descriptions = [];

        if (options.noCommit) {
            parts.push('-n');
            descriptions.push('不自动提交');
        }

        if (options.noEdit) {
            parts.push('--no-edit');
            descriptions.push('使用默认消息');
        } else if (options.edit) {
            parts.push('-e');
            descriptions.push('编辑消息');
        }

        if (options.mainline) {
            parts.push(`-m ${options.mainline}`);
            descriptions.push(`主线 ${options.mainline}`);
        }

        parts.push(commits.trim());

        const commitList = commits.trim().split(/\s+/);
        const commitDesc = commitList.length > 1 ? `${commitList.length} 个提交` : commitList[0].substring(0, 7);

        return {
            command: parts.join(' '),
            description: descriptions.length > 0
                ? `撤销 ${commitDesc} (${descriptions.join('，')})`
                : `撤销提交 ${commitDesc}`
        };
    }

    // 导出 API
    return {
        generateCloneCommand,
        generateCommitCommand,
        generateBranchCommand,
        generateMergeCommand,
        generateRebaseCommand,
        generateStashCommand,
        generateResetCommand,
        generateLogCommand,
        getCommonTemplates,
        generateRemoteCommand,
        generateFetchCommand,
        generateTagCommand,
        generateCherryPickCommand,
        generateRevertCommand
    };
});
