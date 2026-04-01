/*
 * 文件总览：工具页脚本分包 C。
 *
 * 服务页面包含：备份、Markdown、Git、Docker、JSON Schema、HTTP、WebSocket、Mock、脱敏、CSV、二维码、HTML 实体、图片 Base64、文本排序、TOML、UA、JSONPath、nginx 等工具。
 *
 * 这是当前仓库里最大的工具脚本分包，典型模式是：
 * - 先按工具块分 section；
 * - 每个 section 提供 initXxxTool()/updateXxxTool()/clearXxxTool() 或场景切换函数；
 * - 页面按钮通常通过 HTML 中的 onclick 直接进入这里。
 *
 * 排查建议：
 * - 先从工具页对应的 section heading 定位模块；
 * - 再顺着初始化函数、场景切换函数、结果更新函数往下看；
 * - 如果需要追后端接口，再看 pywebview.api 的调用点。
 */

// ==================== 数据备份与恢复 ====================
// 对应 backup 页面，负责统计信息、导出 JSON 备份、导入恢复与结果提示。
async function initBackupPage() {
    await updateBackupStats();
}

// 读取备份页顶部统计卡片：
// - 展示当前本地数据里“页签 / 命令 / 凭证 / 节点”的数量；
// - 这是备份前让用户先确认数据规模的第一步。
async function updateBackupStats() {
    try {
        const stats = await pywebview.api.get_data_stats();
        document.getElementById('stat-tabs').textContent = stats.tabs ?? '-';
        document.getElementById('stat-commands').textContent = stats.commands ?? '-';
        document.getElementById('stat-credentials').textContent = stats.credentials ?? '-';
        document.getElementById('stat-nodes').textContent = stats.nodes ?? '-';
    } catch (e) {
        console.error('Failed to load backup stats:', e);
    }
}

// 导出整包数据备份：
// - 先调用后端把当前数据序列化成 JSON；
// - 再优先尝试桌面保存对话框，失败时回退到浏览器下载；
// - 成功/失败信息最终都写回 backup-result 区域。
async function exportBackup() {
    const resultEl = document.getElementById('backup-result');
    resultEl.style.display = 'none';
    resultEl.className = 'backup-result';

    try {
        const data = await pywebview.api.export_data();
        const jsonStr = JSON.stringify(data, null, 2);

        const now = new Date();
        const ts = now.toISOString().slice(0, 19).replace(/[:\-T]/g, '').replace(/(\d{8})(\d{6})/, '$1_$2');
        const filename = `狗狗百宝箱_备份_${ts}.json`;

        // 优先使用后端保存对话框（避免 pywebview 环境下前端下载导致崩溃）
        if (window.pywebview && window.pywebview.api && window.pywebview.api.save_file_dialog) {
            const result = await window.pywebview.api.save_file_dialog({
                content: jsonStr,
                default_filename: filename
            });
            if (result.success) {
                resultEl.className = 'backup-result backup-success';
                resultEl.innerHTML = `
                    <div class="backup-result-title">✅ 导出成功</div>
                    <div class="backup-result-details">
                        备份文件已保存到：<strong>${escapeHtml(result.path)}</strong>
                        <ul>
                            <li>页签：${data.data.tabs?.length ?? 0} 条</li>
                            <li>命令：${data.data.commands?.length ?? 0} 条</li>
                            <li>凭证：${data.data.credentials?.length ?? 0} 条</li>
                            <li>节点：${data.data.nodes?.length ?? 0} 条</li>
                        </ul>
                    </div>
                `;
                resultEl.style.display = '';
            } else if (result.error && result.error !== '用户取消了保存') {
                throw new Error(result.error);
            }
            return;
        }

        // 回退到前端下载方式
        const blob = new Blob([jsonStr], { type: 'application/json' });
        const url = URL.createObjectURL(blob);

        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        resultEl.className = 'backup-result backup-success';
        resultEl.innerHTML = `
            <div class="backup-result-title">✅ 导出成功</div>
            <div class="backup-result-details">
                备份文件已下载：<strong>${filename}</strong>
                <ul>
                    <li>页签：${data.data.tabs?.length ?? 0} 条</li>
                    <li>命令：${data.data.commands?.length ?? 0} 条</li>
                    <li>凭证：${data.data.credentials?.length ?? 0} 条</li>
                    <li>节点：${data.data.nodes?.length ?? 0} 条</li>
                </ul>
            </div>
        `;
        resultEl.style.display = '';
    } catch (e) {
        resultEl.className = 'backup-result backup-error';
        resultEl.innerHTML = `
            <div class="backup-result-title">❌ 导出失败</div>
            <div class="backup-result-details">${escapeHtml(e.message || String(e))}</div>
        `;
        resultEl.style.display = '';
    }
}

// 导入整包 JSON 备份：
// - 从文件输入读取 JSON；
// - 调后端执行真正的数据恢复；
// - 完成后刷新备份结果提示和顶部统计。
async function importBackup(event) {
    const file = event.target.files?.[0];
    if (!file) return;

    const resultEl = document.getElementById('backup-result');
    resultEl.style.display = 'none';
    resultEl.className = 'backup-result';

    try {
        const text = await file.text();
        const jsonData = JSON.parse(text);

        if (!jsonData.data) {
            throw new Error('无效的备份文件格式：缺少 data 字段');
        }

        if (!confirm('导入将覆盖现有数据，是否继续？')) {
            event.target.value = '';
            return;
        }

        const result = await pywebview.api.import_data(jsonData);

        if (result.success) {
            resultEl.className = 'backup-result backup-success';
            resultEl.innerHTML = `
                <div class="backup-result-title">✅ 导入成功</div>
                <div class="backup-result-details">
                    已导入数据：
                    <ul>
                        <li>页签：${result.imported.tabs} 条</li>
                        <li>命令：${result.imported.commands} 条</li>
                        <li>凭证：${result.imported.credentials} 条</li>
                        <li>节点：${result.imported.nodes} 条</li>
                    </ul>
                    页面将自动刷新以加载新数据...
                </div>
            `;
            resultEl.style.display = '';
            await updateBackupStats();
            setTimeout(() => location.reload(), 2000);
        } else {
            throw new Error(result.error || '导入失败');
        }
    } catch (e) {
        resultEl.className = 'backup-result backup-error';
        resultEl.innerHTML = `
            <div class="backup-result-title">❌ 导入失败</div>
            <div class="backup-result-details">${escapeHtml(e.message || String(e))}</div>
        `;
        resultEl.style.display = '';
    }

    event.target.value = '';
}

// ==================== M22 Markdown 预览工具 ====================
// 对应 tool-markdown 页面，负责编辑区、预览区、HTML 导出和帮助说明。

function setMarkdownViewMode(mode) {
    if (!['split', 'edit', 'preview'].includes(mode)) return;
    markdownViewMode = mode;

    const editPanel = document.getElementById('markdown-edit-panel');
    const previewPanel = document.getElementById('markdown-preview-panel');
    const layout = document.getElementById('markdown-layout');

    // 更新按钮状态
    document.querySelectorAll('.view-mode-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.mode === mode);
    });

    if (!editPanel || !previewPanel || !layout) return;

    // 重置样式
    editPanel.style.display = '';
    previewPanel.style.display = '';
    editPanel.style.flex = '';
    previewPanel.style.flex = '';

    switch (mode) {
        case 'edit':
            previewPanel.style.display = 'none';
            editPanel.style.flex = '1';
            break;
        case 'preview':
            editPanel.style.display = 'none';
            previewPanel.style.flex = '1';
            break;
        case 'split':
        default:
            // 默认分屏模式，两个面板各占一半
            break;
    }
}

function clearMarkdownTool() {
    document.getElementById('markdown-input').value = '';
    document.getElementById('markdown-preview').innerHTML = '';
}

// 防抖定时器
let _markdownDebounceTimer = null;

function updateMarkdownTool() {
    // 防抖：避免频繁输入导致卡顿
    if (_markdownDebounceTimer) {
        clearTimeout(_markdownDebounceTimer);
    }
    _markdownDebounceTimer = setTimeout(_doUpdateMarkdown, 150);
}

function _doUpdateMarkdown() {
    const inputEl = document.getElementById('markdown-input');
    const previewEl = document.getElementById('markdown-preview');
    if (!inputEl || !previewEl) return;

    const input = inputEl.value;

    if (!input.trim()) {
        previewEl.innerHTML = '<p class="placeholder-text">预览将在此处显示...</p>';
        return;
    }

    if (!window.DogToolboxM22Utils) {
        previewEl.innerHTML = '<div class="error-message">工具模块未加载</div>';
        return;
    }

    try {
        const html = DogToolboxM22Utils.parseMarkdown(input);
        previewEl.innerHTML = html;
    } catch (e) {
        previewEl.innerHTML = `<div class="error-message">解析错误：${escapeHtml(e.message || String(e))}</div>`;
    }
}

function copyMarkdownHtml(btn) {
    const previewEl = document.getElementById('markdown-preview');
    const html = previewEl.innerHTML;

    if (!html || html.includes('placeholder-text')) {
        return;
    }

    copyToolText(btn, html, { showTextFeedback: true });
}

async function exportMarkdownAsHtml() {
    const inputEl = document.getElementById('markdown-input');
    const input = inputEl?.value;

    if (!input || !input.trim()) {
        return;
    }

    if (!window.DogToolboxM22Utils) {
        showToast('工具模块未加载', 'error');
        return;
    }

    try {
        // 生成完整 HTML
        const htmlContent = window.DogToolboxM22Utils.exportAsHtml(input, {
            title: 'Markdown 文档'
        });

        // 生成文件名（带时间戳）
        const timestamp = new Date().toISOString().slice(0, 19).replace(/[:]/g, '-');
        const filename = `markdown-export-${timestamp}.html`;

        // 优先使用后端保存对话框
        if (window.pywebview && window.pywebview.api && window.pywebview.api.save_file_dialog) {
            const result = await window.pywebview.api.save_file_dialog({
                content: htmlContent,
                default_filename: filename
            });
            if (result.success) {
                showToast('已保存到: ' + result.path);
            } else if (result.error && result.error !== '用户取消了保存') {
                showToast('保存失败: ' + result.error, 'error');
            }
            return;
        }

        // 回退到前端下载方式
        const blob = new Blob([htmlContent], { type: 'text/html;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;

        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    } catch (e) {
        showToast('导出失败：' + (e.message || String(e)), 'error');
    }
}

// ==================== 输入验证辅助函数 ====================
// 这是一组被多个生成器/配置工具复用的小型校验工具，用于给表单错误定位。

/**
 * 验证输入字段，为空则添加错误样式
 * @param {string} elementId - 元素ID
 * @param {string} value - 字段值
 * @returns {boolean} 是否通过验证
 */
function validateInput(elementId, value) {
    const el = document.getElementById(elementId);
    if (!el) return true; // 元素不存在，跳过验证

    const isValid = value && value.trim() !== '';

    if (isValid) {
        el.classList.remove('input-error');
    } else {
        el.classList.add('input-error');
    }

    return isValid;
}

/**
 * 清除所有验证错误样式
 * @param {string[]} elementIds - 元素ID数组
 */
function clearValidationErrors(elementIds) {
    elementIds.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.classList.remove('input-error');
    });
}

// ==================== 原有 M26 Git 命令生成器 ====================
// 兼容旧实现的保留区块，阅读 Git 工具时可结合新版初始化段一起看。

// ==================== M26 Git 命令生成器 ====================
// 对应 tool-git 页面，核心是场景标签切换和底部命令预览更新。

// 场景切换
function switchGitScene(scene, evt) {
    currentGitScene = scene;

    // 更新 tab 激活状态
    document.querySelectorAll('.tool-tab').forEach(tab => {
        tab.classList.remove('active');
    });
    if (evt?.target) {
        evt.target.classList.add('active');
    }

    // 更新场景显示
    document.querySelectorAll('.git-scene').forEach(s => {
        s.classList.remove('active');
    });
    document.getElementById(`git-scene-${scene}`)?.classList.add('active');

    // 重置面板过滤状态
    resetPanelFiltering('.git-tool');

    // 如果是模板场景，加载模板
    if (scene === 'templates') {
        loadGitTemplates();
    } else {
        updateGitCommand();
    }
}

// 加载常用命令模板
function loadGitTemplates() {
    if (!window.DogToolboxM26Utils) return;

    const templates = DogToolboxM26Utils.getCommonTemplates();
    const container = document.getElementById('git-templates-list');
    
    // Add grid class if not present
    container.className = 'git-templates-grid';

    // Helper to pick icon
    const getIcon = (name) => {
        if (name.includes('初始化')) return '🏁';
        if (name.includes('状态')) return '🔍';
        if (name.includes('添加')) return '➕';
        if (name.includes('差异')) return '⚖️';
        if (name.includes('推送')) return '⬆️';
        if (name.includes('拉取')) return '⬇️';
        if (name.includes('远程')) return '🔗';
        if (name.includes('标签')) return '🏷️';
        if (name.includes('检出')) return '↩️';
        if (name.includes('日志') || name.includes('详情')) return '📜';
        if (name.includes('清理')) return '🧹';
        return '🔹';
    };

    container.innerHTML = templates.map(t => `
        <button type="button" class="git-template-card" onclick="applyGitTemplate('${escapeAttr(t.command)}')">
            <div class="git-template-header">
                <div class="git-template-icon" aria-hidden="true">${getIcon(t.name)}</div>
                <div class="git-template-info">
                    <div class="git-template-name">${escapeHtml(t.name)}</div>
                    <div class="git-template-desc">${escapeHtml(t.description)}</div>
                </div>
            </div>
            <div class="git-template-footer">
                <code class="git-template-code">${escapeHtml(t.command)}</code>
                <span class="git-template-hint">点击应用</span>
            </div>
        </button>
    `).join('');
}

// 应用模板到输出区
function applyGitTemplate(command) {
    document.getElementById('git-command-output').value = command;
    document.getElementById('git-command-desc').textContent = '已选择模板命令';
}

// 更新分支表单显示
function updateGitBranchForm() {
    const action = document.getElementById('git-branch-action')?.value;
    const nameGroup = document.getElementById('git-branch-name-group');
    const newnameGroup = document.getElementById('git-branch-newname-group');
    const forceGroup = document.getElementById('git-branch-force-group');
    const remoteGroup = document.getElementById('git-branch-remote-group');

    if (!action) return;

    // 隐藏所有可选字段
    if (nameGroup) nameGroup.style.display = 'none';
    if (newnameGroup) newnameGroup.style.display = 'none';
    if (forceGroup) forceGroup.style.display = 'none';
    if (remoteGroup) remoteGroup.style.display = 'none';

    // 根据操作类型显示相应字段
    switch (action) {
        case 'create':
        case 'switch':
            if (nameGroup) nameGroup.style.display = '';
            break;
        case 'delete':
            if (nameGroup) nameGroup.style.display = '';
            if (forceGroup) forceGroup.style.display = '';
            break;
        case 'rename':
            if (nameGroup) nameGroup.style.display = '';
            if (newnameGroup) newnameGroup.style.display = '';
            break;
        case 'list':
            if (remoteGroup) remoteGroup.style.display = '';
            break;
    }
}

// 更新暂存表单显示
function updateGitStashForm() {
    const action = document.getElementById('git-stash-action')?.value;
    const messageGroup = document.getElementById('git-stash-message-group');
    const indexGroup = document.getElementById('git-stash-index-group');

    if (!action) return;

    // 隐藏所有字段
    if (messageGroup) messageGroup.style.display = 'none';
    if (indexGroup) indexGroup.style.display = 'none';

    // 根据操作类型显示相应字段
    switch (action) {
        case 'save':
            if (messageGroup) messageGroup.style.display = '';
            break;
        case 'pop':
        case 'apply':
        case 'drop':
            if (indexGroup) indexGroup.style.display = '';
            break;
        // list 和 clear 不需要额外字段
    }
}

// Git 场景命令调度器：
// 页面位置：tool-git 页底部的命令预览区。
// - 不同标签页(scene)共用同一个输出框，因此这里像一个小型 dispatcher；
// - 它根据 currentGitScene 调用对应 generateXxxCmd()，再把 command/description 写回页面。
function updateGitCommand() {
    const outputEl = document.getElementById('git-command-output');
    const descEl = document.getElementById('git-command-desc');

    if (!window.DogToolboxM26Utils) {
        if (outputEl) outputEl.value = '';
        if (descEl) descEl.textContent = '工具模块未加载';
        return;
    }

    try {
        let result = null;

        switch (currentGitScene) {
            case 'commit':
                result = generateCommitCmd();
                break;
            case 'branch':
                result = generateBranchCmd();
                break;
            case 'log':
                result = generateLogCmd();
                break;
            case 'reset':
                result = generateResetCmd();
                break;
            case 'clone':
                result = generateCloneCmd();
                break;
            case 'merge':
                result = generateMergeCmd();
                break;
            case 'stash':
                result = generateStashCmd();
                break;
            case 'rebase':
                result = generateRebaseCmd();
                break;
            case 'cherrypick':
                result = generateCherryPickCmd();
                break;
            case 'tag':
                result = generateTagCmd();
                break;
            case 'remote':
                result = generateRemoteCmd();
                break;
            case 'revert':
                result = generateRevertCmd();
                break;
        }

        if (result) {
            if (outputEl) outputEl.value = result.command || '';
            if (descEl) descEl.textContent = result.description || '';
        } else {
            if (outputEl) outputEl.value = '';
            if (descEl) descEl.textContent = '请填写必要参数';
        }
    } catch (e) {
        if (outputEl) outputEl.value = '';
        if (descEl) descEl.textContent = `错误：${e.message || String(e)}`;
    }
}

// 生成 Commit 命令
function generateCommitCmd() {
    const message = document.getElementById('git-commit-message')?.value.trim();

    // 验证必填字段
    if (!validateInput('git-commit-message', message)) {
        return null;
    }

    const options = {
        all: document.getElementById('git-commit-all')?.checked || false,
        amend: document.getElementById('git-commit-amend')?.checked || false,
        noVerify: document.getElementById('git-commit-noverify')?.checked || false
    };

    return DogToolboxM26Utils.generateCommitCommand(message, options);
}

// 生成 Branch 命令
function generateBranchCmd() {
    const action = document.getElementById('git-branch-action')?.value;
    const name = document.getElementById('git-branch-name')?.value.trim();

    if (action === 'list') {
        // list 操作不需要 name，清除错误样式
        clearValidationErrors(['git-branch-name']);
        const options = {
            remote: document.getElementById('git-branch-remote')?.checked || false
        };
        return DogToolboxM26Utils.generateBranchCommand(action, '', options);
    }

    // 其他操作需要验证 name
    if (!validateInput('git-branch-name', name)) {
        return null;
    }

    const options = {
        newName: document.getElementById('git-branch-newname')?.value.trim(),
        force: document.getElementById('git-branch-force')?.checked || false
    };

    return DogToolboxM26Utils.generateBranchCommand(action, name, options);
}

// 生成 Log 命令
function generateLogCmd() {
    const options = {
        oneline: document.getElementById('git-log-oneline')?.checked || false,
        graph: document.getElementById('git-log-graph')?.checked || false,
        maxCount: parseInt(document.getElementById('git-log-count')?.value) || null,
        author: document.getElementById('git-log-author')?.value.trim(),
        grep: document.getElementById('git-log-grep')?.value.trim()
    };

    return DogToolboxM26Utils.generateLogCommand(options);
}

// 生成 Reset 命令
function generateResetCmd() {
    const mode = document.getElementById('git-reset-mode')?.value || 'mixed';
    const ref = document.getElementById('git-reset-ref')?.value.trim();

    return DogToolboxM26Utils.generateResetCommand(mode, ref);
}

// 生成 Clone 命令
function generateCloneCmd() {
    const url = document.getElementById('git-clone-url')?.value.trim();

    // 验证必填字段
    if (!validateInput('git-clone-url', url)) {
        return null;
    }

    const options = {
        branch: document.getElementById('git-clone-branch')?.value.trim(),
        targetDir: document.getElementById('git-clone-dir')?.value.trim(),
        depth: parseInt(document.getElementById('git-clone-depth')?.value) || null,
        recursive: document.getElementById('git-clone-recursive')?.checked || false
    };

    return DogToolboxM26Utils.generateCloneCommand(url, options);
}

// 生成 Merge 命令
function generateMergeCmd() {
    const branch = document.getElementById('git-merge-branch')?.value.trim();

    // 验证必填字段
    if (!validateInput('git-merge-branch', branch)) {
        return null;
    }

    const options = {
        noFf: document.getElementById('git-merge-noff')?.checked || false,
        squash: document.getElementById('git-merge-squash')?.checked || false,
        message: document.getElementById('git-merge-message')?.value.trim()
    };

    return DogToolboxM26Utils.generateMergeCommand(branch, options);
}

// 生成 Stash 命令
function generateStashCmd() {
    const action = document.getElementById('git-stash-action')?.value;

    const options = {
        message: document.getElementById('git-stash-message')?.value.trim(),
        index: parseInt(document.getElementById('git-stash-index')?.value)
    };

    if (isNaN(options.index)) {
        options.index = undefined;
    }

    return DogToolboxM26Utils.generateStashCommand(action, options);
}

// 生成 Rebase 命令
function generateRebaseCmd() {
    const branch = document.getElementById('git-rebase-branch')?.value.trim();

    if (!validateInput('git-rebase-branch', branch)) {
        return null;
    }

    const options = {
        interactive: document.getElementById('git-rebase-interactive')?.checked || false,
        onto: document.getElementById('git-rebase-onto')?.value.trim() || undefined
    };

    return DogToolboxM26Utils.generateRebaseCommand(branch, options);
}

// 生成 Cherry-pick 命令
function generateCherryPickCmd() {
    const commits = document.getElementById('git-cherrypick-commits')?.value.trim();

    if (!validateInput('git-cherrypick-commits', commits)) {
        return null;
    }

    const mainline = parseInt(document.getElementById('git-cherrypick-mainline')?.value);
    const options = {
        noCommit: document.getElementById('git-cherrypick-nocommit')?.checked || false,
        edit: document.getElementById('git-cherrypick-edit')?.checked || false,
        signoff: document.getElementById('git-cherrypick-signoff')?.checked || false,
        mainline: isNaN(mainline) ? undefined : mainline
    };

    return DogToolboxM26Utils.generateCherryPickCommand(commits, options);
}

// 生成 Tag 命令
function generateTagCmd() {
    const action = document.getElementById('git-tag-action')?.value;
    const tagName = document.getElementById('git-tag-name')?.value.trim();

    if (action === 'list') {
        clearValidationErrors(['git-tag-name']);
        return DogToolboxM26Utils.generateTagCommand(action, '');
    }

    if (!validateInput('git-tag-name', tagName)) {
        return null;
    }

    const options = {
        annotate: document.getElementById('git-tag-annotate')?.checked || false,
        message: document.getElementById('git-tag-message')?.value.trim() || undefined,
        remote: document.getElementById('git-tag-remote')?.value.trim() || 'origin',
        force: document.getElementById('git-tag-force')?.checked || false
    };

    return DogToolboxM26Utils.generateTagCommand(action, tagName, options);
}

// 更新 Tag 表单显示
function updateGitTagForm() {
    const action = document.getElementById('git-tag-action')?.value;
    const nameGroup = document.getElementById('git-tag-name-group');
    const annotateGroup = document.getElementById('git-tag-annotate-group');
    const messageGroup = document.getElementById('git-tag-message-group');
    const remoteGroup = document.getElementById('git-tag-remote-group');
    const forceGroup = document.getElementById('git-tag-force-group');

    // 默认显示
    if (nameGroup) nameGroup.style.display = '';
    if (annotateGroup) annotateGroup.style.display = 'none';
    if (messageGroup) messageGroup.style.display = 'none';
    if (remoteGroup) remoteGroup.style.display = 'none';
    if (forceGroup) forceGroup.style.display = 'none';

    switch (action) {
        case 'create':
            if (annotateGroup) annotateGroup.style.display = '';
            if (messageGroup) messageGroup.style.display = '';
            break;
        case 'push':
            if (remoteGroup) remoteGroup.style.display = '';
            if (forceGroup) forceGroup.style.display = '';
            break;
        case 'list':
            if (nameGroup) nameGroup.style.display = 'none';
            break;
    }
}

// 生成 Remote 命令
function generateRemoteCmd() {
    const action = document.getElementById('git-remote-action')?.value;
    const name = document.getElementById('git-remote-name')?.value.trim() || 'origin';
    const url = document.getElementById('git-remote-url')?.value.trim();
    const newName = document.getElementById('git-remote-newname')?.value.trim();

    if (action === 'add' || action === 'set-url') {
        if (!validateInput('git-remote-url', url)) {
            return null;
        }
        return DogToolboxM26Utils.generateRemoteCommand(action, name, url);
    }

    if (action === 'rename') {
        if (!validateInput('git-remote-newname', newName)) {
            return null;
        }
        return DogToolboxM26Utils.generateRemoteCommand(action, name, newName);
    }

    clearValidationErrors(['git-remote-url', 'git-remote-newname']);
    return DogToolboxM26Utils.generateRemoteCommand(action, name, '');
}

// 更新 Remote 表单显示
function updateGitRemoteForm() {
    const action = document.getElementById('git-remote-action')?.value;
    const urlGroup = document.getElementById('git-remote-url-group');
    const newNameGroup = document.getElementById('git-remote-newname-group');

    if (urlGroup) urlGroup.style.display = 'none';
    if (newNameGroup) newNameGroup.style.display = 'none';

    switch (action) {
        case 'add':
        case 'set-url':
            if (urlGroup) urlGroup.style.display = '';
            break;
        case 'rename':
            if (newNameGroup) newNameGroup.style.display = '';
            break;
    }
}

// 生成 Revert 命令
function generateRevertCmd() {
    const commits = document.getElementById('git-revert-commits')?.value.trim();

    if (!validateInput('git-revert-commits', commits)) {
        return null;
    }

    const mainline = parseInt(document.getElementById('git-revert-mainline')?.value);
    const options = {
        noCommit: document.getElementById('git-revert-nocommit')?.checked || false,
        noEdit: document.getElementById('git-revert-noedit')?.checked || false,
        mainline: isNaN(mainline) ? undefined : mainline
    };

    return DogToolboxM26Utils.generateRevertCommand(commits, options);
}

function copyGitCommand(btn) {
    const output = document.getElementById('git-command-output').value;
    if (!output) return;
    copyToolText(btn, output, { showTextFeedback: true });
}

// ==================== M27 Docker 命令生成器 ====================
// 对应 tool-docker 页面，按 run/build/compose 等场景整理表单并实时生成命令。

function switchDockerScene(scene, evt) {
    currentDockerScene = scene;

    // 更新标签激活状态
    document.querySelectorAll('.tool-tab').forEach(tab => {
        tab.classList.remove('active');
    });
    if (evt?.target) {
        evt.target.classList.add('active');
    }

    // 更新场景显示
    document.querySelectorAll('.docker-scene').forEach(s => {
        s.classList.remove('active');
    });
    document.getElementById(`docker-scene-${scene}`)?.classList.add('active');

    // 重置面板过滤状态
    resetPanelFiltering('.docker-tool');

    // 更新命令
    updateDockerCommand();
}

function updateDockerComposeForm() {
    const action = document.getElementById('docker-compose-action')?.value;
    const serviceGroup = document.getElementById('docker-compose-service-group');
    const detachGroup = document.getElementById('docker-compose-detach-group');
    const volumesGroup = document.getElementById('docker-compose-volumes-group');

    if (!action) return;

    // 默认全部隐藏
    if (serviceGroup) serviceGroup.style.display = 'none';
    if (detachGroup) detachGroup.style.display = 'none';
    if (volumesGroup) volumesGroup.style.display = 'none';

    // 根据操作类型显示相应字段
    switch (action) {
        case 'up':
            if (detachGroup) detachGroup.style.display = '';
            if (serviceGroup) serviceGroup.style.display = '';
            break;
        case 'down':
            if (volumesGroup) volumesGroup.style.display = '';
            break;
        case 'start':
        case 'stop':
        case 'restart':
        case 'build':
        case 'pull':
            if (serviceGroup) serviceGroup.style.display = '';
            break;
        case 'logs':
        case 'exec':
            if (serviceGroup) serviceGroup.style.display = '';
            break;
    }
}


// Docker 场景命令调度器：
// 页面位置：tool-docker 页底部的命令预览区。
// - 与 Git 类似，这里根据 currentDockerScene 分发到各类 generateXxxCmd()；
// - 页面上的各种输入只负责提供参数，真正输出什么命令由这里统一收口。
function updateDockerCommand() {
    const outputEl = document.getElementById('docker-command-output');
    const descEl = document.getElementById('docker-command-desc');

    if (!window.DogToolboxM27Utils) {
        if (outputEl) outputEl.value = '';
        if (descEl) descEl.textContent = '工具模块未加载';
        return;
    }

    try {
        let result = null;

        switch (currentDockerScene) {
            case 'run': result = generateRunCmd(); break;
            case 'build': result = generateBuildCmd(); break;
            case 'compose': result = generateComposeCmd(); break;
            case 'exec': result = generateExecCmd(); break;
            case 'logs': result = generateLogsCmd(); break;
            case 'ps': result = generatePsCmd(); break;
            case 'images': result = generateImagesCmd(); break;
            case 'container': result = generateContainerCmd(); break;
            case 'network': result = generateNetworkCmd(); break;
            case 'volume': result = generateVolumeCmd(); break;
            case 'prune': result = generatePruneCmd(); break;
            case 'cp': result = generateCpCmd(); break;
        }

        if (result) {
            if (outputEl) outputEl.value = result.command || '';
            if (descEl) descEl.textContent = result.description || '';
        } else {
            if (outputEl) outputEl.value = '';
            if (descEl) descEl.textContent = '请填写必要参数';
        }
    } catch (e) {
        if (outputEl) outputEl.value = '';
        if (descEl) descEl.textContent = `错误：${e.message || String(e)}`;
    }
}

function generateRunCmd() {
    const image = document.getElementById('docker-run-image')?.value.trim();

    // 验证必填字段
    if (!validateInput('docker-run-image', image)) {
        return null;
    }

    const options = {
        name: document.getElementById('docker-run-name')?.value.trim(),
        detach: document.getElementById('docker-run-detach')?.checked || false,
        interactive: document.getElementById('docker-run-interactive')?.checked || false,
        rm: document.getElementById('docker-run-rm')?.checked || false,
        network: document.getElementById('docker-run-network')?.value.trim(),
        restart: document.getElementById('docker-run-restart')?.value.trim(),
        memory: document.getElementById('docker-run-memory')?.value.trim(),
        cpus: document.getElementById('docker-run-cpus')?.value.trim(),
        command: document.getElementById('docker-run-command')?.value.trim()
    };

    // 解析端口映射
    const portsStr = document.getElementById('docker-run-ports')?.value.trim();
    if (portsStr) {
        options.ports = portsStr.split(',').map(p => p.trim()).filter(p => p);
    }

    // 解析卷挂载
    const volumesStr = document.getElementById('docker-run-volumes')?.value.trim();
    if (volumesStr) {
        options.volumes = volumesStr.split(',').map(v => v.trim()).filter(v => v);
    }

    // 解析环境变量
    const envStr = document.getElementById('docker-run-env')?.value.trim();
    if (envStr) {
        options.env = envStr.split(',').map(e => e.trim()).filter(e => e);
    }

    return DogToolboxM27Utils.generateRunCommand(image, options);
}

function generateBuildCmd() {
    const path = document.getElementById('docker-build-path')?.value.trim();
    const tag = document.getElementById('docker-build-tag')?.value.trim();

    // 验证必填字段
    const pathValid = validateInput('docker-build-path', path);
    const tagValid = validateInput('docker-build-tag', tag);

    if (!pathValid || !tagValid) {
        return null;
    }

    const options = {
        tag: tag,
        file: document.getElementById('docker-build-file')?.value.trim(),
        target: document.getElementById('docker-build-target')?.value.trim(),
        noCache: document.getElementById('docker-build-nocache')?.checked || false,
        pull: document.getElementById('docker-build-pull')?.checked || false
    };

    // 解析构建参数
    const argStr = document.getElementById('docker-build-arg')?.value.trim();
    if (argStr) {
        options.buildArg = argStr.split(',').map(a => a.trim()).filter(a => a);
    }

    return DogToolboxM27Utils.generateBuildCommand(path, options);
}

function generateComposeCmd() {
    const action = document.getElementById('docker-compose-action')?.value;
    if (!action) return null;

    const options = {
        file: document.getElementById('docker-compose-file')?.value.trim(),
        projectName: document.getElementById('docker-compose-project')?.value.trim(),
        service: document.getElementById('docker-compose-service')?.value.trim(),
        detach: document.getElementById('docker-compose-detach')?.checked || false,
        volumes: document.getElementById('docker-compose-volumes')?.checked || false
    };

    return DogToolboxM27Utils.generateComposeCommand(action, options);
}

function generateExecCmd() {
    const container = document.getElementById('docker-exec-container')?.value.trim();
    const command = document.getElementById('docker-exec-command')?.value.trim();

    // 验证必填字段
    const containerValid = validateInput('docker-exec-container', container);
    const commandValid = validateInput('docker-exec-command', command);

    if (!containerValid || !commandValid) {
        return null;
    }

    const options = {
        interactive: document.getElementById('docker-exec-interactive')?.checked || false,
        workdir: document.getElementById('docker-exec-workdir')?.value.trim(),
        user: document.getElementById('docker-exec-user')?.value.trim()
    };

    return DogToolboxM27Utils.generateExecCommand(container, command, options);
}

function generateLogsCmd() {
    const container = document.getElementById('docker-logs-container')?.value.trim();

    // 验证必填字段
    if (!validateInput('docker-logs-container', container)) {
        return null;
    }

    const options = {
        follow: document.getElementById('docker-logs-follow')?.checked || false,
        timestamps: document.getElementById('docker-logs-timestamps')?.checked || false,
        tail: document.getElementById('docker-logs-tail')?.value.trim(),
        since: document.getElementById('docker-logs-since')?.value.trim()
    };

    return DogToolboxM27Utils.generateLogsCommand(container, options);
}

function generatePsCmd() {
    const options = {
        all: document.getElementById('docker-ps-all')?.checked || false,
        quiet: document.getElementById('docker-ps-quiet')?.checked || false,
        filter: document.getElementById('docker-ps-filter')?.value.trim()
    };

    return DogToolboxM27Utils.generatePsCommand(options);
}

function generateImagesCmd() {
    const options = {
        all: document.getElementById('docker-images-all')?.checked || false,
        quiet: document.getElementById('docker-images-quiet')?.checked || false,
        filter: document.getElementById('docker-images-filter')?.value.trim()
    };

    return DogToolboxM27Utils.generateImagesCommand(options);
}

function generateContainerCmd() {
    const action = document.getElementById('docker-container-action')?.value;
    const namesStr = document.getElementById('docker-container-names')?.value.trim();

    if (!action || !namesStr) return null;

    const containers = namesStr.split(/\s+/).filter(n => n);
    if (containers.length === 0) return null;

    const options = {
        force: document.getElementById('docker-container-force')?.checked || false
    };

    return DogToolboxM27Utils.generateContainerCommand(action, containers, options);
}


function copyDockerCommand(btn) {
    const output = document.getElementById('docker-command-output').value;
    if (!output) return;
    copyToolText(btn, output, { showTextFeedback: true });
}

// Network 命令生成
function generateNetworkCmd() {
    const action = document.getElementById('docker-network-action')?.value;
    if (!action) return null;

    const name = document.getElementById('docker-network-name')?.value.trim();
    const container = document.getElementById('docker-network-container')?.value.trim();

    // 根据操作类型验证必填字段
    if (['create', 'rm', 'inspect'].includes(action)) {
        if (!validateInput('docker-network-name', name)) return null;
    }
    if (['connect', 'disconnect'].includes(action)) {
        if (!validateInput('docker-network-name', name)) return null;
        if (!validateInput('docker-network-container', container)) return null;
    }

    const options = {
        driver: document.getElementById('docker-network-driver')?.value || '',
        subnet: document.getElementById('docker-network-subnet')?.value.trim() || '',
        gateway: document.getElementById('docker-network-gateway')?.value.trim() || '',
        ip: document.getElementById('docker-network-ip')?.value.trim() || '',
        force: document.getElementById('docker-network-force')?.checked || false
    };

    clearValidationErrors();
    return DogToolboxM27Utils.generateNetworkCommand(action, name, { ...options, container });
}

// Network 表单动态更新
function updateDockerNetworkForm() {
    const action = document.getElementById('docker-network-action')?.value;

    const showName = ['create', 'rm', 'inspect', 'connect', 'disconnect'].includes(action);
    const showDriver = action === 'create';
    const showSubnet = action === 'create';
    const showGateway = action === 'create';
    const showContainer = ['connect', 'disconnect'].includes(action);
    const showIp = action === 'connect';
    const showForce = action === 'prune';

    document.getElementById('docker-network-name-group').style.display = showName ? '' : 'none';
    document.getElementById('docker-network-driver-group').style.display = showDriver ? '' : 'none';
    document.getElementById('docker-network-subnet-group').style.display = showSubnet ? '' : 'none';
    document.getElementById('docker-network-gateway-group').style.display = showGateway ? '' : 'none';
    document.getElementById('docker-network-container-group').style.display = showContainer ? '' : 'none';
    document.getElementById('docker-network-ip-group').style.display = showIp ? '' : 'none';
    document.getElementById('docker-network-force-group').style.display = showForce ? '' : 'none';

    clearValidationErrors();
}

// Volume 命令生成
function generateVolumeCmd() {
    const action = document.getElementById('docker-volume-action')?.value;
    if (!action) return null;

    const name = document.getElementById('docker-volume-name')?.value.trim();

    // 根据操作类型验证必填字段
    if (['create', 'rm', 'inspect'].includes(action)) {
        if (!validateInput('docker-volume-name', name)) return null;
    }

    const optsStr = document.getElementById('docker-volume-opts')?.value.trim() || '';
    const opts = optsStr ? optsStr.split(',').map(o => o.trim()).filter(o => o) : [];

    const options = {
        driver: document.getElementById('docker-volume-driver')?.value || '',
        opt: opts,
        filter: document.getElementById('docker-volume-filter')?.value.trim() || '',
        force: document.getElementById('docker-volume-force')?.checked || false
    };

    clearValidationErrors();
    return DogToolboxM27Utils.generateVolumeCommand(action, name, options);
}

// Volume 表单动态更新
function updateDockerVolumeForm() {
    const action = document.getElementById('docker-volume-action')?.value;

    const showName = ['create', 'rm', 'inspect'].includes(action);
    const showDriver = action === 'create';
    const showOpts = action === 'create';
    const showFilter = ['ls', 'prune'].includes(action);
    const showForce = ['rm', 'prune'].includes(action);

    document.getElementById('docker-volume-name-group').style.display = showName ? '' : 'none';
    document.getElementById('docker-volume-driver-group').style.display = showDriver ? '' : 'none';
    document.getElementById('docker-volume-opts-group').style.display = showOpts ? '' : 'none';
    document.getElementById('docker-volume-filter-group').style.display = showFilter ? '' : 'none';
    document.getElementById('docker-volume-force-group').style.display = showForce ? '' : 'none';

    clearValidationErrors();
}

// Prune 命令生成
function generatePruneCmd() {
    const options = {
        all: document.getElementById('docker-prune-all')?.checked || false,
        volumes: document.getElementById('docker-prune-volumes')?.checked || false,
        force: document.getElementById('docker-prune-force')?.checked || false,
        filter: document.getElementById('docker-prune-filter')?.value.trim() || ''
    };

    return DogToolboxM27Utils.generateSystemPruneCommand(options);
}

// CP 命令生成
function generateCpCmd() {
    const direction = document.getElementById('docker-cp-direction')?.value;
    const container = document.getElementById('docker-cp-container')?.value.trim();
    const hostPath = document.getElementById('docker-cp-host-path')?.value.trim();
    const containerPath = document.getElementById('docker-cp-container-path')?.value.trim();

    if (!validateInput('docker-cp-container', container)) return null;
    if (!validateInput('docker-cp-host-path', hostPath)) return null;
    if (!validateInput('docker-cp-container-path', containerPath)) return null;

    let source, dest;
    if (direction === 'to-container') {
        source = hostPath;
        dest = `${container}:${containerPath}`;
    } else {
        source = `${container}:${containerPath}`;
        dest = hostPath;
    }

    const options = {
        archive: document.getElementById('docker-cp-archive')?.checked || false,
        followLink: document.getElementById('docker-cp-follow-link')?.checked || false
    };

    clearValidationErrors();
    return DogToolboxM27Utils.generateCpCommand(source, dest, options);
}

// CP 表单动态更新
function updateDockerCpForm() {
    const direction = document.getElementById('docker-cp-direction')?.value;
    const hostLabel = document.getElementById('docker-cp-host-label');
    const containerLabel = document.getElementById('docker-cp-container-label');

    if (direction === 'to-container') {
        if (hostLabel) hostLabel.textContent = '主机路径 (源) *';
        if (containerLabel) containerLabel.textContent = '容器路径 (目标) *';
    } else {
        if (hostLabel) hostLabel.textContent = '主机路径 (目标) *';
        if (containerLabel) containerLabel.textContent = '容器路径 (源) *';
    }

    clearValidationErrors();
}

// ==================== Docker Service 命令生成器 ====================
// 对应 tool-docker-service 页面，负责 service create/update 等运维场景。

let currentDockerServiceScene = 'create';

function switchDockerServiceScene(scene, evt) {
    currentDockerServiceScene = scene;

    // 更新标签激活状态
    const container = document.querySelector('.docker-service-tool');
    if (container) {
        container.querySelectorAll('.tool-tab').forEach(tab => {
            tab.classList.remove('active');
            tab.setAttribute('aria-selected', 'false');
        });
    }
    if (evt?.target) {
        const tab = evt.target.closest('.tool-tab');
        if (tab) {
            tab.classList.add('active');
            tab.setAttribute('aria-selected', 'true');
        }
    }

    // 更新场景显示
    document.querySelectorAll('.docker-service-scene').forEach(s => {
        s.classList.remove('active');
    });
    document.getElementById(`docker-service-scene-${scene}`)?.classList.add('active');

    const toolEl = document.querySelector('.docker-service-tool');
    if (toolEl && !toolEl.dataset.panelFilterInit) {
        initPanelFiltering('.docker-service-tool');
        toolEl.dataset.panelFilterInit = 'true';
    }

    resetPanelFiltering('.docker-service-tool');
    updateDockerServiceCommand();
}

function updateDockerServiceCommand() {
    const outputEl = document.getElementById('docker-service-command-output');
    const descEl = document.getElementById('docker-service-command-desc');

    if (!window.DogToolboxM27Utils) {
        if (outputEl) outputEl.value = '';
        if (descEl) descEl.textContent = '工具模块未加载';
        return;
    }

    try {
        let result = null;

        switch (currentDockerServiceScene) {
            case 'create': result = generateServiceCreateCmd(); break;
            case 'update': result = generateServiceUpdateCmd(); break;
            case 'scale': result = generateServiceScaleCmd(); break;
            case 'logs': result = generateServiceLogsCmd(); break;
            case 'ps': result = generateServicePsCmd(); break;
            case 'ls': result = generateServiceLsCmd(); break;
            case 'rm': result = generateServiceRmCmd(); break;
        }

        if (result) {
            if (outputEl) outputEl.value = result.command || '';
            if (descEl) descEl.textContent = result.description || '';
        } else {
            if (outputEl) outputEl.value = '';
            if (descEl) descEl.textContent = '请填写必要参数';
        }
    } catch (e) {
        if (outputEl) outputEl.value = '';
        if (descEl) descEl.textContent = `错误：${e.message || String(e)}`;
    }
}

function generateServiceCreateCmd() {
    const image = document.getElementById('docker-service-create-image')?.value.trim();
    const name = document.getElementById('docker-service-create-name')?.value.trim();

    const imageValid = validateInput('docker-service-create-image', image);
    const nameValid = validateInput('docker-service-create-name', name);

    if (!imageValid || !nameValid) {
        return null;
    }

    const options = {
        image,
        name,
        replicas: document.getElementById('docker-service-create-replicas')?.value.trim(),
        endpointMode: document.getElementById('docker-service-create-endpoint-mode')?.value.trim(),
        cpuLimit: document.getElementById('docker-service-create-cpu-limit')?.value.trim(),
        cpuReserve: document.getElementById('docker-service-create-cpu-reserve')?.value.trim(),
        memoryLimit: document.getElementById('docker-service-create-memory-limit')?.value.trim(),
        memoryReserve: document.getElementById('docker-service-create-memory-reserve')?.value.trim(),
        updateParallelism: document.getElementById('docker-service-create-update-parallelism')?.value.trim(),
        updateDelay: document.getElementById('docker-service-create-update-delay')?.value.trim(),
        updateFailureAction: document.getElementById('docker-service-create-update-failure-action')?.value.trim()
    };

    const publishStr = document.getElementById('docker-service-create-publish')?.value.trim();
    if (publishStr) {
        options.publish = publishStr.split(',').map(p => p.trim()).filter(p => p);
    }

    const networksStr = document.getElementById('docker-service-create-networks')?.value.trim();
    if (networksStr) {
        options.networks = networksStr.split(',').map(n => n.trim()).filter(n => n);
    }

    const mountsStr = document.getElementById('docker-service-create-mounts')?.value.trim();
    if (mountsStr) {
        options.mounts = mountsStr.split(',').map(m => m.trim()).filter(m => m);
    }

    return DogToolboxM27Utils.generateServiceCreateCommand(options);
}

function generateServiceUpdateCmd() {
    const serviceName = document.getElementById('docker-service-update-name')?.value.trim();

    if (!validateInput('docker-service-update-name', serviceName)) {
        return null;
    }

    const options = {
        image: document.getElementById('docker-service-update-image')?.value.trim(),
        replicas: document.getElementById('docker-service-update-replicas')?.value.trim(),
        endpointMode: document.getElementById('docker-service-update-endpoint-mode')?.value.trim(),
        cpuLimit: document.getElementById('docker-service-update-cpu-limit')?.value.trim(),
        cpuReserve: document.getElementById('docker-service-update-cpu-reserve')?.value.trim(),
        memoryLimit: document.getElementById('docker-service-update-memory-limit')?.value.trim(),
        memoryReserve: document.getElementById('docker-service-update-memory-reserve')?.value.trim(),
        updateParallelism: document.getElementById('docker-service-update-update-parallelism')?.value.trim(),
        updateDelay: document.getElementById('docker-service-update-update-delay')?.value.trim(),
        updateFailureAction: document.getElementById('docker-service-update-update-failure-action')?.value.trim()
    };

    const publishStr = document.getElementById('docker-service-update-publish')?.value.trim();
    if (publishStr) {
        options.publish = publishStr.split(',').map(p => p.trim()).filter(p => p);
    }

    const networksStr = document.getElementById('docker-service-update-networks')?.value.trim();
    if (networksStr) {
        options.networks = networksStr.split(',').map(n => n.trim()).filter(n => n);
    }

    const mountsStr = document.getElementById('docker-service-update-mounts')?.value.trim();
    if (mountsStr) {
        options.mounts = mountsStr.split(',').map(m => m.trim()).filter(m => m);
    }

    return DogToolboxM27Utils.generateServiceUpdateCommand(serviceName, options);
}

function generateServiceScaleCmd() {
    const serviceName = document.getElementById('docker-service-scale-name')?.value.trim();
    const replicas = document.getElementById('docker-service-scale-replicas')?.value.trim();

    const nameValid = validateInput('docker-service-scale-name', serviceName);
    const replicasValid = validateInput('docker-service-scale-replicas', replicas);

    if (!nameValid || !replicasValid) {
        return null;
    }

    return DogToolboxM27Utils.generateServiceScaleCommand(serviceName, replicas);
}

function generateServiceLogsCmd() {
    const serviceName = document.getElementById('docker-service-logs-name')?.value.trim();

    if (!validateInput('docker-service-logs-name', serviceName)) {
        return null;
    }

    const options = {
        follow: document.getElementById('docker-service-logs-follow')?.checked || false,
        timestamps: document.getElementById('docker-service-logs-timestamps')?.checked || false,
        tail: document.getElementById('docker-service-logs-tail')?.value.trim()
    };

    return DogToolboxM27Utils.generateServiceLogsCommand(serviceName, options);
}

function generateServicePsCmd() {
    const serviceName = document.getElementById('docker-service-ps-name')?.value.trim();

    if (!validateInput('docker-service-ps-name', serviceName)) {
        return null;
    }

    return DogToolboxM27Utils.generateServicePsCommand(serviceName);
}

function generateServiceLsCmd() {
    return DogToolboxM27Utils.generateServiceLsCommand();
}

function generateServiceRmCmd() {
    const namesStr = document.getElementById('docker-service-rm-names')?.value.trim();

    if (!validateInput('docker-service-rm-names', namesStr)) {
        return null;
    }

    const names = namesStr.split(/\s+/).filter(n => n);
    if (names.length === 0) return null;

    return DogToolboxM27Utils.generateServiceRmCommand(names);
}

function copyDockerServiceCommand(btn) {
    const output = document.getElementById('docker-service-command-output').value;
    if (!output) return;
    copyToolText(btn, output, { showTextFeedback: true });
}

// ==================== Docker Swarm 命令生成器 ====================
// 对应 tool-docker-swarm 页面，围绕 swarm init/join/service 等命令组装。

let currentDockerSwarmL1 = 'swarm';
let currentDockerSwarmL2 = 'init';
let currentDockerStackL2 = 'deploy';

function switchDockerSwarmL1Tab(l1, evt) {
    currentDockerSwarmL1 = l1;

    // 更新 L1 标签激活状态
    const container = document.querySelector('.docker-swarm-tool');
    if (container) {
        container.querySelectorAll('.tool-tabs-modern:not(.tool-tabs-modern-level2) > .tool-tab').forEach(tab => {
            tab.classList.remove('active');
            tab.setAttribute('aria-selected', 'false');
        });
    }
    if (evt?.target) {
        const tab = evt.target.closest('.tool-tab');
        if (tab) {
            tab.classList.add('active');
            tab.setAttribute('aria-selected', 'true');
        }
    }

    // 更新 L1 场景显示
    document.querySelectorAll('.docker-swarm-l1-scene').forEach(s => {
        s.classList.remove('active');
    });
    document.getElementById(`docker-swarm-l1-scene-${l1}`)?.classList.add('active');

    updateDockerSwarmCommand();
}

function switchDockerSwarmL2Tab(l1, l2, evt) {
    if (l1 === 'swarm') {
        currentDockerSwarmL2 = l2;
    } else {
        currentDockerStackL2 = l2;
    }

    // 更新 L2 标签激活状态
    const l1Container = document.getElementById(`docker-swarm-l1-scene-${l1}`);
    if (l1Container) {
        l1Container.querySelectorAll('.tool-tabs-modern-level2 .tool-tab').forEach(tab => {
            tab.classList.remove('active');
            tab.setAttribute('aria-selected', 'false');
        });
    }
    if (evt?.target) {
        const tab = evt.target.closest('.tool-tab');
        if (tab) {
            tab.classList.add('active');
            tab.setAttribute('aria-selected', 'true');
        }
    }

    // 更新 L2 场景显示
    const sceneClass = l1 === 'swarm' ? 'docker-swarm-l2-scene' : 'docker-stack-l2-scene';
    const scenePrefix = l1 === 'swarm' ? 'docker-swarm-l2-scene' : 'docker-stack-l2-scene';

    if (l1Container) {
        l1Container.querySelectorAll(`.${sceneClass}`).forEach(s => {
            s.classList.remove('active');
        });
    }
    document.getElementById(`${scenePrefix}-${l2}`)?.classList.add('active');

    updateDockerSwarmCommand();
}

function updateDockerSwarmCommand() {
    const outputEl = document.getElementById('docker-swarm-command-output');
    const descEl = document.getElementById('docker-swarm-command-desc');

    if (!window.DogToolboxM27Utils) {
        if (outputEl) outputEl.value = '';
        if (descEl) descEl.textContent = '工具模块未加载';
        return;
    }

    try {
        let result = null;

        if (currentDockerSwarmL1 === 'swarm') {
            switch (currentDockerSwarmL2) {
                case 'init': result = generateSwarmInitCmd(); break;
                case 'join': result = generateSwarmJoinCmd(); break;
                case 'leave': result = generateSwarmLeaveCmd(); break;
                case 'update': result = generateSwarmUpdateCmd(); break;
                case 'unlock': result = generateSwarmUnlockCmd(); break;
            }
        } else {
            switch (currentDockerStackL2) {
                case 'deploy': result = generateStackDeployCmd(); break;
                case 'ls': result = generateStackLsCmd(); break;
                case 'ps': result = generateStackPsCmd(); break;
                case 'services': result = generateStackServicesCmd(); break;
                case 'rm': result = generateStackRmCmd(); break;
            }
        }

        if (result) {
            if (outputEl) outputEl.value = result.command || '';
            if (descEl) descEl.textContent = result.description || '';
        } else {
            if (outputEl) outputEl.value = '';
            if (descEl) descEl.textContent = '请填写必要参数';
        }
    } catch (e) {
        if (outputEl) outputEl.value = '';
        if (descEl) descEl.textContent = `错误：${e.message || String(e)}`;
    }
}

function generateSwarmInitCmd() {
    const options = {
        advertiseAddr: document.getElementById('swarm-init-advertise-addr')?.value.trim(),
        listenAddr: document.getElementById('swarm-init-listen-addr')?.value.trim(),
        forceNewCluster: document.getElementById('swarm-init-force-new-cluster')?.checked || false
    };

    return DogToolboxM27Utils.generateSwarmInitCommand(options);
}

function generateSwarmJoinCmd() {
    const addr = document.getElementById('swarm-join-addr')?.value.trim();
    const token = document.getElementById('swarm-join-token')?.value.trim();

    const addrValid = validateInput('swarm-join-addr', addr);
    const tokenValid = validateInput('swarm-join-token', token);

    if (!addrValid || !tokenValid) {
        return null;
    }

    const options = {
        token,
        advertiseAddr: document.getElementById('swarm-join-advertise-addr')?.value.trim(),
        listenAddr: document.getElementById('swarm-join-listen-addr')?.value.trim()
    };

    return DogToolboxM27Utils.generateSwarmJoinCommand(addr, options);
}

function generateSwarmLeaveCmd() {
    const options = {
        force: document.getElementById('swarm-leave-force')?.checked || false
    };

    return DogToolboxM27Utils.generateSwarmLeaveCommand(options);
}

function generateSwarmUpdateCmd() {
    const autolockTrue = document.getElementById('swarm-update-autolock-true')?.checked || false;
    const autolockFalse = document.getElementById('swarm-update-autolock-false')?.checked || false;

    const options = {
        certExpiry: document.getElementById('swarm-update-cert-expiry')?.value.trim(),
        dispatcherHeartbeat: document.getElementById('swarm-update-dispatcher-heartbeat')?.value.trim()
    };

    if (autolockTrue) options.autolock = true;
    else if (autolockFalse) options.autolock = false;

    return DogToolboxM27Utils.generateSwarmUpdateCommand(options);
}

function generateSwarmUnlockCmd() {
    return DogToolboxM27Utils.generateSwarmUnlockCommand();
}

function generateStackDeployCmd() {
    const stackName = document.getElementById('stack-deploy-name')?.value.trim();
    const composeFiles = document.getElementById('stack-deploy-compose-files')?.value.trim();

    const nameValid = validateInput('stack-deploy-name', stackName);
    const filesValid = validateInput('stack-deploy-compose-files', composeFiles);

    if (!nameValid || !filesValid) {
        return null;
    }

    const files = composeFiles.split(',').map(f => f.trim()).filter(f => f);

    const options = {
        composeFiles: files,
        withRegistryAuth: document.getElementById('stack-deploy-with-registry-auth')?.checked || false,
        prune: document.getElementById('stack-deploy-prune')?.checked || false,
        resolveImage: document.getElementById('stack-deploy-resolve-image')?.value.trim()
    };

    return DogToolboxM27Utils.generateStackDeployCommand(stackName, options);
}

function generateStackLsCmd() {
    return DogToolboxM27Utils.generateStackLsCommand();
}

function generateStackPsCmd() {
    const stackName = document.getElementById('stack-ps-name')?.value.trim();

    if (!validateInput('stack-ps-name', stackName)) {
        return null;
    }

    return DogToolboxM27Utils.generateStackPsCommand(stackName);
}

function generateStackServicesCmd() {
    const stackName = document.getElementById('stack-services-name')?.value.trim();

    if (!validateInput('stack-services-name', stackName)) {
        return null;
    }

    return DogToolboxM27Utils.generateStackServicesCommand(stackName);
}

function generateStackRmCmd() {
    const namesStr = document.getElementById('stack-rm-names')?.value.trim();

    if (!validateInput('stack-rm-names', namesStr)) {
        return null;
    }

    const names = namesStr.split(/\s+/).filter(n => n);
    if (names.length === 0) return null;

    return DogToolboxM27Utils.generateStackRmCommand(names);
}

function copyDockerSwarmCommand(btn) {
    const output = document.getElementById('docker-swarm-command-output').value;
    if (!output) return;
    copyToolText(btn, output, { showTextFeedback: true });
}


// ==================== M28 JSON Schema 生成 ====================
// 对应 tool-json-schema 页面，把样例 JSON 转成 Schema，并回填右侧结果区。
function clearJsonSchemaTool() {
    document.getElementById('jsonschema-input').value = '';
    document.getElementById('jsonschema-output').value = '';
    document.getElementById('jsonschema-errors').innerHTML = '';
}

function updateJsonSchemaTool() {
    const input = document.getElementById('jsonschema-input').value;
    const outputEl = document.getElementById('jsonschema-output');
    const errorsEl = document.getElementById('jsonschema-errors');
    const allRequiredEl = document.getElementById('jsonschema-all-required');
    const inferEnumEl = document.getElementById('jsonschema-infer-enum');

    errorsEl.innerHTML = '';

    if (!input.trim()) {
        outputEl.value = '';
        return;
    }

    const options = {
        allRequired: allRequiredEl?.checked ?? true,
        inferEnum: inferEnumEl?.checked ?? false
    };

    const result = DogToolboxM28Utils.generateSchema(input, options);

    if (result.error) {
        errorsEl.innerHTML = `<div class="error-message">错误：${escapeHtml(result.error)}</div>`;
        outputEl.value = '';
    } else {
        outputEl.value = JSON.stringify(result.schema, null, 2);
    }
}

function copyJsonSchemaOutput(btn) {
    const output = document.getElementById('jsonschema-output').value;
    if (!output) return;
    copyToolText(btn, output, { showTextFeedback: true });
}

async function downloadJsonSchema() {
    const output = document.getElementById('jsonschema-output').value;
    if (!output) return;

    // 优先使用后端保存对话框（避免 pywebview 环境下前端下载导致崩溃）
    if (window.pywebview && window.pywebview.api && window.pywebview.api.save_file_dialog) {
        try {
            const result = await window.pywebview.api.save_file_dialog({
                content: output,
                default_filename: 'schema.json'
            });
            if (result.success) {
                showToast('已保存到: ' + result.path);
            } else if (result.error && result.error !== '用户取消了保存') {
                showToast('保存失败: ' + result.error, 'error');
            }
        } catch (e) {
            showToast('保存失败: ' + e.message, 'error');
        }
        return;
    }

    // 回退到前端下载方式
    const blob = new Blob([output], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'schema.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

// ==================== M24 HTTP 请求测试 ====================
// 对应旧版 tool-http 占位/轻量测试逻辑，重点是请求参数整理和响应显示。

// HTTP 调试工具初始化：
// 页面位置：tool-http 页的整块请求编辑工作台。
// - 负责给 Params / Headers / Body / Response 等编辑区挂上默认状态；
// - 也负责准备标签页切换和初始的请求表单结构。
function initHttpTool() {
    // 初始化默认请求头（常用请求头预填充）
    const headersEditor = document.getElementById('http-headers-editor');
    if (headersEditor) {
        headersEditor.innerHTML = `
            <div class="http-kv-row">
                <input type="text" placeholder="Header Name" class="http-kv-key" autocapitalize="off" autocorrect="off" spellcheck="false" value="Content-Type">
                <input type="text" placeholder="Header Value" class="http-kv-value" autocapitalize="off" autocorrect="off" spellcheck="false" value="application/json">
                <button class="btn btn-sm btn-ghost" onclick="removeHttpKvRow(this)">-</button>
            </div>
            <div class="http-kv-row">
                <input type="text" placeholder="Header Name" class="http-kv-key" autocapitalize="off" autocorrect="off" spellcheck="false" value="Accept">
                <input type="text" placeholder="Header Value" class="http-kv-value" autocapitalize="off" autocorrect="off" spellcheck="false" value="application/json, text/plain, */*">
                <button class="btn btn-sm btn-ghost" onclick="removeHttpKvRow(this)">-</button>
            </div>
            <div class="http-kv-row">
                <input type="text" placeholder="Header Name" class="http-kv-key" autocapitalize="off" autocorrect="off" spellcheck="false" value="User-Agent">
                <input type="text" placeholder="Header Value" class="http-kv-value" autocapitalize="off" autocorrect="off" spellcheck="false" value="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36">
                <button class="btn btn-sm btn-ghost" onclick="removeHttpKvRow(this)">-</button>
            </div>
            <div class="http-kv-row">
                <input type="text" placeholder="Header Name" class="http-kv-key" autocapitalize="off" autocorrect="off" spellcheck="false">
                <input type="text" placeholder="Header Value" class="http-kv-value" autocapitalize="off" autocorrect="off" spellcheck="false">
                <button class="btn btn-sm btn-ghost" onclick="addHttpHeader()">+</button>
            </div>
        `;
    }
}

function clearHttpTool() {
    document.getElementById('http-url').value = '';
    document.getElementById('http-method').value = 'GET';
    document.getElementById('http-body-text').value = '';
    document.getElementById('http-response-body').value = '';
    document.getElementById('http-response-headers-text').value = '';
    document.getElementById('http-response-meta').innerHTML = '';
    document.getElementById('http-curl-input').value = '';

    // 重置参数和请求头
    const paramsEditor = document.getElementById('http-params-editor');
    if (paramsEditor) {
        paramsEditor.innerHTML = `
            <div class="http-kv-row">
                <input type="text" placeholder="Key" class="http-kv-key" autocapitalize="off" autocorrect="off" spellcheck="false">
                <input type="text" placeholder="Value" class="http-kv-value" autocapitalize="off" autocorrect="off" spellcheck="false">
                <button class="btn btn-sm btn-ghost" onclick="addHttpParam()">+</button>
            </div>
        `;
    }

    initHttpTool();
}

function switchHttpTab(tab) {
    // 切换标签激活状态
    document.querySelectorAll('.http-tabs .http-tab').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.tab === tab);
    });

    // 切换内容显示（兼容两种结构）
    document.querySelectorAll('.http-tab-content').forEach(content => {
        if (content.id === `http-tab-${tab}`) {
            content.classList.add('active');
        } else if (content.id && content.id.startsWith('http-tab-')) {
            content.classList.remove('active');
        }
    });
}

function switchHttpResponseTab(tab) {
    // 切换标签激活状态
    document.querySelectorAll('.http-response-tabs .http-tab').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.tab === tab);
    });

    // 切换内容显示
    document.querySelectorAll('.http-response-content .http-tab-content').forEach(content => {
        content.classList.toggle('active', content.id === `http-tab-${tab}`);
    });
}

function switchHttpBodyType(type) {
    httpBodyType = type;
    const editor = document.getElementById('http-body-editor');
    if (!editor) return;

    if (type === 'none') {
        editor.style.display = 'none';
    } else {
        editor.style.display = 'block';
    }

    // 如果是 form 类型，显示 form 编辑器
    if (type === 'form') {
        const bodyText = document.getElementById('http-body-text');
        const formEditor = document.getElementById('http-form-editor');

        if (bodyText) bodyText.style.display = 'none';
        if (formEditor) {
            formEditor.style.display = 'block';
        } else {
            // 如果没有 form 编辑器，创建一个
            const bodyEditor = document.getElementById('http-body-editor');
            if (bodyEditor && !bodyEditor.querySelector('#http-form-editor')) {
                const formEditorDiv = document.createElement('div');
                formEditorDiv.id = 'http-form-editor';
                formEditorDiv.className = 'http-kv-editor';
                formEditorDiv.innerHTML = `
                    <div class="http-kv-row">
                        <input type="text" placeholder="Key" class="http-kv-key" autocapitalize="off" autocorrect="off" spellcheck="false">
                        <input type="text" placeholder="Value" class="http-kv-value" autocapitalize="off" autocorrect="off" spellcheck="false">
                        <label class="http-kv-enable"><input type="checkbox" checked> 启用</label>
                        <button class="btn btn-sm btn-ghost" onclick="addHttpFormRow()">+</button>
                    </div>
                `;
                bodyEditor.appendChild(formEditorDiv);
            }
        }
    } else {
        const bodyText = document.getElementById('http-body-text');
        const formEditor = document.getElementById('http-form-editor');

        if (bodyText) bodyText.style.display = 'block';
        if (formEditor) formEditor.style.display = 'none';
    }
}

function addHttpParam() {
    const editor = document.getElementById('http-params-editor');
    const lastRow = editor.querySelector('.http-kv-row:last-child');
    const newRow = document.createElement('div');
    newRow.className = 'http-kv-row';
    newRow.innerHTML = `
        <input type="text" placeholder="Key" class="http-kv-key" autocapitalize="off" autocorrect="off" spellcheck="false" autocapitalize="off" autocorrect="off" spellcheck="false">
        <input type="text" placeholder="Value" class="http-kv-value" autocapitalize="off" autocorrect="off" spellcheck="false" autocapitalize="off" autocorrect="off" spellcheck="false">
        <button class="btn btn-sm btn-ghost" onclick="addHttpParam()">+</button>
    `;

    // 将最后一行的 + 按钮改为 - 按钮
    const lastBtn = lastRow.querySelector('button');
    lastBtn.textContent = '-';
    lastBtn.onclick = function() { removeHttpKvRow(this); };

    editor.appendChild(newRow);
}

function addHttpHeader() {
    const editor = document.getElementById('http-headers-editor');
    const lastRow = editor.querySelector('.http-kv-row:last-child');
    const newRow = document.createElement('div');
    newRow.className = 'http-kv-row';
    newRow.innerHTML = `
        <input type="text" placeholder="Header Name" class="http-kv-key" autocapitalize="off" autocorrect="off" spellcheck="false" autocapitalize="off" autocorrect="off" spellcheck="false">
        <input type="text" placeholder="Header Value" class="http-kv-value" autocapitalize="off" autocorrect="off" spellcheck="false" autocapitalize="off" autocorrect="off" spellcheck="false">
        <label class="http-kv-enable"><input type="checkbox" checked> 启用</label>
        <button class="btn btn-sm btn-ghost" onclick="addHttpHeader()">+</button>
    `;

    // 将最后一行的 + 按钮改为 - 按钮
    const lastBtn = lastRow.querySelector('button');
    lastBtn.textContent = '-';
    lastBtn.onclick = function() { removeHttpKvRow(this); };

    editor.appendChild(newRow);
}

function addHttpFormRow() {
    const editor = document.getElementById('http-form-editor');
    if (!editor) return;

    const lastRow = editor.querySelector('.http-kv-row:last-child');
    const newRow = document.createElement('div');
    newRow.className = 'http-kv-row';
    newRow.innerHTML = `
        <input type="text" placeholder="Key" class="http-kv-key" autocapitalize="off" autocorrect="off" spellcheck="false" autocapitalize="off" autocorrect="off" spellcheck="false">
        <input type="text" placeholder="Value" class="http-kv-value" autocapitalize="off" autocorrect="off" spellcheck="false" autocapitalize="off" autocorrect="off" spellcheck="false">
        <label class="http-kv-enable"><input type="checkbox" checked> 启用</label>
        <button class="btn btn-sm btn-ghost" onclick="addHttpFormRow()">+</button>
    `;

    // 将最后一行的 + 按钮改为 - 按钮
    const lastBtn = lastRow.querySelector('button');
    lastBtn.textContent = '-';
    lastBtn.onclick = function() { removeHttpKvRow(this); };

    editor.appendChild(newRow);
}

function removeHttpKvRow(btn) {
    const row = btn.closest('.http-kv-row');
    row.remove();
}

function getHttpParams() {
    const params = {};
    document.querySelectorAll('#http-params-editor .http-kv-row').forEach(row => {
        const key = row.querySelector('.http-kv-key').value.trim();
        const value = row.querySelector('.http-kv-value').value.trim();
        if (key) {
            params[key] = value;
        }
    });
    return params;
}

function getHttpHeaders() {
    const headers = {};
    document.querySelectorAll('#http-headers-editor .http-kv-row').forEach(row => {
        const key = row.querySelector('.http-kv-key').value.trim();
        const value = row.querySelector('.http-kv-value').value.trim();
        if (key) {
            headers[key] = value;
        }
    });
    return headers;
}

// 发送 HTTP 请求：
// 页面触发：tool-http 页里的“发送”按钮。
// - 这是 HTTP 工具最核心的执行入口；
// - 会从页面各个编辑区收集 method/url/params/headers/body，做变量替换后交给后端代理请求；
// - 返回结果后再统一更新状态栏、响应头、响应体、树形视图和本地历史记录。
async function sendHttpRequest() {
    const method = document.getElementById('http-method').value;
    let url = document.getElementById('http-url').value.trim();
    const responseBodyEl = document.getElementById('http-response-body');
    const responseHeadersEl = document.getElementById('http-response-headers-text');
    const responseMetaEl = document.getElementById('http-response-meta');

    if (!url) {
        responseBodyEl.value = '错误：请输入 URL';
        return;
    }

    try {
        // 应用环境变量替换
        if (typeof replaceVariablesInText === 'function') {
            url = replaceVariablesInText(url);
        }

        // 构建完整 URL（带参数）
        const params = getHttpParams();
        // 替换参数中的环境变量
        if (typeof replaceVariablesInText === 'function') {
            Object.keys(params).forEach(key => {
                params[key] = replaceVariablesInText(params[key]);
            });
        }
        const fullUrl = DogToolboxM24Utils.buildUrl(url, params);

        // 构建请求头
        const headers = getHttpHeaders();
        // 替换请求头中的环境变量
        if (typeof replaceVariablesInText === 'function') {
            Object.keys(headers).forEach(key => {
                headers[key] = replaceVariablesInText(headers[key]);
            });
        }

        // 构建请求体
        let body = null;
        if (httpBodyType !== 'none' && (method === 'POST' || method === 'PUT' || method === 'PATCH')) {
            body = document.getElementById('http-body-text').value || null;
            // 替换请求体中的环境变量
            if (body && typeof replaceVariablesInText === 'function') {
                body = replaceVariablesInText(body);
            }
        }

        // 显示发送中状态
        responseMetaEl.innerHTML = '<span style="color: #666;">发送中...</span>';

        // 优先使用后端代理（解决 CORS 问题）
        let result;
        if (window.pywebview && window.pywebview.api && window.pywebview.api.http_request) {
            // 获取 SSL 验证设置
            const verifySsl = document.getElementById('http-verify-ssl')?.checked ?? true;
            console.log('[HTTP] Sending request:', { method, fullUrl, verifySsl });
            result = await window.pywebview.api.http_request(method, fullUrl, headers, body, 30, verifySsl);
            console.log('[HTTP] Response:', result);

            if (!result.success && result.error) {
                // 区分 SSL 错误，显示更友好的提示
                const errorClass = result.error_type === 'SSLError' ? 'ssl-error' : '';
                responseBodyEl.value = `错误：${result.error}`;
                responseMetaEl.innerHTML = `<span style="color: #ef4444;" class="${errorClass}">请求失败${result.error_type ? ` (${result.error_type})` : ''}</span>`;
                return;
            }

            // 显示响应
            responseBodyEl.value = result.body || '';

            // 格式化响应头
            if (result.headers) {
                responseHeadersEl.value = Object.keys(result.headers)
                    .map(key => `${key}: ${result.headers[key]}`)
                    .join('\n');
            }

            // 显示元信息
            const statusColor = result.status >= 200 && result.status < 400 ? '#10b981' : '#ef4444';
            const size = new Blob([result.body || '']).size;
            responseMetaEl.innerHTML = `
                <span style="color: ${statusColor}; font-weight: bold;">Status: ${result.status} ${result.statusText || ''}</span>
                <span style="margin-left: 16px;">Time: ${DogToolboxM24Utils.formatResponseTime(result.duration || 0)}</span>
                <span style="margin-left: 16px;">Size: ${DogToolboxM24Utils.formatResponseSize(size)}</span>
            `;

            // 强制刷新 UI（解决 pywebview 异步更新问题）
            responseBodyEl.dispatchEvent(new Event('input'));
            responseHeadersEl.dispatchEvent(new Event('input'));

            // 强制重绘响应面板
            const responsePanel = document.querySelector('.http-response-panel');
            if (responsePanel) {
                responsePanel.style.display = 'none';
                responsePanel.offsetHeight; // 触发重排
                responsePanel.style.display = '';
            }

            // 自动切换到 Body 标签
            switchHttpResponseTab('response-body');

            // 保存请求历史
            if (typeof saveHttpRequestHistory === 'function') {
                saveHttpRequestHistory(method, fullUrl, headers, body, {
                    status: result.status,
                    body: result.body,
                    duration: result.duration
                });
            }

            // 更新 JSON 树形视图
            if (typeof updateHttpResponseTree === 'function') {
                updateHttpResponseTree();
            }
        } else {
            // 回退到前端 fetch（可能有 CORS 限制）
            const config = {
                method: method,
                headers: headers
            };

            if (body) {
                config.body = body;
            }

            const startTime = Date.now();
            const response = await fetch(fullUrl, config);
            const endTime = Date.now();
            const duration = endTime - startTime;

            // 获取响应头
            const responseHeaders = {};
            response.headers.forEach((value, key) => {
                responseHeaders[key] = value;
            });

            // 获取响应体
            const contentType = response.headers.get('content-type') || '';
            let responseBody;

            if (contentType.includes('application/json')) {
                const json = await response.json();
                responseBody = JSON.stringify(json, null, 2);
            } else {
                responseBody = await response.text();
            }

            // 显示响应
            responseBodyEl.value = responseBody;
            responseHeadersEl.value = Object.keys(responseHeaders)
                .map(key => `${key}: ${responseHeaders[key]}`)
                .join('\n');

            // 显示元信息
            const statusColor = response.ok ? '#10b981' : '#ef4444';
            const size = new Blob([responseBody]).size;
            responseMetaEl.innerHTML = `
                <span style="color: ${statusColor}; font-weight: bold;">Status: ${response.status} ${response.statusText}</span>
                <span style="margin-left: 16px;">Time: ${DogToolboxM24Utils.formatResponseTime(duration)}</span>
                <span style="margin-left: 16px;">Size: ${DogToolboxM24Utils.formatResponseSize(size)}</span>
            `;

            // 保存请求历史
            if (typeof saveHttpRequestHistory === 'function') {
                saveHttpRequestHistory(method, fullUrl, headers, body, {
                    status: response.status,
                    body: responseBody,
                    duration: duration
                });
            }

            // 更新 JSON 树形视图
            if (typeof updateHttpResponseTree === 'function') {
                updateHttpResponseTree();
            }
        }

    } catch (e) {
        responseBodyEl.value = `错误：${e.message || String(e)}`;
        responseMetaEl.innerHTML = '<span style="color: #ef4444;">请求失败</span>';
    }
}

function importCurl() {
    const curlInput = document.getElementById('http-curl-input').value;
    if (!curlInput.trim()) return;

    const config = DogToolboxM24Utils.parseCurl(curlInput);

    if (config.error) {
        alert(config.error);
        return;
    }

    // 设置 URL（使用 baseUrl，不带 Query 参数）
    document.getElementById('http-url').value = config.baseUrl || config.url;
    document.getElementById('http-method').value = config.method;

    // 设置 Query 参数
    const paramsEditor = document.getElementById('http-params-editor');
    paramsEditor.innerHTML = '';
    if (config.params && Object.keys(config.params).length > 0) {
        Object.keys(config.params).forEach(key => {
            const row = document.createElement('div');
            row.className = 'http-kv-row';
            row.innerHTML = `
                <input type="text" placeholder="Key" class="http-kv-key" autocapitalize="off" autocorrect="off" spellcheck="false" value="${escapeHtml(key)}">
                <input type="text" placeholder="Value" class="http-kv-value" autocapitalize="off" autocorrect="off" spellcheck="false" value="${escapeHtml(config.params[key])}">
                <button class="btn btn-sm btn-ghost" onclick="removeHttpKvRow(this)">-</button>
            `;
            paramsEditor.appendChild(row);
        });
    }
    // 添加空行
    const emptyParamRow = document.createElement('div');
    emptyParamRow.className = 'http-kv-row';
    emptyParamRow.innerHTML = `
        <input type="text" placeholder="Key" class="http-kv-key" autocapitalize="off" autocorrect="off" spellcheck="false">
        <input type="text" placeholder="Value" class="http-kv-value" autocapitalize="off" autocorrect="off" spellcheck="false">
        <button class="btn btn-sm btn-ghost" onclick="addHttpParam()">+</button>
    `;
    paramsEditor.appendChild(emptyParamRow);

    // 设置请求头
    const headersEditor = document.getElementById('http-headers-editor');
    headersEditor.innerHTML = '';
    Object.keys(config.headers).forEach(key => {
        const row = document.createElement('div');
        row.className = 'http-kv-row';
        row.innerHTML = `
            <input type="text" placeholder="Header Name" class="http-kv-key" autocapitalize="off" autocorrect="off" spellcheck="false" value="${escapeHtml(key)}">
            <input type="text" placeholder="Header Value" class="http-kv-value" autocapitalize="off" autocorrect="off" spellcheck="false" value="${escapeHtml(config.headers[key])}">
            <button class="btn btn-sm btn-ghost" onclick="removeHttpKvRow(this)">-</button>
        `;
        headersEditor.appendChild(row);
    });

    // 添加空行
    const emptyRow = document.createElement('div');
    emptyRow.className = 'http-kv-row';
    emptyRow.innerHTML = `
        <input type="text" placeholder="Header Name" class="http-kv-key" autocapitalize="off" autocorrect="off" spellcheck="false">
        <input type="text" placeholder="Header Value" class="http-kv-value" autocapitalize="off" autocorrect="off" spellcheck="false">
        <button class="btn btn-sm btn-ghost" onclick="addHttpHeader()">+</button>
    `;
    headersEditor.appendChild(emptyRow);

    // 设置请求体
    if (config.body) {
        // 根据 Content-Type 自动切换 body 类型
        const contentType = config.headers['Content-Type'] || config.headers['content-type'] || '';
        let bodyType = 'raw';

        if (contentType.includes('application/json')) {
            bodyType = 'json';
        } else if (contentType.includes('application/x-www-form-urlencoded')) {
            bodyType = 'form';
        }

        document.querySelector(`input[name="http-body-type"][value="${bodyType}"]`).checked = true;
        switchHttpBodyType(bodyType);

        if (bodyType === 'json' || bodyType === 'raw') {
            document.getElementById('http-body-text').value = config.body;
        } else if (bodyType === 'form') {
            // 解析 form 数据
            const formEditor = document.getElementById('http-body-form-editor');
            formEditor.innerHTML = '';
            const pairs = config.body.split('&');
            pairs.forEach(pair => {
                const [key, value] = pair.split('=').map(decodeURIComponent);
                if (key) {
                    const row = document.createElement('div');
                    row.className = 'http-kv-row';
                    row.innerHTML = `
                        <input type="text" placeholder="Key" class="http-kv-key" autocapitalize="off" autocorrect="off" spellcheck="false" value="${escapeHtml(key)}">
                        <input type="text" placeholder="Value" class="http-kv-value" autocapitalize="off" autocorrect="off" spellcheck="false" value="${escapeHtml(value || '')}">
                        <button class="btn btn-sm btn-ghost" onclick="removeHttpKvRow(this)">-</button>
                    `;
                    formEditor.appendChild(row);
                }
            });
            // 添加空行
            const emptyFormRow = document.createElement('div');
            emptyFormRow.className = 'http-kv-row';
            emptyFormRow.innerHTML = `
                <input type="text" placeholder="Key" class="http-kv-key" autocapitalize="off" autocorrect="off" spellcheck="false">
                <input type="text" placeholder="Value" class="http-kv-value" autocapitalize="off" autocorrect="off" spellcheck="false">
                <button class="btn btn-sm btn-ghost" onclick="addHttpFormField()">+</button>
            `;
            formEditor.appendChild(emptyFormRow);
        }
    } else {
        // 无 body 时清空请求体
        document.querySelector('input[name="http-body-type"][value="raw"]').checked = true;
        switchHttpBodyType('raw');
        document.getElementById('http-body-text').value = '';
    }

    // 切换到请求头标签，让用户看到导入的结果
    switchHttpTab('headers');
    showToast('cURL 解析成功，已填充到请求表单', 'success');
}

function exportCurl() {
    const method = document.getElementById('http-method').value;
    const url = document.getElementById('http-url').value.trim();

    if (!url) {
        alert('请先输入 URL');
        return;
    }

    const params = getHttpParams();
    const fullUrl = DogToolboxM24Utils.buildUrl(url, params);

    const config = {
        method: method,
        url: fullUrl,
        headers: getHttpHeaders(),
        body: httpBodyType !== 'none' ? document.getElementById('http-body-text').value : ''
    };

    const curl = DogToolboxM24Utils.generateCurl(config);
    document.getElementById('http-curl-input').value = curl;

    // 切换到 cURL 标签
    switchHttpTab('curl');
}

// ==================== M25 WebSocket 测试 ====================
// 对应 tool-websocket 页面，负责连接、断开、消息发送和收发日志渲染。

function initWebSocketTool() {
    // 初始化完成
}

function clearWebSocketTool() {
    if (wsConnection) {
        wsConnection.close();
        wsConnection = null;
    }
    document.getElementById('ws-url').value = '';
    document.getElementById('ws-message-input').value = '';
    clearWebSocketMessages();
    updateWebSocketStatus('未连接', 'disconnected');
}

function clearWebSocketMessages() {
    wsMessages = [];
    document.getElementById('ws-messages-list').innerHTML = '';
}

function updateWebSocketStatus(text, status) {
    const statusEl = document.getElementById('ws-status');
    const btnEl = document.getElementById('ws-connect-btn');

    statusEl.textContent = text;
    statusEl.className = `ws-status ws-status-${status}`;

    if (status === 'connected') {
        btnEl.textContent = '断开';
        btnEl.classList.remove('btn-primary');
        btnEl.classList.add('btn-danger');
    } else {
        btnEl.textContent = '连接';
        btnEl.classList.remove('btn-danger');
        btnEl.classList.add('btn-primary');
    }
}

function addWebSocketMessage(type, content) {
    const message = DogToolboxM25Utils.formatMessage(type, content);
    wsMessages.push(message);

    const messagesList = document.getElementById('ws-messages-list');
    const messageEl = document.createElement('div');
    messageEl.className = `ws-message ws-message-${type}`;

    const formatJson = document.getElementById('ws-format-json').checked;
    let displayContent = content;

    if (formatJson && type !== 'system') {
        displayContent = DogToolboxM25Utils.tryFormatJson(content);
    }

    messageEl.innerHTML = `
        <div class="ws-message-header">
            <span class="ws-message-type">${type === 'sent' ? '发送' : type === 'received' ? '接收' : '系统'}</span>
            <span class="ws-message-time">${message.timestamp}</span>
        </div>
        <div class="ws-message-content">${escapeHtml(displayContent)}</div>
    `;

    messagesList.appendChild(messageEl);
    messagesList.scrollTop = messagesList.scrollHeight;
}

function toggleWebSocketConnection() {
    if (wsConnection && wsConnection.readyState === WebSocket.OPEN) {
        // 断开连接
        wsAutoReconnect = false;
        wsConnection.close();
    } else {
        // 建立连接
        connectWebSocket();
    }
}

// 发起 WebSocket 连接：
// 页面触发：tool-websocket 页里的“连接”按钮。
// - 根据当前页面输入的 URL 和开关状态创建连接对象；
// - 并把 onopen / onmessage / onerror / onclose 都绑定到当前工具页的状态展示区域。
function connectWebSocket() {
    const url = document.getElementById('ws-url').value.trim();

    if (!url) {
        addWebSocketMessage('system', '错误：请输入 WebSocket URL');
        return;
    }

    if (!DogToolboxM25Utils.isValidWsUrl(url)) {
        addWebSocketMessage('system', '错误：无效的 WebSocket URL（必须以 ws:// 或 wss:// 开头）');
        return;
    }

    try {
        updateWebSocketStatus('连接中...', 'connecting');
        wsConnection = new WebSocket(url);
        wsAutoReconnect = document.getElementById('ws-auto-reconnect').checked;

        wsConnection.onopen = function() {
            updateWebSocketStatus('已连接', 'connected');
            addWebSocketMessage('system', `已连接到 ${url}`);

            if (wsReconnectTimer) {
                clearTimeout(wsReconnectTimer);
                wsReconnectTimer = null;
            }
        };

        wsConnection.onmessage = function(event) {
            addWebSocketMessage('received', event.data);
        };

        wsConnection.onerror = function(error) {
            addWebSocketMessage('system', '连接错误');
            updateWebSocketStatus('错误', 'error');
        };

        wsConnection.onclose = function(event) {
            updateWebSocketStatus('已断开', 'disconnected');
            addWebSocketMessage('system', `连接已关闭 (code: ${event.code})`);

            // 自动重连
            if (wsAutoReconnect && !wsReconnectTimer) {
                addWebSocketMessage('system', '5 秒后自动重连...');
                wsReconnectTimer = setTimeout(() => {
                    wsReconnectTimer = null;
                    connectWebSocket();
                }, 5000);
            }
        };

    } catch (e) {
        addWebSocketMessage('system', `连接失败：${e.message || String(e)}`);
        updateWebSocketStatus('失败', 'error');
    }
}

function sendWebSocketMessage() {
    if (!wsConnection || wsConnection.readyState !== WebSocket.OPEN) {
        addWebSocketMessage('system', '错误：未连接到 WebSocket 服务器');
        return;
    }

    const messageInput = document.getElementById('ws-message-input');
    const message = messageInput.value.trim();

    if (!message) {
        return;
    }

    const messageType = document.querySelector('input[name="ws-message-type"]:checked').value;

    try {
        let sendData = message;

        if (messageType === 'json') {
            // 验证 JSON 格式
            JSON.parse(message);
        }

        wsConnection.send(sendData);
        addWebSocketMessage('sent', sendData);
        messageInput.value = '';

    } catch (e) {
        addWebSocketMessage('system', `发送失败：${e.message || String(e)}`);
    }
}

function sendWebSocketPing() {
    if (!wsConnection || wsConnection.readyState !== WebSocket.OPEN) {
        addWebSocketMessage('system', '错误：未连接到 WebSocket 服务器');
        return;
    }

    try {
        wsConnection.send('ping');
        addWebSocketMessage('sent', 'ping');
    } catch (e) {
        addWebSocketMessage('system', `Ping 失败：${e.message || String(e)}`);
    }
}

// ==================== M29 Mock 数据生成 ====================
// 对应 tool-mock 页面，围绕规则输入、结果生成与复制导出。
function clearMockTool() {
    document.getElementById('mock-output').value = '';
}

function generateMockData() {
    const type = document.getElementById('mock-type').value;
    const count = parseInt(document.getElementById('mock-count').value) || 10;
    const format = document.getElementById('mock-output-format')?.value || 'lines';
    const outputEl = document.getElementById('mock-output');

    const results = [];

    try {
        for (let i = 0; i < count; i++) {
            let value;
            switch (type) {
                case 'name':
                    value = DogToolboxM29Utils.randomName();
                    break;
                case 'email':
                    value = DogToolboxM29Utils.randomEmail();
                    break;
                case 'phone':
                    value = DogToolboxM29Utils.randomPhone();
                    break;
                case 'idcard':
                    value = DogToolboxM29Utils.randomIdCard();
                    break;
                case 'address':
                    value = DogToolboxM29Utils.randomAddress();
                    break;
                case 'uuid':
                    value = DogToolboxM29Utils.randomUuid();
                    break;
                case 'date':
                    value = DogToolboxM29Utils.randomDate();
                    break;
                default:
                    value = DogToolboxM29Utils.randomName();
            }
            results.push(value);
        }

        // 根据输出格式生成结果
        let output;
        switch (format) {
            case 'json':
                output = JSON.stringify(results, null, 2);
                break;
            case 'csv':
                output = results.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',\n');
                break;
            case 'jsonlines':
                output = results.map(v => JSON.stringify(v)).join('\n');
                break;
            case 'lines':
            default:
                output = results.join('\n');
        }

        outputEl.value = output;
    } catch (e) {
        outputEl.value = `错误：${e.message || String(e)}`;
    }
}

function copyMockOutput(btn) {
    const output = document.getElementById('mock-output').value;
    if (!output) {
        if (btn) {
            const orig = btn.textContent;
            btn.textContent = '无内容';
            btn.classList.add('btn-danger');
            setTimeout(() => { btn.textContent = orig; btn.classList.remove('btn-danger'); }, 1200);
        }
        return;
    }
    copyToolText(btn, output, { showTextFeedback: true });
}

// ==================== M30 数据脱敏 ====================
// 对应 tool-mask 页面，处理脱敏规则选择和结果文本更新。
function clearMaskTool() {
    document.getElementById('mask-input').value = '';
    document.getElementById('mask-output').value = '';
}

function updateMaskTool() {
    const input = document.getElementById('mask-input').value;
    const type = document.getElementById('mask-type').value;
    const outputEl = document.getElementById('mask-output');
    const jsonFieldsGroup = document.getElementById('mask-json-fields-group');

    // 显示/隐藏 JSON 字段输入框
    if (jsonFieldsGroup) {
        jsonFieldsGroup.style.display = type === 'json' ? 'block' : 'none';
    }

    if (!input.trim()) {
        outputEl.value = '';
        return;
    }

    try {
        let result;
        if (type === 'auto') {
            // smartMask 返回 {result, type} 对象，需要逐行处理
            const lines = input.split('\n');
            const masked = lines.map(line => {
                if (!line.trim()) return line;
                const maskResult = DogToolboxM30Utils.smartMask(line.trim());
                return maskResult.result || line;
            });
            result = masked.join('\n');
        } else if (type === 'json') {
            // JSON 递归脱敏模式
            const jsonFieldsEl = document.getElementById('mask-json-fields');
            const customFields = jsonFieldsEl ? jsonFieldsEl.value.split(',').map(f => f.trim()).filter(Boolean) : [];
            const parsed = JSON.parse(input);
            const masked = DogToolboxM30Utils.maskJsonRecursive(parsed, customFields);
            result = JSON.stringify(masked, null, 2);
        } else {
            const lines = input.split('\n');
            const masked = lines.map(line => {
                if (!line.trim()) return line;
                switch (type) {
                    case 'phone':
                        return DogToolboxM30Utils.maskPhone(line.trim());
                    case 'idcard':
                        return DogToolboxM30Utils.maskIdCard(line.trim());
                    case 'email':
                        return DogToolboxM30Utils.maskEmail(line.trim());
                    case 'bankcard':
                        return DogToolboxM30Utils.maskBankCard(line.trim());
                    case 'name':
                        return DogToolboxM30Utils.maskName(line.trim());
                    case 'address':
                        return DogToolboxM30Utils.maskAddress(line.trim());
                    default:
                        return line;
                }
            });
            result = masked.join('\n');
        }
        outputEl.value = result;
    } catch (e) {
        outputEl.value = `错误：${e.message || String(e)}`;
    }
}

function copyMaskOutput(btn) {
    const output = document.getElementById('mask-output').value;
    if (!output) return;
    copyToolText(btn, output, { showTextFeedback: true });
}

// ==================== 工具箱：CSV 处理 (M23) ====================
// 对应 tool-csv 页面，负责文本导入、格式整理和结果输出。

function initCsvTool() {
    const inputEl = document.getElementById('csv-input');
    if (!inputEl) return;

    // Initialize state
    csvInputFormat = 'csv';
    csvOutputFormat = 'json';
    updateCsvToolUi();
}

function setCsvInputFormat(fmt) {
    if (fmt !== 'csv' && fmt !== 'json') return;
    csvInputFormat = fmt;
    updateCsvToolUi();
    updateCsvTool();
}

function setCsvOutputFormat(fmt) {
    if (fmt !== 'csv' && fmt !== 'json') return;
    csvOutputFormat = fmt;
    updateCsvToolUi();
    updateCsvTool();
}

function updateCsvToolUi() {
    document.getElementById('csv-in-csv')?.classList.toggle('active', csvInputFormat === 'csv');
    document.getElementById('csv-in-json')?.classList.toggle('active', csvInputFormat === 'json');
    document.getElementById('csv-out-csv')?.classList.toggle('active', csvOutputFormat === 'csv');
    document.getElementById('csv-out-json')?.classList.toggle('active', csvOutputFormat === 'json');
}

function updateCsvTool() {
    const inputEl = document.getElementById('csv-input');
    const outputEl = document.getElementById('csv-output');
    const errorsEl = document.getElementById('csv-errors');
    const delimiterEl = document.getElementById('csv-delimiter');
    const hasHeaderEl = document.getElementById('csv-has-header');

    if (!inputEl || !outputEl || !errorsEl) return;

    errorsEl.innerHTML = '';
    const input = inputEl.value;
    if (!input.trim()) {
        outputEl.value = '';
        return;
    }

    if (!window.DogToolboxM23Utils) {
        errorsEl.innerHTML = '<div>⚠ 工具模块未加载</div>';
        return;
    }

    try {
        const options = {
            delimiter: delimiterEl?.value || ',',
            hasHeader: hasHeaderEl?.checked ?? true
        };

        let data;
        // Parse input
        if (csvInputFormat === 'csv') {
            data = window.DogToolboxM23Utils.parseCSV(input, options);
        } else {
            data = JSON.parse(input);
        }

        // Generate output
        let output;
        if (csvOutputFormat === 'csv') {
            output = window.DogToolboxM23Utils.stringifyCSV(data, options);
        } else {
            output = JSON.stringify(data, null, 2);
        }

        outputEl.value = output;
    } catch (e) {
        const errorMsg = escapeHtml(e.message || String(e));
        errorsEl.innerHTML = `<div>⚠ ${errorMsg}</div>`;
    }
}

function clearCsvTool() {
    const inputEl = document.getElementById('csv-input');
    const outputEl = document.getElementById('csv-output');
    const errorsEl = document.getElementById('csv-errors');
    if (inputEl) inputEl.value = '';
    if (outputEl) outputEl.value = '';
    if (errorsEl) errorsEl.innerHTML = '';
}

function copyCsvOutput(btn) {
    const outputEl = document.getElementById('csv-output');
    copyToolText(btn, outputEl?.value || '', { showTextFeedback: true });
}

function detectCsvDelimiter() {
    const inputEl = document.getElementById('csv-input');
    const delimiterEl = document.getElementById('csv-delimiter');
    if (!inputEl || !delimiterEl || !window.DogToolboxM23Utils) return;

    const input = inputEl.value;
    if (!input.trim()) return;

    const detected = window.DogToolboxM23Utils.detectDelimiter(input);
    delimiterEl.value = detected;
    updateCsvTool();
}

// ==================== M22 Markdown 工具初始化 ====================
// Markdown 工具进入页面后的事件绑定和初始状态准备集中在这里。
function initMarkdownTool() {
    const inputEl = document.getElementById('markdown-input');
    if (!inputEl) return;
    inputEl.addEventListener('input', updateMarkdownTool);
    updateMarkdownTool();

    // 将帮助弹窗移动到 body，避免被 page 容器裁剪或影响层级
    const modal = document.getElementById('markdown-help-modal');
    if (modal && modal.parentElement !== document.body) {
        document.body.appendChild(modal);
    }
}

// ==================== 面板过滤功能 ====================
// 用于根据页面布局筛选/切换可见面板，是多面板工具页的共用交互。
function initPanelFiltering(containerSelector) {
    const container = document.querySelector(containerSelector);
    if (!container) return;

    const panels = container.querySelectorAll('.converter-panel');
    let activePanel = null;
    let savedPanelOffset = 0; // 记录面板在滚动容器视口中的位置，便于还原
    let savedScrollTop = 0;

    const scrollContainer = container.closest('.content')
        || document.getElementById('page-root')
        || document.scrollingElement
        || document.documentElement;
    const isWindowScroll = scrollContainer === document.documentElement || scrollContainer === document.body;
    const getScrollTop = () => (isWindowScroll
        ? (window.scrollY || document.documentElement.scrollTop || 0)
        : scrollContainer.scrollTop);
    const setScrollTop = (top) => {
        const targetTop = Math.max(top, 0);
        if (isWindowScroll) {
            window.scrollTo({ top: targetTop, behavior: 'auto' });
        } else {
            scrollContainer.scrollTo({ top: targetTop, behavior: 'auto' });
        }
    };
    const getContainerTop = () => (isWindowScroll ? 0 : scrollContainer.getBoundingClientRect().top);
    const getPanelTop = (panelEl) => panelEl.getBoundingClientRect().top - getContainerTop() + getScrollTop();
    const scrollPanelToOffset = (panelEl, offset) => {
        if (!panelEl) return;
        const panelTop = getPanelTop(panelEl);
        const targetTop = panelTop - offset;
        setScrollTop(targetTop);
    };

    panels.forEach(panel => {
        const header = panel.querySelector('.panel-header');
        if (!header) return;

        // Add title hint
        header.title = "点击聚焦/还原面板";
        const titleEl = header.querySelector('h3');
        if (titleEl && !titleEl.querySelector('.panel-return-indicator')) {
            const indicator = document.createElement('span');
            indicator.className = 'panel-return-indicator';
            indicator.textContent = '❮ 返回';
            indicator.setAttribute('aria-hidden', 'true');
            titleEl.prepend(indicator);
        }

        header.addEventListener('click', (e) => {
            // 如果点击的是按钮，不触发过滤
            if (e.target.closest('button')) return;

            // 如果点击的是当前激活的面板，显示所有面板
            if (activePanel === panel) {
                // 还原所有面板
                panels.forEach(p => {
                    p.classList.remove('panel-filtered');
                    const h = p.querySelector('.panel-header');
                    if (h) h.classList.remove('active-filter');
                });
                activePanel = null;

                const restoreScrollTop = savedScrollTop;
                requestAnimationFrame(() => {
                    setScrollTop(restoreScrollTop);
                });
            } else {
                savedScrollTop = getScrollTop();
                savedPanelOffset = panel.getBoundingClientRect().top - getContainerTop();

                // 聚焦当前面板
                panels.forEach(p => {
                    if (p === panel) {
                        p.classList.remove('panel-filtered');
                        const h = p.querySelector('.panel-header');
                        if (h) h.classList.add('active-filter');
                    } else {
                        p.classList.add('panel-filtered');
                        const h = p.querySelector('.panel-header');
                        if (h) h.classList.remove('active-filter');
                    }
                });
                activePanel = panel;

                // 聚焦后保持面板在原视口位置
                requestAnimationFrame(() => {
                    scrollPanelToOffset(panel, savedPanelOffset);
                });
            }
        });
    });
}

function resetPanelFiltering(containerSelector) {
    const container = document.querySelector(containerSelector);
    if (!container) return;

    const panels = container.querySelectorAll('.converter-panel');
    panels.forEach(p => {
        p.classList.remove('panel-filtered');
        const h = p.querySelector('.panel-header');
        if (h) h.classList.remove('active-filter');
    });
}

// ==================== M26 Git 命令生成器初始化 ====================
// Git 页进入时会通过这里绑定表单事件、默认场景和模板。
async function initGitTool() {
    // Git 工具使用场景切换和模板加载，无需额外初始化
    // 所有事件处理器已通过 onclick 绑定
    loadGitTemplates();
    initPanelFiltering('.git-tool');

    // 初始化 AI 辅助功能
    await initGitAIHelper();
}

// Git 工具 AI 辅助功能初始化
async function initGitAIHelper() {
    // 检查 AI 功能是否启用
    if (typeof checkToolAIEnabled !== 'function') return;

    const aiStatus = await checkToolAIEnabled('tool-git');
    if (!aiStatus.enabled) return;

    const container = document.getElementById('git-ai-buttons');
    if (!container) return;

    // 清空容器
    container.innerHTML = '';

    // AI 生成按钮
    if (aiStatus.features.generate) {
        const generateBtn = document.createElement('button');
        generateBtn.className = 'btn btn-sm ai-helper-btn ai-generate-btn';
        generateBtn.innerHTML = '✨ AI 生成';
        generateBtn.title = '根据描述生成 Git 命令';
        generateBtn.onclick = () => showGitAIGenerateModal();
        container.appendChild(generateBtn);
    }

    // AI 修复按钮
    if (aiStatus.features.fix) {
        const fixBtn = document.createElement('button');
        fixBtn.className = 'btn btn-sm ai-helper-btn ai-fix-btn';
        fixBtn.innerHTML = '🔧 AI 修复';
        fixBtn.title = '修复 Git 命令中的错误';
        fixBtn.onclick = () => executeGitAIFix();
        container.appendChild(fixBtn);
    }
}

// 显示 Git AI 生成弹窗
function showGitAIGenerateModal() {
    if (typeof showAIGenerateModal !== 'function') return;

    showAIGenerateModal('tool-git', {
        onGenerate: (result) => {
            // 将生成的命令填入输出框
            const output = document.getElementById('git-command-output');
            if (output) {
                output.value = result;
            }
            // 更新描述
            const desc = document.getElementById('git-command-desc');
            if (desc) {
                desc.textContent = 'AI 生成的命令';
            }
        }
    });
}

// 执行 Git AI 修复
async function executeGitAIFix() {
    if (typeof executeAIFix !== 'function') return;

    const output = document.getElementById('git-command-output');
    const content = output ? output.value.trim() : '';

    if (!content) {
        showToast('请先输入或生成 Git 命令', 'warning');
        return;
    }

    showToast('🔧 AI 正在修复...', 'info');

    const result = await executeAIFix('tool-git', content);

    if (result.success) {
        output.value = result.result;
        const desc = document.getElementById('git-command-desc');
        if (desc) {
            desc.textContent = 'AI 修复后的命令';
        }
        showToast('AI 修复完成', 'success');
    } else {
        showToast(`修复失败: ${result.error}`, 'error');
    }
}

// ==================== M27 Docker 命令生成器初始化 ====================
// Docker 页进入时的默认状态设置与事件绑定。
function initDockerTool() {
    // Docker 工具使用场景切换，无需额外初始化
    // 所有事件处理器已通过 onclick 绑定
    initPanelFiltering('.docker-tool');
}

// ==================== M28 JSON Schema 生成器初始化 ====================
// JSON Schema 页的首屏准备与按钮绑定入口。
function initJsonSchemaTool() {
    const inputEl = document.getElementById('jsonschema-input');
    if (!inputEl) return;
    inputEl.addEventListener('input', updateJsonSchemaTool);
    updateJsonSchemaTool();
}

// ========== JSON Schema 工具联动 ==========
// 把 JSON Schema 生成结果传递到 Mock 等目标工具页，属于跨工具数据桥接逻辑。

/**
 * 发送 JSON Schema 到 Mock 工具
 */
function sendSchemaToMock() {
    const outputEl = document.getElementById('jsonschema-output');
    if (!outputEl?.value) {
        showToast('请先生成 JSON Schema', 'warning');
        return;
    }
    try {
        const schema = JSON.parse(outputEl.value);
        transferDataToTool('tool-mock', schema, 'json-schema');
    } catch (e) {
        showToast('Schema 解析失败', 'error');
    }
}

/**
 * 从 JSON Schema 填充 Mock 工具
 * @param {object} schema - JSON Schema
 */
function populateMockFromSchema(schema) {
    if (!schema) return;

    // 根据 schema 生成示例数据
    const mockData = generateMockFromSchema(schema);
    const outputEl = document.getElementById('mock-output');
    if (outputEl) {
        outputEl.value = JSON.stringify(mockData, null, 2);
    }
}

/**
 * 根据 JSON Schema 生成 Mock 数据
 * @param {object} schema - JSON Schema
 * @param {number} depth - 递归深度
 * @returns {any} 生成的 Mock 数据
 */
function generateMockFromSchema(schema, depth = 0) {
    if (depth > 10 || !schema) return null;

    const type = schema.type;

    switch (type) {
        case 'object': {
            const obj = {};
            if (schema.properties) {
                for (const [key, propSchema] of Object.entries(schema.properties)) {
                    obj[key] = generateMockFromSchema(propSchema, depth + 1);
                }
            }
            return obj;
        }
        case 'array':
            if (schema.items) {
                return [generateMockFromSchema(schema.items, depth + 1)];
            }
            return [];
        case 'string':
            if (schema.enum) return schema.enum[0];
            if (schema.format === 'email') return 'example@email.com';
            if (schema.format === 'date') return '2024-01-01';
            if (schema.format === 'date-time') return '2024-01-01T00:00:00Z';
            if (schema.format === 'uri') return 'https://example.com';
            if (schema.format === 'uuid') return '550e8400-e29b-41d4-a716-446655440000';
            return 'string';
        case 'number':
            return schema.minimum ?? schema.maximum ?? 0;
        case 'integer':
            return schema.minimum ?? schema.maximum ?? 0;
        case 'boolean':
            return true;
        case 'null':
            return null;
        default:
            return null;
    }
}

// ==================== M29 Mock 数据生成器初始化 ====================
// Mock 工具页的首屏状态和示例数据初始化逻辑。
async function initMockTool() {
    // Mock 工具使用按钮触发，无需额外初始化
    // 所有事件处理器已通过 onclick 绑定

    // 初始化 AI 辅助功能
    await initMockAIHelper();
}

// Mock 工具 AI 辅助功能初始化
async function initMockAIHelper() {
    if (typeof checkToolAIEnabled !== 'function') return;

    const aiStatus = await checkToolAIEnabled('tool-mock');
    if (!aiStatus.enabled) return;

    const container = document.getElementById('mock-ai-buttons');
    if (!container) return;

    container.innerHTML = '';

    // AI 生成按钮
    if (aiStatus.features.generate) {
        const generateBtn = document.createElement('button');
        generateBtn.className = 'btn btn-sm ai-helper-btn ai-generate-btn';
        generateBtn.innerHTML = '✨ AI 生成';
        generateBtn.title = '根据描述生成测试数据';
        generateBtn.onclick = () => showMockAIGenerateModal();
        container.appendChild(generateBtn);
    }
}

// 显示 Mock AI 生成弹窗
function showMockAIGenerateModal() {
    if (typeof showAIGenerateModal !== 'function') return;

    showAIGenerateModal('tool-mock', {
        onGenerate: (result) => {
            const output = document.getElementById('mock-output');
            if (output) {
                output.value = result;
            }
        }
    });
}

// ==================== M30 数据脱敏工具初始化 ====================
// 数据脱敏页进入时的默认规则和事件监听绑定。
function initMaskTool() {
    const inputEl = document.getElementById('mask-input');
    if (!inputEl) return;
    inputEl.addEventListener('input', updateMaskTool);
    updateMaskTool();
}

// ==================== M35 二维码生成器 ====================
// 对应 tool-qrcode 页面，负责配置面板、预览区、PNG 导出和颜色/尺寸选项。

// 二维码工具初始化：
// 页面位置：tool-qrcode 页顶部配置区和中部预览区。
// - 准备默认参数、首次渲染和颜色/容错等级等表单联动；
// - 进入二维码页后如果预览区完全不刷新，通常先看这里和 generateQrcode()。
function initQrcodeTool() {
    const inputEl = document.getElementById('qrcode-input');
    if (!inputEl) return;

    // 监听输入更新字节计数
    inputEl.addEventListener('input', () => {
        const text = inputEl.value;
        const bytes = new Blob([text]).size;
        document.getElementById('qrcode-byte-count').textContent = `${bytes} 字节`;
    });
}

// 根据当前表单配置重新生成二维码：
// 页面触发：内容、尺寸、颜色、纠错等级等任一控件变化。
// - 输入文本、颜色、尺寸、纠错等级等变更后都会重新走这里；
// - 成功后会把 canvas/dataUrl 缓存在全局状态里，供下载和复制功能复用。
function generateQrcode() {
    const text = document.getElementById('qrcode-input').value;
    if (!text) {
        showToast('请输入内容', 'warning');
        return;
    }

    const size = parseInt(document.getElementById('qrcode-size').value);
    const errorLevel = document.getElementById('qrcode-error-level').value;
    const darkColor = document.getElementById('qrcode-dark-color').value;
    const lightColor = document.getElementById('qrcode-light-color').value;

    const result = M35Utils.generate(text, {
        size,
        errorCorrectionLevel: errorLevel,
        darkColor,
        lightColor
    });

    if (result.error) {
        showToast(result.error, 'error');
        return;
    }

    qrcodeCanvas = result.canvas;
    qrcodeDataUrl = result.dataUrl;

    // 显示预览
    const preview = document.getElementById('qrcode-preview');
    const frame = preview.querySelector('.qr-code-frame');
    if (!frame) {
        showToast('预览容器初始化失败', 'error');
        return;
    }
    frame.innerHTML = '';
    const img = document.createElement('img');
    img.src = qrcodeDataUrl;
    img.alt = '二维码';
    img.className = 'qr-result-img';
    frame.appendChild(img);

    // 显示操作按钮
    document.getElementById('qrcode-actions').style.display = 'flex';
    showToast('二维码生成成功', 'success');
}

async function downloadQrcode() {
    if (!qrcodeDataUrl) {
        showToast('请先生成二维码', 'warning');
        return;
    }

    // 优先使用后端保存对话框（pywebview 环境下前端下载可能不工作）
    if (window.pywebview && window.pywebview.api && window.pywebview.api.save_binary_file_dialog) {
        try {
            // 提取 base64 数据（去掉 data:image/png;base64, 前缀）
            const base64Data = qrcodeDataUrl.split(',')[1];

            const result = await window.pywebview.api.save_binary_file_dialog(
                base64Data,
                'qrcode.png'
            );

            if (result.success) {
                showToast('已保存到: ' + result.path, 'success');
            } else if (result.error && result.error !== '用户取消了保存') {
                showToast('保存失败: ' + result.error, 'error');
            }
        } catch (e) {
            // 出错时回退到前端下载
            M35Utils.download(qrcodeDataUrl, 'qrcode.png');
            showToast('下载成功', 'success');
        }
        return;
    }

    // 回退到前端下载方式
    M35Utils.download(qrcodeDataUrl, 'qrcode.png');
    showToast('下载成功', 'success');
}

async function copyQrcode() {
    if (!qrcodeCanvas) {
        showToast('请先生成二维码', 'warning');
        return;
    }
    const result = await M35Utils.copyToClipboard(qrcodeCanvas);
    if (result.error) {
        showToast(result.error, 'error');
    } else {
        showToast('已复制到剪贴板', 'success');
    }
}

function clearQrcodeTool() {
    document.getElementById('qrcode-input').value = '';
    document.getElementById('qrcode-byte-count').textContent = '0 字节';
    document.getElementById('qrcode-actions').style.display = 'none';
    qrcodeCanvas = null;
    qrcodeDataUrl = null;

    const preview = document.getElementById('qrcode-preview');
    const frame = preview.querySelector('.qr-code-frame');
    if (!frame) return;
    frame.innerHTML = `
        <div class="qr-preview-placeholder">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                <rect x="3" y="3" width="7" height="7"></rect>
                <rect x="14" y="3" width="7" height="7"></rect>
                <rect x="14" y="14" width="7" height="7"></rect>
                <path d="M3 14h7v7H3z"></path>
            </svg>
            <span>输入内容并点击生成<br>预览将显示在这里</span>
        </div>
    `;
}

// ==================== HTML 实体编解码（M36） ====================
// 对应 tool-html-entity 页面，处理实体编码、解码与结果复制。
let htmlEntityMode = 'encode';

function initHtmlEntityTool() {
    const input = document.getElementById('html-entity-input');
    if (!input) return;
    input.addEventListener('input', updateHtmlEntityTool);
    setHtmlEntityMode('encode');
    renderHtmlEntityRef();
}

function setHtmlEntityMode(mode) {
    if (mode !== 'encode' && mode !== 'decode') return;
    htmlEntityMode = mode;
    document.getElementById('html-entity-encode-btn')?.classList.toggle('active', mode === 'encode');
    document.getElementById('html-entity-decode-btn')?.classList.toggle('active', mode === 'decode');
    // 解码模式下禁用编码选项
    const formatEl = document.getElementById('html-entity-format');
    const encodeAllEl = document.getElementById('html-entity-all');
    const isDecodeMode = mode === 'decode';
    if (formatEl) formatEl.disabled = isDecodeMode;
    if (encodeAllEl) encodeAllEl.disabled = isDecodeMode;
    updateHtmlEntityTool();
}

function updateHtmlEntityTool() {
    const inputEl = document.getElementById('html-entity-input');
    const outputEl = document.getElementById('html-entity-output');
    const errorsEl = document.getElementById('html-entity-errors');
    const formatEl = document.getElementById('html-entity-format');
    const encodeAllEl = document.getElementById('html-entity-all');
    if (!inputEl || !outputEl || !errorsEl) return;

    const inputText = inputEl.value || '';
    errorsEl.innerHTML = '';

    if (!inputText.trim()) {
        outputEl.value = '';
        return;
    }

    try {
        if (!window.DogToolboxM36Utils) {
            throw new Error('工具模块未加载：tools_m36_utils.js');
        }

        if (htmlEntityMode === 'encode') {
            const format = formatEl?.value || 'named';
            const encodeAll = !!encodeAllEl?.checked;
            outputEl.value = window.DogToolboxM36Utils.encodeHtmlEntities(inputText, {
                mode: format,
                encodeAll: encodeAll
            });
        } else {
            outputEl.value = window.DogToolboxM36Utils.decodeHtmlEntities(inputText);
        }
    } catch (e) {
        outputEl.value = '';
        errorsEl.innerHTML = `<div>⚠ ${escapeHtml(e?.message || String(e))}</div>`;
    }
}

function clearHtmlEntityTool() {
    const inputEl = document.getElementById('html-entity-input');
    const outputEl = document.getElementById('html-entity-output');
    const errorsEl = document.getElementById('html-entity-errors');
    if (inputEl) inputEl.value = '';
    if (outputEl) outputEl.value = '';
    if (errorsEl) errorsEl.innerHTML = '';
}

function copyHtmlEntityOutput(btn) {
    const outputEl = document.getElementById('html-entity-output');
    const text = outputEl?.value || '';
    copyToolText(btn, text);
}

function toggleHtmlEntityRef() {
    const refEl = document.getElementById('html-entity-ref');
    if (!refEl) return;
    refEl.style.display = refEl.style.display === 'none' ? '' : 'none';
}

function renderHtmlEntityRef() {
    const gridEl = document.getElementById('html-entity-ref-grid');
    if (!gridEl || !window.DogToolboxM36Utils) return;

    const entities = window.DogToolboxM36Utils.getNamedEntities();
    let html = '<table class="entity-ref-table"><thead><tr><th>字符</th><th>命名</th><th>十进制</th><th>十六进制</th></tr></thead><tbody>';
    for (const e of entities) {
        html += `<tr>
            <td class="entity-char">${escapeHtml(e.char)}</td>
            <td><code>&amp;${e.name};</code></td>
            <td><code>&amp;#${e.decimal};</code></td>
            <td><code>&amp;#x${e.hex};</code></td>
        </tr>`;
    }
    html += '</tbody></table>';
    gridEl.innerHTML = html;
}

// ==================== 图片 Base64 转换（M37） ====================
// 对应 tool-img-base64 页面，围绕图片读取、预览和 Base64 结果输出。

let currentImgFile = null;
let currentImgDataUri = null;

function initImgBase64Tool() {
    // 初始化完成，事件已通过 HTML 绑定
    document.getElementById('copy-base64-btn').disabled = true;
    document.getElementById('download-img-btn').disabled = true;
}

function triggerImgUpload() {
    // 优先使用 pywebview 原生文件对话框（解决 macOS 上 HTML file input 无法选择图片的问题）
    if (window.pywebview?.api?.open_image_file_dialog) {
        window.pywebview.api.open_image_file_dialog().then(result => {
            if (result.success) {
                // 构造 Data URI
                const dataUri = `data:${result.mimetype};base64,${result.data}`;
                // 创建伪 File 对象用于显示信息
                const pseudoFile = {
                    name: result.filename,
                    type: result.mimetype,
                    size: result.size
                };
                processImgFromBackend(pseudoFile, dataUri);
            } else if (result.error && result.error !== '用户取消了选择') {
                showToast('选择文件失败: ' + result.error, 'error');
            }
        }).catch(err => {
            // 回退到 HTML file input
            document.getElementById('img-file-input')?.click();
        });
        return;
    }
    // 回退到 HTML file input
    document.getElementById('img-file-input')?.click();
}

/**
 * 处理从后端获取的图片数据
 */
function processImgFromBackend(fileInfo, dataUri) {
    // 验证 MIME 类型
    if (!window.DogToolboxM37Utils?.isSupportedType(fileInfo.type)) {
        showToast('不支持的图片格式，请选择 PNG/JPG/GIF/WebP/BMP/ICO 文件', 'error');
        return;
    }

    // 限制文件大小
    const MAX_SIZE = 5 * 1024 * 1024;
    if (fileInfo.size > MAX_SIZE) {
        showToast(`图片过大（${window.DogToolboxM37Utils?.formatFileSize(fileInfo.size) || fileInfo.size + ' B'}），最大支持 5MB`, 'error');
        return;
    }

    currentImgFile = fileInfo;
    currentImgDataUri = dataUri;

    // 显示预览
    const previewImg = document.getElementById('img-preview');
    const previewContainer = document.getElementById('img-preview-container');
    const placeholder = document.getElementById('img-upload-placeholder');
    const infoEl = document.getElementById('img-info');

    previewImg.src = dataUri;
    previewImg.onload = function() {
        const info = [];
        info.push(`${this.naturalWidth} × ${this.naturalHeight}`);
        info.push(window.DogToolboxM37Utils?.formatFileSize(fileInfo.size) || `${fileInfo.size} B`);
        info.push(fileInfo.type);
        infoEl.textContent = info.join(' | ');
    };

    placeholder.style.display = 'none';
    previewContainer.style.display = 'flex';

    // 输出 Base64
    updateImgBase64Output();
    document.getElementById('copy-base64-btn').disabled = false;
}

function handleDragOver(e) {
    e.preventDefault();
    e.stopPropagation();
    const target = e.currentTarget;
    if (target) {
        target.classList.add('drag-over');
    }
}

function handleDragLeave(e) {
    e.preventDefault();
    e.stopPropagation();
    const target = e.currentTarget;
    if (target) {
        target.classList.remove('drag-over');
    }
}

function handleImgDrop(e) {
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.classList.remove('drag-over');

    const files = e.dataTransfer?.files;
    if (files && files.length > 0) {
        processImgFile(files[0]);
    }
}

function handleImgSelect(e) {
    const file = e.target?.files?.[0];
    if (file) {
        processImgFile(file);
    }
    // 清空，以便可以再次选择相同文件
    e.target.value = '';
}

// 处理上传或拖入的图片文件：
// 页面位置：tool-img-base64 页的上传区、预览区、输出区之间的桥接入口。
// - 这里是“图片 -> Base64 data URI / 预览 / 元数据”的主入口；
// - 如果图片上传后没有任何输出，优先从这里开始排查文件读取和后续回填链路。
function processImgFile(file) {
    if (!file) return;

    // 使用白名单校验文件类型
    let mimeType = file.type;
    if (!mimeType) {
        // file.type 为空时尝试从文件名推断
        mimeType = window.DogToolboxM37Utils?.getMimeFromFilename(file.name) || '';
    }
    if (!mimeType || !window.DogToolboxM37Utils?.isSupportedType(mimeType)) {
        showToast('不支持的图片格式，请选择 PNG/JPG/GIF/WebP/BMP/ICO 文件', 'error');
        return;
    }

    // 限制文件大小（5MB，Base64 编码后约 6.7MB，textarea 可承受）
    const MAX_SIZE = 5 * 1024 * 1024; // 5MB
    if (file.size > MAX_SIZE) {
        showToast(`图片过大（${window.DogToolboxM37Utils?.formatFileSize(file.size) || file.size + ' B'}），最大支持 5MB`, 'error');
        return;
    }

    currentImgFile = file;

    const reader = new FileReader();
    reader.onload = function(e) {
        currentImgDataUri = e.target.result;

        // 显示预览
        const previewImg = document.getElementById('img-preview');
        const previewContainer = document.getElementById('img-preview-container');
        const placeholder = document.getElementById('img-upload-placeholder');
        const infoEl = document.getElementById('img-info');

        previewImg.src = currentImgDataUri;
        previewImg.onload = function() {
            // 显示图片信息
            const info = [];
            info.push(`${this.naturalWidth} × ${this.naturalHeight}`);
            info.push(window.DogToolboxM37Utils?.formatFileSize(file.size) || `${file.size} B`);
            info.push(file.type);
            infoEl.textContent = info.join(' | ');
        };

        placeholder.style.display = 'none';
        previewContainer.style.display = 'flex';

        // 输出 Base64
        updateImgBase64Output();
        document.getElementById('copy-base64-btn').disabled = false;
    };
    reader.onerror = function() {
        showToast('文件读取失败', 'error');
        currentImgFile = null;
    };
    reader.onabort = function() {
        currentImgFile = null;
    };
    reader.readAsDataURL(file);
}

function updateImgBase64Output() {
    const outputEl = document.getElementById('img-base64-output');
    const copyBtn = document.getElementById('copy-base64-btn');
    const includePrefix = document.getElementById('img-include-prefix')?.checked ?? true;

    if (!currentImgDataUri) {
        outputEl.value = '';
        copyBtn.disabled = true;
        return;
    }

    let outputValue = '';
    if (includePrefix) {
        outputValue = currentImgDataUri;
    } else {
        // 去除 data:image/xxx;base64, 前缀
        const base64 = currentImgDataUri.split(',')[1] || '';
        outputValue = base64;
    }
    outputEl.value = outputValue;
    copyBtn.disabled = !outputValue;
}

function clearImgToBase64() {
    currentImgFile = null;
    currentImgDataUri = null;

    document.getElementById('img-file-input').value = '';
    document.getElementById('img-base64-output').value = '';
    document.getElementById('img-preview-container').style.display = 'none';
    document.getElementById('img-upload-placeholder').style.display = 'flex';
    document.getElementById('img-info').textContent = '';
    document.getElementById('copy-base64-btn').disabled = true;
}

function copyImgBase64(btn) {
    const output = document.getElementById('img-base64-output').value;
    if (!output || btn.disabled) {
        return;
    }
    copyToolText(btn, output);
}

// Base64 → 图片
let base64PreviewDataUri = null;
let _base64PreviewDebounceTimer = null;

function updateBase64Preview() {
    // 防抖处理，避免大量输入时卡顿
    if (_base64PreviewDebounceTimer) {
        clearTimeout(_base64PreviewDebounceTimer);
    }
    _base64PreviewDebounceTimer = setTimeout(_doUpdateBase64Preview, 200);
}

function _doUpdateBase64Preview() {
    const inputEl = document.getElementById('base64-img-input');
    const errorsEl = document.getElementById('base64-img-errors');
    const previewImg = document.getElementById('base64-img-preview');
    const previewContainer = document.getElementById('base64-img-preview-container');
    const placeholder = document.getElementById('base64-preview-placeholder');
    const infoEl = document.getElementById('base64-img-info');
    const downloadBtn = document.getElementById('download-img-btn');
    const previewZone = document.getElementById('base64-preview-zone');

    errorsEl.textContent = '';
    previewZone.classList.remove('preview-error');
    // 去除空白字符（常见换行 Base64）
    const input = (inputEl.value || '').replace(/\s+/g, '');

    if (!input) {
        placeholder.style.display = 'flex';
        previewContainer.style.display = 'none';
        base64PreviewDataUri = null;
        downloadBtn.disabled = true;
        return;
    }

    // 输入长度限制（约 5MB 对应 ~6.7M Base64 字符）
    const MAX_BASE64_LEN = 7 * 1024 * 1024;
    if (input.length > MAX_BASE64_LEN) {
        errorsEl.textContent = '⚠ 输入过大，最大支持约 5MB 图片';
        placeholder.style.display = 'flex';
        previewContainer.style.display = 'none';
        previewZone.classList.add('preview-error');
        base64PreviewDataUri = null;
        downloadBtn.disabled = true;
        return;
    }

    // 判断是否已有 Data URI 前缀
    let dataUri;
    if (input.startsWith('data:image/')) {
        dataUri = input;
    } else {
        // 尝试检测图片类型，默认使用 PNG
        let mimeType = 'image/png';
        if (input.startsWith('/9j/')) {
            mimeType = 'image/jpeg';
        } else if (input.startsWith('R0lG')) {
            mimeType = 'image/gif';
        } else if (input.startsWith('UklGR')) {
            mimeType = 'image/webp';
        } else if (input.startsWith('iVBOR')) {
            mimeType = 'image/png';
        }
        // SVG 默认禁用（安全考虑）
        dataUri = `data:${mimeType};base64,${input}`;
    }

    // 验证 Base64
    const parsed = window.DogToolboxM37Utils?.parseDataUri(dataUri);
    if (!parsed?.isValid) {
        errorsEl.textContent = '⚠ 无效的 Base64 格式';
        placeholder.style.display = 'flex';
        previewContainer.style.display = 'none';
        previewZone.classList.add('preview-error');
        base64PreviewDataUri = null;
        downloadBtn.disabled = true;
        return;
    }

    // 尝试加载图片
    previewImg.onload = function() {
        const info = [];
        info.push(`${this.naturalWidth} × ${this.naturalHeight}`);
        const size = window.DogToolboxM37Utils?.getOriginalSizeFromBase64(parsed.base64) || 0;
        info.push(window.DogToolboxM37Utils?.formatFileSize(size) || `${size} B`);
        info.push(parsed.mimeType);
        infoEl.textContent = info.join(' | ');

        placeholder.style.display = 'none';
        previewContainer.style.display = 'flex';
        base64PreviewDataUri = dataUri;
        downloadBtn.disabled = false;
        previewZone.classList.remove('preview-error');
    };

    previewImg.onerror = function() {
        errorsEl.textContent = '⚠ 无法解析为有效图片';
        placeholder.style.display = 'flex';
        previewContainer.style.display = 'none';
        previewZone.classList.add('preview-error');
        base64PreviewDataUri = null;
        downloadBtn.disabled = true;
    };

    previewImg.src = dataUri;
}

function clearBase64ToImg() {
    document.getElementById('base64-img-input').value = '';
    document.getElementById('base64-img-errors').innerHTML = '';
    document.getElementById('base64-img-preview-container').style.display = 'none';
    document.getElementById('base64-preview-placeholder').style.display = 'flex';
    document.getElementById('base64-img-info').textContent = '';
    document.getElementById('base64-preview-zone').classList.remove('preview-error');
    document.getElementById('download-img-btn').disabled = true;
    base64PreviewDataUri = null;
}

async function downloadBase64Img() {
    const downloadBtn = document.getElementById('download-img-btn');
    if (!base64PreviewDataUri || downloadBtn?.disabled) {
        return;
    }

    const parsed = window.DogToolboxM37Utils?.parseDataUri(base64PreviewDataUri);
    if (!parsed?.isValid) {
        showToast('无效的图片数据', 'error');
        return;
    }

    const ext = window.DogToolboxM37Utils?.getExtensionFromMime(parsed?.mimeType) || 'png';
    const filename = `image.${ext}`;

    // 优先使用后端保存
    if (window.pywebview?.api?.save_binary_file_dialog) {
        try {
            const result = await window.pywebview.api.save_binary_file_dialog(
                parsed.base64,
                filename
            );
            if (result.success) {
                showToast('已保存到: ' + result.path, 'success');
            } else if (result.error && result.error !== '用户取消了保存') {
                showToast('保存失败: ' + result.error, 'error');
            }
        } catch (e) {
            window.DogToolboxM37Utils?.downloadDataUri(base64PreviewDataUri, filename);
            showToast('下载成功', 'success');
        }
        return;
    }

    // 前端下载
    window.DogToolboxM37Utils?.downloadDataUri(base64PreviewDataUri, filename);
    showToast('下载成功', 'success');
}

// ==================== 文本排序/去重（M38） ====================
// 对应 tool-text-sort 页面，负责排序模式、去重和结果输出。

let _textSortDebounceTimer = null;

function initTextSortTool() {
    const uniqueCheckbox = document.getElementById('text-sort-unique');
    if (uniqueCheckbox) {
        // Setup the event listener to toggle the section and then update the tool
        uniqueCheckbox.addEventListener('change', () => {
            toggleCollapsibleSection('text-sort-unique', 'text-sort-unique-options');
            updateTextSortTool(); // Manually trigger update after toggling
        });
    }

    // Initial UI setup on load
    toggleCollapsibleSection('text-sort-unique', 'text-sort-unique-options');
    updateTextSortTool();
}

/**
 * Reusable utility to toggle a collapsible section based on a checkbox control.
 * @param {string} checkboxId The ID of the checkbox that controls the section.
 * @param {string} sectionId The ID of the section to show/hide.
 */
function toggleCollapsibleSection(checkboxId, sectionId) {
    const checkbox = document.getElementById(checkboxId);
    const section = document.getElementById(sectionId);
    if (!checkbox || !section) return;

    const isChecked = checkbox.checked;
    section.classList.toggle('hidden', !isChecked);
    checkbox.setAttribute('aria-expanded', isChecked);
}

/**
 * 触发文本排序工具的防抖更新。
 *
 * 页面位置：tool-text-sort 页里所有排序/去重相关控件的公共入口。
 * 所有输入框、下拉框、勾选项变化后，最终都会先经过这里，再延迟调用 _doUpdateTextSort()。
 */
function updateTextSortTool() {
    if (_textSortDebounceTimer) {
        clearTimeout(_textSortDebounceTimer);
    }
    _textSortDebounceTimer = setTimeout(_doUpdateTextSort, 150);
}

// 文本排序/去重真正执行函数：
// 页面位置：tool-text-sort 页的输入区、输出区和统计栏之间的主计算入口。
// - updateTextSortTool() 只负责防抖，真正的业务处理在这里；
// - 会读取所有 UI 开关，再调用 M38 工具模块返回结果和统计信息。
function _doUpdateTextSort() {
    const inputEl = document.getElementById('text-sort-input');
    const outputEl = document.getElementById('text-sort-output');
    const statsEl = document.getElementById('text-sort-stats');

    const input = inputEl?.value || '';

    // Check if the required utility module is loaded
    if (!window.DogToolboxM38Utils) {
        outputEl.value = '';
        statsEl.textContent = '错误：工具核心模块 (M38) 未加载。';
        return;
    }

    // Gather all options from the UI
    const options = {
        sort: document.getElementById('text-sort-mode')?.value || 'none',
        reverse: document.getElementById('text-sort-reverse')?.checked || false,
        trimLines: document.getElementById('text-sort-trim')?.checked || false,
        removeEmpty: document.getElementById('text-sort-remove-empty')?.checked || false,
        unique: document.getElementById('text-sort-unique')?.checked || false,
        keepFirst: document.querySelector('input[name="text-sort-keep"]:checked')?.value === 'first',
        caseSensitive: document.getElementById('text-sort-case-sensitive')?.checked ?? true
    };
    
    try {
        // Process the input text
        const result = window.DogToolboxM38Utils.processLines(input, options);
        let outputLines = result.lines;

        // Add line numbers if requested (after all other processing)
        if (document.getElementById('text-sort-add-line-num')?.checked) {
            outputLines = outputLines.map((line, index) => `${index + 1}. ${line}`);
        }

        const outputText = outputLines.join('\n');
        outputEl.value = outputText;

        // Update statistics display
        const { originalCount, finalCount, emptyRemoved, duplicateRemoved } = result.stats;
        let statsParts = [`原 ${originalCount} 行`, `结果 ${finalCount} 行`];
        if (duplicateRemoved > 0) {
            statsParts.push(`去重 ${duplicateRemoved} 行`);
        }
        if (emptyRemoved > 0) {
            statsParts.push(`去空 ${emptyRemoved} 行`);
        }
        statsEl.textContent = statsParts.join(' | ');

    } catch (e) {
        outputEl.value = '';
        statsEl.textContent = `处理出错：${e.message || String(e)}`;
    }
}

/**
 * 清空文本排序工具的输入、输出和统计状态。
 *
 * 页面触发：tool-text-sort 页里的“清空”按钮。
 * 除了清空文本，还会把排序模式、去重策略、大小写敏感等开关恢复到默认值。
 */
function clearTextSortTool() {
    const inputEl = document.getElementById('text-sort-input');
    const outputEl = document.getElementById('text-sort-output');
    const statsEl = document.getElementById('text-sort-stats');

    if (inputEl) inputEl.value = '';
    if (outputEl) outputEl.value = '';
    if (statsEl) statsEl.textContent = '';
    
    // Also reset all options to their default state
    document.getElementById('text-sort-mode').value = 'none';
    document.getElementById('text-sort-reverse').checked = false;
    document.getElementById('text-sort-trim').checked = false;
    document.getElementById('text-sort-remove-empty').checked = false;
    document.getElementById('text-sort-unique').checked = false;
    document.querySelector('input[name="text-sort-keep"][value="first"]').checked = true;
    document.getElementById('text-sort-case-sensitive').checked = true;
    document.getElementById('text-sort-add-line-num').checked = false;
    
    // Trigger a UI update to hide the unique options panel
    toggleCollapsibleSection('text-sort-unique', 'text-sort-unique-options');
}

/**
 * 复制文本排序工具的输出内容。
 *
 * 页面触发：tool-text-sort 页里的“复制结果”按钮。
 */
function copyTextSortOutput(btn) {
    const output = document.getElementById('text-sort-output').value;
    copyToolText(btn, output);
}

// ==================== TOML 格式化（M39） ====================
// 对应 tool-toml 页面，处理格式化、压缩和解析错误提示。

let _tomlDebounceTimer = null;

// TOML 工具初始化：
// 页面位置：tool-toml 页输入区和输出区的首屏准备。
// - 主要负责根据当前输入类型刷新占位提示，并触发一次首屏转换；
// - 这个工具的真正计算逻辑在 _doUpdateToml() 中。
function initTomlTool() {
    updateTomlInputPlaceholder();
}

function updateTomlInputPlaceholder() {
    const inputEl = document.getElementById('toml-input');
    const inputType = document.getElementById('toml-input-type')?.value || 'toml';
    if (inputEl) {
        inputEl.placeholder = inputType === 'toml' ? '输入 TOML 内容...' : '输入 JSON 内容...';
    }
    updateTomlTool();
}

function updateTomlTool() {
    if (_tomlDebounceTimer) clearTimeout(_tomlDebounceTimer);
    _tomlDebounceTimer = setTimeout(_doUpdateToml, 150);
}

// TOML / JSON 双向转换执行函数：
// 页面触发：输入文本变化、输入类型切换、输出类型切换。
// - 先按输入类型解析；
// - 再按输出类型重新序列化；
// - 结果统一写到输出框和状态提示区。
function _doUpdateToml() {
    const inputEl = document.getElementById('toml-input');
    const outputEl = document.getElementById('toml-output');
    const statusEl = document.getElementById('toml-status');
    const inputType = document.getElementById('toml-input-type')?.value || 'toml';
    const outputType = document.getElementById('toml-output-type')?.value || 'toml';

    const input = inputEl?.value || '';

    if (!input.trim()) {
        outputEl.value = '';
        statusEl.textContent = '';
        return;
    }

    if (!window.DogToolboxM39Utils) {
        outputEl.value = '';
        statusEl.textContent = '错误：工具核心模块 (M39) 未加载';
        return;
    }

    try {
        let obj;
        if (inputType === 'toml') {
            obj = window.DogToolboxM39Utils.parse(input);
        } else {
            obj = JSON.parse(input);
        }

        let result;
        if (outputType === 'toml') {
            result = window.DogToolboxM39Utils.stringify(obj);
        } else if (outputType === 'json') {
            result = JSON.stringify(obj, null, 2);
        } else {
            result = JSON.stringify(obj);
        }

        outputEl.value = result;
        statusEl.textContent = '✓ 解析成功';
        statusEl.style.color = 'var(--success)';
    } catch (e) {
        outputEl.value = '';
        statusEl.textContent = '✗ ' + (e.message || String(e));
        statusEl.style.color = 'var(--error)';
    }
}

function clearTomlInput() {
    const inputEl = document.getElementById('toml-input');
    const outputEl = document.getElementById('toml-output');
    const statusEl = document.getElementById('toml-status');
    if (inputEl) inputEl.value = '';
    if (outputEl) outputEl.value = '';
    if (statusEl) statusEl.textContent = '';
}

function loadTomlSample() {
    const inputType = document.getElementById('toml-input-type')?.value || 'toml';
    const inputEl = document.getElementById('toml-input');
    if (!inputEl) return;

    if (inputType === 'toml') {
        inputEl.value = `# TOML 示例配置文件
title = "狗狗百宝箱配置"

[owner]
name = "Dog Toolbox"
dob = 2024-01-15

[database]
enabled = true
ports = [8000, 8001, 8002]
connection_max = 5000
server = "192.168.1.1"

[servers]

[servers.alpha]
ip = "10.0.0.1"
role = "frontend"

[servers.beta]
ip = "10.0.0.2"
role = "backend"

[[products]]
name = "Hammer"
sku = 738594937

[[products]]
name = "Nail"
sku = 284758393
color = "gray"`;
    } else {
        inputEl.value = JSON.stringify({
            title: "狗狗百宝箱配置",
            owner: { name: "Dog Toolbox", dob: "2024-01-15" },
            database: {
                enabled: true,
                ports: [8000, 8001, 8002],
                connection_max: 5000,
                server: "192.168.1.1"
            },
            servers: {
                alpha: { ip: "10.0.0.1", role: "frontend" },
                beta: { ip: "10.0.0.2", role: "backend" }
            },
            products: [
                { name: "Hammer", sku: 738594937 },
                { name: "Nail", sku: 284758393, color: "gray" }
            ]
        }, null, 2);
    }
    updateTomlTool();
}

function copyTomlOutput(btn) {
    const output = document.getElementById('toml-output')?.value || '';
    if (!output) {
        showToast('无内容可复制', 'warning');
        return;
    }
    copyToolText(btn, output);
}

// ==================== User-Agent 解析（M40） ====================
// 对应 tool-ua 页面，输入 UA 后会在这里分析浏览器、系统和设备信息。

let _uaDebounceTimer = null;

// UA 工具初始化：
// 页面位置：tool-ua 页的输入区、示例按钮区和结果面板。
// - 首次进入页面时渲染示例按钮；
// - 之后真正的解析动作由 useCurrentUA()/loadUASample()/updateUATool() 驱动。
function initUATool() {
    // 渲染示例按钮
    const samplesEl = document.getElementById('ua-samples');
    if (samplesEl && window.DogToolboxM40Utils) {
        const samples = window.DogToolboxM40Utils.getSamples();
        samplesEl.innerHTML = samples.map((s, i) =>
            `<button type="button" class="btn btn-xs btn-ghost" onclick="loadUASample(${i})">${s.name}</button>`
        ).join('');
    }
}

function useCurrentUA() {
    const inputEl = document.getElementById('ua-input');
    if (inputEl) {
        inputEl.value = navigator.userAgent;
        updateUATool();
    }
}

function loadUASample(index) {
    if (!window.DogToolboxM40Utils) return;
    const samples = window.DogToolboxM40Utils.getSamples();
    const sample = samples[index];
    if (!sample) return;
    const inputEl = document.getElementById('ua-input');
    if (inputEl) {
        inputEl.value = sample.ua;
        updateUATool();
    }
}

function updateUATool() {
    if (_uaDebounceTimer) clearTimeout(_uaDebounceTimer);
    _uaDebounceTimer = setTimeout(_doUpdateUA, 100);
}

// User-Agent 解析执行函数：
// 页面触发：输入 UA、使用当前 UA、点击示例按钮。
// - 负责把原始 UA 字符串转换成浏览器、系统、设备、机器人等结构化结果；
// - 并同步更新页面上的图标区、摘要区和 JSON 输出区。
function _doUpdateUA() {
    const inputEl = document.getElementById('ua-input');
    const resultEl = document.getElementById('ua-result');
    const jsonOutputEl = document.getElementById('ua-json-output');

    const ua = inputEl?.value || '';

    if (!ua.trim()) {
        resultEl.style.display = 'none';
        jsonOutputEl.value = '';
        return;
    }

    if (!window.DogToolboxM40Utils) {
        jsonOutputEl.value = '错误：工具核心模块 (M40) 未加载';
        return;
    }

    const result = window.DogToolboxM40Utils.parse(ua);
    resultEl.style.display = 'block';

    // 更新浏览器
    const browserEl = document.getElementById('ua-browser');
    if (result.browser) {
        browserEl.textContent = `${result.browser.name}${result.browser.version ? ' ' + result.browser.version : ''}`;
    } else {
        browserEl.textContent = '未识别';
    }

    // 更新操作系统
    const osEl = document.getElementById('ua-os');
    if (result.os) {
        osEl.textContent = `${result.os.name}${result.os.version ? ' ' + result.os.version : ''}`;
    } else {
        osEl.textContent = '未识别';
    }

    // 更新设备类型
    const deviceEl = document.getElementById('ua-device');
    const deviceIconEl = document.getElementById('ua-device-icon');
    const deviceNames = { mobile: '移动设备', tablet: '平板设备', desktop: '桌面设备', unknown: '未知' };
    const deviceIcons = { mobile: '📱', tablet: '📲', desktop: '🖥️', unknown: '❓' };
    const deviceType = result.device?.type || 'unknown';
    deviceEl.textContent = deviceNames[deviceType] || deviceType;
    deviceIconEl.textContent = deviceIcons[deviceType] || '❓';

    // 更新渲染引擎
    const engineEl = document.getElementById('ua-engine');
    engineEl.textContent = result.engine?.name || '未识别';

    // 更新机器人检测
    const botEl = document.getElementById('ua-result-bot');
    const botNameEl = document.getElementById('ua-bot-name');
    if (result.isBot && result.bot) {
        botEl.style.display = 'flex';
        botNameEl.textContent = result.bot.name;
    } else {
        botEl.style.display = 'none';
    }

    // JSON 输出
    jsonOutputEl.value = JSON.stringify(result, null, 2);
}

function clearUATool() {
    document.getElementById('ua-input').value = '';
    document.getElementById('ua-result').style.display = 'none';
    document.getElementById('ua-json-output').value = '';
}

function copyUAOutput(btn) {
    const output = document.getElementById('ua-json-output')?.value || '';
    if (!output) {
        showToast('无内容可复制', 'warning');
        return;
    }
    copyToolText(btn, output);
}

// ==================== JSON Path 查询（M41） ====================
// 对应 tool-jsonpath 页面，维护 JSON 输入、表达式执行和查询结果。

let _jsonpathDebounceTimer = null;

// JSONPath 工具初始化：
// 页面位置：tool-jsonpath 页的 JSON 输入区、表达式输入区和示例按钮区。
// - 负责渲染常见表达式示例按钮；
// - 后续输入 JSON、表达式、加载示例都会汇聚到 _doUpdateJsonPath() 做真正查询。
function initJsonPathTool() {
    // 渲染示例表达式
    const examplesEl = document.getElementById('jsonpath-examples');
    if (examplesEl && window.DogToolboxM41Utils) {
        const examples = window.DogToolboxM41Utils.getExamples();
        examplesEl.innerHTML = examples.map((ex, i) =>
            `<button type="button" class="btn btn-xs btn-ghost" onclick="loadJsonPathExample(${i})" title="${ex.desc}">${ex.path}</button>`
        ).join('');
    }
}

function loadJsonPathSample() {
    if (!window.DogToolboxM41Utils) return;
    const inputEl = document.getElementById('jsonpath-input');
    if (inputEl) {
        inputEl.value = JSON.stringify(window.DogToolboxM41Utils.getSampleData(), null, 2);
        updateJsonPathTool();
    }
}

function loadJsonPathExample(index) {
    if (!window.DogToolboxM41Utils) return;
    const examples = window.DogToolboxM41Utils.getExamples();
    const example = examples[index];
    if (!example) return;
    const exprEl = document.getElementById('jsonpath-expr');
    if (exprEl) {
        exprEl.value = example.path;
        updateJsonPathTool();
    }
}

function updateJsonPathTool() {
    if (_jsonpathDebounceTimer) clearTimeout(_jsonpathDebounceTimer);
    _jsonpathDebounceTimer = setTimeout(_doUpdateJsonPath, 150);
}

// JSONPath 查询执行函数：
// 页面触发：JSON 文本变化、表达式变化、加载示例。
// - 先校验输入 JSON；
// - 再调用 M41 工具模块做表达式匹配；
// - 最后同时刷新匹配数量、路径列表和输出结果区。
function _doUpdateJsonPath() {
    const inputEl = document.getElementById('jsonpath-input');
    const exprEl = document.getElementById('jsonpath-expr');
    const outputEl = document.getElementById('jsonpath-output');
    const statusEl = document.getElementById('jsonpath-status');
    const pathsEl = document.getElementById('jsonpath-paths');
    const pathsGroupEl = document.getElementById('jsonpath-paths-group');

    const jsonStr = inputEl?.value || '';
    const expr = exprEl?.value || '$';

    if (!jsonStr.trim()) {
        outputEl.value = '';
        statusEl.textContent = '';
        pathsGroupEl.style.display = 'none';
        return;
    }

    if (!window.DogToolboxM41Utils) {
        statusEl.textContent = '错误：工具核心模块 (M41) 未加载';
        statusEl.style.color = 'var(--error)';
        return;
    }

    // 解析 JSON
    let data;
    try {
        data = JSON.parse(jsonStr);
    } catch (e) {
        outputEl.value = '';
        statusEl.textContent = '✗ JSON 解析错误: ' + (e.message || String(e));
        statusEl.style.color = 'var(--error)';
        pathsGroupEl.style.display = 'none';
        return;
    }

    // 执行查询
    const result = window.DogToolboxM41Utils.query(data, expr);

    if (result.error) {
        outputEl.value = '';
        statusEl.textContent = '✗ ' + result.error;
        statusEl.style.color = 'var(--error)';
        pathsGroupEl.style.display = 'none';
        return;
    }

    // 显示结果
    statusEl.textContent = `✓ 找到 ${result.results.length} 个匹配`;
    statusEl.style.color = 'var(--success)';

    // 显示匹配路径
    if (result.paths.length > 0) {
        pathsGroupEl.style.display = 'block';
        pathsEl.innerHTML = result.paths.map(p =>
            `<code class="jsonpath-path">${escapeHtml(p)}</code>`
        ).join('');
    } else {
        pathsGroupEl.style.display = 'none';
    }

    // 格式化结果
    if (result.results.length === 1) {
        outputEl.value = JSON.stringify(result.results[0], null, 2);
    } else {
        outputEl.value = JSON.stringify(result.results, null, 2);
    }
}

function clearJsonPathInput() {
    document.getElementById('jsonpath-input').value = '';
    document.getElementById('jsonpath-expr').value = '$';
    document.getElementById('jsonpath-output').value = '';
    document.getElementById('jsonpath-status').textContent = '';
    document.getElementById('jsonpath-paths-group').style.display = 'none';
}

function copyJsonPathOutput(btn) {
    const output = document.getElementById('jsonpath-output')?.value || '';
    if (!output) {
        showToast('无内容可复制', 'warning');
        return;
    }
    copyToolText(btn, output);
}

// ==================== nginx 配置生成（M42） ====================
// 对应 tool-nginx 页面，围绕配置模板参数生成 nginx 片段。

const NGINX_TEMPLATE_OPTIONS = {
    reverseProxy: [
        { id: 'proxyPass', label: '后端地址 (proxy_pass)', type: 'text', placeholder: 'http://127.0.0.1:8080' },
        { id: 'proxyTimeout', label: '超时时间 (秒)', type: 'number', placeholder: '60' },
        { id: 'websocket', label: '启用 WebSocket 支持', type: 'checkbox' }
    ],
    staticSite: [
        { id: 'rootPath', label: '根目录 (root)', type: 'text', placeholder: '/var/www/html' },
        { id: 'indexFile', label: '默认文件 (index)', type: 'text', placeholder: 'index.html' },
        { id: 'gzip', label: '启用 Gzip 压缩', type: 'checkbox', default: true },
        { id: 'cacheControl', label: '启用静态资源缓存', type: 'checkbox', default: true }
    ],
    spa: [
        { id: 'rootPath', label: '根目录 (root)', type: 'text', placeholder: '/var/www/html' }
    ],
    ssl: [
        { id: 'sslCert', label: 'SSL 证书路径', type: 'text', placeholder: '/etc/nginx/ssl/cert.pem' },
        { id: 'sslKey', label: 'SSL 密钥路径', type: 'text', placeholder: '/etc/nginx/ssl/key.pem' },
        { id: 'rootPath', label: '根目录 (root)', type: 'text', placeholder: '/var/www/html' },
        { id: 'hsts', label: '启用 HSTS', type: 'checkbox', default: true }
    ],
    loadBalance: [
        { id: 'upstreamName', label: 'upstream 名称', type: 'text', placeholder: 'backend' },
        { id: 'servers', label: '后端服务器 (逗号分隔)', type: 'text', placeholder: '127.0.0.1:8001,127.0.0.1:8002' },
        { id: 'algorithm', label: '负载均衡算法', type: 'select', options: [
            { value: 'round_robin', label: '轮询 (默认)' },
            { value: 'ip_hash', label: 'IP Hash' },
            { value: 'least_conn', label: '最少连接' }
        ]}
    ],
    rateLimit: [
        { id: 'zoneName', label: '限流区域名', type: 'text', placeholder: 'api_limit' },
        { id: 'rateLimit', label: '请求频率 (r/s)', type: 'number', placeholder: '10' },
        { id: 'burstLimit', label: '突发限制', type: 'number', placeholder: '20' }
    ],
    cors: [
        { id: 'allowOrigin', label: 'Allow-Origin', type: 'text', placeholder: '*' },
        { id: 'allowMethods', label: 'Allow-Methods', type: 'text', placeholder: 'GET, POST, PUT, DELETE, OPTIONS' }
    ],
    fileUpload: [
        { id: 'maxBodySize', label: '最大上传大小 (MB)', type: 'number', placeholder: '100' },
        { id: 'uploadPath', label: '上传路径', type: 'text', placeholder: '/upload' }
    ]
};

// nginx 工具初始化：
// 页面位置：tool-nginx 页模板选择区和动态参数区。
// - 首次进入页面时，根据当前模板类型生成动态参数表单；
// - 模板切换后真正的配置拼装在 updateNginxConfig()。
function initNginxTool() {
    updateNginxTemplate();
}

function updateNginxTemplate() {
    const template = document.getElementById('nginx-template')?.value || 'reverseProxy';
    const dynamicEl = document.getElementById('nginx-dynamic-options');
    const options = NGINX_TEMPLATE_OPTIONS[template] || [];

    dynamicEl.innerHTML = options.map(opt => {
        if (opt.type === 'checkbox') {
            return `<label class="tool-check">
                <input type="checkbox" id="nginx-${opt.id}" ${opt.default ? 'checked' : ''} onchange="updateNginxConfig()">
                ${opt.label}
            </label>`;
        } else if (opt.type === 'select') {
            const optionsHtml = opt.options.map(o =>
                `<option value="${o.value}">${o.label}</option>`
            ).join('');
            return `<div class="form-group">
                <label for="nginx-${opt.id}">${opt.label}</label>
                <select id="nginx-${opt.id}" onchange="updateNginxConfig()">${optionsHtml}</select>
            </div>`;
        } else {
            return `<div class="form-group">
                <label for="nginx-${opt.id}">${opt.label}</label>
                <input type="${opt.type}" id="nginx-${opt.id}" placeholder="${opt.placeholder || ''}" oninput="updateNginxConfig()">
            </div>`;
        }
    }).join('');

    updateNginxConfig();
}

// nginx 配置生成主入口：
// 页面触发：模板切换、动态字段修改、通用字段输入。
// - 收集通用字段和当前模板的动态字段；
// - 交给 M42 模块生成配置片段并顺带做一次校验；
// - 页面上的状态条与输出框都由这里统一刷新。
function updateNginxConfig() {
    const template = document.getElementById('nginx-template')?.value || 'reverseProxy';
    const outputEl = document.getElementById('nginx-output');
    const statusEl = document.getElementById('nginx-status');

    if (!window.DogToolboxM42Utils) {
        outputEl.value = '';
        statusEl.textContent = '错误：工具核心模块 (M42) 未加载';
        statusEl.style.color = 'var(--error)';
        return;
    }

    // 收集选项
    const opts = {
        serverName: document.getElementById('nginx-server-name')?.value || '',
        listenPort: document.getElementById('nginx-listen-port')?.value || ''
    };

    const templateOptions = NGINX_TEMPLATE_OPTIONS[template] || [];
    templateOptions.forEach(opt => {
        const el = document.getElementById(`nginx-${opt.id}`);
        if (!el) return;
        if (opt.type === 'checkbox') {
            opts[opt.id] = el.checked;
        } else {
            opts[opt.id] = el.value;
        }
    });

    // 生成配置
    const result = window.DogToolboxM42Utils.generate(template, opts);

    if (result.error) {
        outputEl.value = '';
        statusEl.textContent = '✗ ' + result.error;
        statusEl.style.color = 'var(--error)';
        return;
    }

    outputEl.value = result.config;

    // 验证
    const validation = window.DogToolboxM42Utils.validate(result.config);
    if (validation.valid) {
        statusEl.textContent = '✓ 配置生成成功';
        statusEl.style.color = 'var(--success)';
    } else {
        statusEl.textContent = '⚠ ' + validation.errors.join('; ');
        statusEl.style.color = 'var(--warning)';
    }
}

function copyNginxConfig(btn) {
    const output = document.getElementById('nginx-output')?.value || '';
    if (!output) {
        showToast('无内容可复制', 'warning');
        return;
    }
    copyToolText(btn, output);
}
