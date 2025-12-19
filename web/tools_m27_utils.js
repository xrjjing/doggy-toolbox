/**
 * M27: Docker 命令生成器工具
 * 提供常用 Docker 命令的生成函数
 */
(function (root, factory) {
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = factory();
    } else {
        root.DogToolboxM27Utils = factory();
    }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    // ==================== 辅助函数 ====================

    /**
     * 转义命令行参数（包含空格、特殊字符时需要引号）
     * @param {string} value - 参数值
     * @returns {string} 转义后的参数
     */
    function escapeArg(value) {
        if (!value) return '';
        const str = String(value);
        // 包含空格、引号等特殊字符时，用双引号包裹，内部双引号转义
        if (/[\s"'$`\\]/.test(str)) {
            return '"' + str.replace(/"/g, '\\"') + '"';
        }
        return str;
    }

    /**
     * 构建选项参数（如 -p, -v, -e 等）
     * @param {string} flag - 选项标志
     * @param {string|Array} value - 选项值（可以是单个值或数组）
     * @returns {string} 构建的选项字符串
     */
    function buildOption(flag, value) {
        if (!value) return '';

        if (Array.isArray(value)) {
            return value.map(v => `${flag} ${escapeArg(v)}`).join(' ');
        }

        return `${flag} ${escapeArg(value)}`;
    }

    /**
     * 标准化选项对象
     * @param {object} options - 选项对象
     * @returns {object} 标准化后的选项对象
     */
    function normalizeOptions(options) {
        return options || {};
    }

    /**
     * 包装命令结果
     * @param {string} command - 命令字符串
     * @param {string} description - 说明
     * @returns {{command: string, description: string}}
     */
    function buildResult(command, description) {
        return {
            command,
            description: description || ''
        };
    }

    // ==================== docker run ====================

    /**
     * 生成 docker run 命令
     * @param {string} image - 镜像名称
     * @param {object} options - 选项
     * @param {boolean} options.detach - 后台运行（-d）
     * @param {boolean} options.interactive - 交互模式（-it）
     * @param {boolean} options.rm - 容器退出时自动删除（--rm）
     * @param {string} options.name - 容器名称（--name）
     * @param {string|Array<string>} options.ports - 端口映射（-p），如 "8080:80" 或 ["8080:80", "443:443"]
     * @param {string|Array<string>} options.volumes - 卷挂载（-v），如 "/host:/container" 或数组
     * @param {string|Array<string>} options.env - 环境变量（-e），如 "KEY=value" 或数组
     * @param {string} options.network - 网络（--network）
     * @param {string} options.restart - 重启策略（--restart），如 "always", "unless-stopped"
     * @param {string} options.user - 用户（-u）
     * @param {string} options.workdir - 工作目录（-w）
     * @param {string} options.hostname - 主机名（-h）
     * @param {string|Array<string>} options.link - 链接到其他容器（--link）
     * @param {string} options.memory - 内存限制（--memory），如 "512m", "2g"
     * @param {string} options.cpus - CPU 限制（--cpus），如 "1.5"
     * @param {boolean} options.privileged - 特权模式（--privileged）
     * @param {string} options.command - 容器启动命令（可选）
     * @returns {{command: string, description: string}} 生成的 docker run 命令对象
     */
    function generateRunCommand(image, options = {}) {
        if (!image || typeof image !== 'string') {
            throw new Error('镜像名称不能为空');
        }

        const opts = normalizeOptions(options);
        const parts = ['docker run'];

        // 基础选项
        if (opts.detach) parts.push('-d');
        if (opts.interactive) parts.push('-it');
        if (opts.rm) parts.push('--rm');
        if (opts.privileged) parts.push('--privileged');

        // 命名选项
        if (opts.name) parts.push(`--name ${escapeArg(opts.name)}`);
        if (opts.hostname) parts.push(`-h ${escapeArg(opts.hostname)}`);
        if (opts.user) parts.push(`-u ${escapeArg(opts.user)}`);
        if (opts.workdir) parts.push(`-w ${escapeArg(opts.workdir)}`);
        if (opts.network) parts.push(`--network ${escapeArg(opts.network)}`);
        if (opts.restart) parts.push(`--restart ${escapeArg(opts.restart)}`);

        // 资源限制
        if (opts.memory) parts.push(`--memory ${escapeArg(opts.memory)}`);
        if (opts.cpus) parts.push(`--cpus ${escapeArg(opts.cpus)}`);

        // 多值选项
        if (opts.ports) {
            const portParts = buildOption('-p', opts.ports);
            if (portParts) parts.push(portParts);
        }
        if (opts.volumes) {
            const volumeParts = buildOption('-v', opts.volumes);
            if (volumeParts) parts.push(volumeParts);
        }
        if (opts.env) {
            const envParts = buildOption('-e', opts.env);
            if (envParts) parts.push(envParts);
        }
        if (opts.link) {
            const linkParts = buildOption('--link', opts.link);
            if (linkParts) parts.push(linkParts);
        }

        // 镜像名称
        parts.push(escapeArg(image));

        // 容器启动命令（可选）
        if (opts.command) {
            parts.push(escapeArg(opts.command));
        }

        return buildResult(parts.join(' '), '运行容器');
    }

    // ==================== docker build ====================

    /**
     * 生成 docker build 命令
     * @param {string} path - 构建路径（Dockerfile 所在目录）
     * @param {object} options - 选项
     * @param {string} options.tag - 镜像标签（-t），如 "myapp:latest"
     * @param {string} options.file - Dockerfile 文件名（-f），默认为 Dockerfile
     * @param {string|Array<string>} options.buildArg - 构建参数（--build-arg），如 "VERSION=1.0" 或数组
     * @param {boolean} options.noCache - 禁用缓存（--no-cache）
     * @param {boolean} options.pull - 始终拉取基础镜像（--pull）
     * @param {boolean} options.rm - 构建后删除中间容器（--rm），默认为 true
     * @param {string} options.target - 多阶段构建目标（--target）
     * @param {string} options.platform - 目标平台（--platform），如 "linux/amd64"
     * @returns {{command: string, description: string}} 生成的 docker build 命令对象
     */
    function generateBuildCommand(path, options = {}) {
        if (!path || typeof path !== 'string') {
            throw new Error('构建路径不能为空');
        }

        const opts = normalizeOptions(options);
        const parts = ['docker build'];

        // 标签
        if (opts.tag) parts.push(`-t ${escapeArg(opts.tag)}`);

        // Dockerfile 位置
        if (opts.file) parts.push(`-f ${escapeArg(opts.file)}`);

        // 构建选项
        if (opts.noCache) parts.push('--no-cache');
        if (opts.pull) parts.push('--pull');
        if (opts.rm !== false) parts.push('--rm'); // 默认启用
        if (opts.target) parts.push(`--target ${escapeArg(opts.target)}`);
        if (opts.platform) parts.push(`--platform ${escapeArg(opts.platform)}`);

        // 构建参数
        if (opts.buildArg) {
            const buildArgParts = buildOption('--build-arg', opts.buildArg);
            if (buildArgParts) parts.push(buildArgParts);
        }

        // 构建路径
        parts.push(escapeArg(path));

        return buildResult(parts.join(' '), '构建镜像');
    }

    // ==================== docker-compose ====================

    /**
     * 生成 docker-compose 命令
     * @param {string} action - 操作：up, down, start, stop, restart, ps, logs, build, pull
     * @param {object} options - 选项
     * @param {string} options.file - compose 文件路径（-f）
     * @param {string} options.projectName - 项目名称（-p）
     * @param {boolean} options.detach - 后台运行（-d），适用于 up
     * @param {boolean} options.build - 启动前构建镜像（--build），适用于 up
     * @param {boolean} options.noBuild - 不构建镜像（--no-build），适用于 up
     * @param {boolean} options.volumes - 同时删除卷（-v），适用于 down
     * @param {boolean} options.removeOrphans - 删除孤儿容器（--remove-orphans），适用于 up/down
     * @param {string|Array<string>} options.service - 指定服务名称，可选
     * @param {boolean} options.follow - 跟随日志（-f），适用于 logs
     * @param {number} options.tail - 显示最后 N 行日志（--tail），适用于 logs
     * @returns {{command: string, description: string}} 生成的 docker-compose 命令对象
     */
    function generateComposeCommand(action, options = {}) {
        const validActions = ['up', 'down', 'start', 'stop', 'restart', 'ps', 'logs', 'build', 'pull', 'exec'];
        if (!action || !validActions.includes(action)) {
            throw new Error(`无效的 action: ${action}，支持的操作: ${validActions.join(', ')}`);
        }

        const opts = normalizeOptions(options);
        const parts = ['docker-compose'];

        // 全局选项（action 之前）
        if (opts.file) parts.push(`-f ${escapeArg(opts.file)}`);
        if (opts.projectName) parts.push(`-p ${escapeArg(opts.projectName)}`);

        // 操作
        parts.push(action);

        // 操作特定选项（action 之后）
        if (action === 'up') {
            if (opts.detach) parts.push('-d');
            if (opts.build) parts.push('--build');
            if (opts.noBuild) parts.push('--no-build');
            if (opts.removeOrphans) parts.push('--remove-orphans');
        }

        if (action === 'down') {
            if (opts.volumes) parts.push('-v');
            if (opts.removeOrphans) parts.push('--remove-orphans');
        }

        if (action === 'logs') {
            if (opts.follow) parts.push('-f');
            if (opts.tail !== undefined) parts.push(`--tail ${opts.tail}`);
        }

        // 服务名称（最后）
        if (opts.service) {
            if (Array.isArray(opts.service)) {
                opts.service.forEach(s => parts.push(escapeArg(s)));
            } else {
                parts.push(escapeArg(opts.service));
            }
        }

        return buildResult(parts.join(' '), `Compose 操作：${action}`);
    }

    // ==================== docker exec ====================

    /**
     * 生成 docker exec 命令
     * @param {string} container - 容器名称或 ID
     * @param {string} command - 要执行的命令
     * @param {object} options - 选项
     * @param {boolean} options.interactive - 交互模式（-it）
     * @param {boolean} options.detach - 后台运行（-d）
     * @param {string} options.user - 用户（-u）
     * @param {string} options.workdir - 工作目录（-w）
     * @param {string|Array<string>} options.env - 环境变量（-e）
     * @returns {{command: string, description: string}} 生成的 docker exec 命令对象
     */
    function generateExecCommand(container, command, options = {}) {
        if (!container || typeof container !== 'string') {
            throw new Error('容器名称不能为空');
        }
        if (!command || typeof command !== 'string') {
            throw new Error('命令不能为空');
        }

        const opts = normalizeOptions(options);
        const parts = ['docker exec'];

        // 选项
        if (opts.interactive) parts.push('-it');
        if (opts.detach) parts.push('-d');
        if (opts.user) parts.push(`-u ${escapeArg(opts.user)}`);
        if (opts.workdir) parts.push(`-w ${escapeArg(opts.workdir)}`);

        // 环境变量
        if (opts.env) {
            const envParts = buildOption('-e', opts.env);
            if (envParts) parts.push(envParts);
        }

        // 容器和命令
        parts.push(escapeArg(container));
        parts.push(command); // 命令可能包含多个参数，不自动转义

        return buildResult(parts.join(' '), '在容器内执行命令');
    }

    // ==================== docker logs ====================

    /**
     * 生成 docker logs 命令
     * @param {string} container - 容器名称或 ID
     * @param {object} options - 选项
     * @param {boolean} options.follow - 跟随日志输出（-f）
     * @param {number} options.tail - 显示最后 N 行（--tail）
     * @param {boolean} options.timestamps - 显示时间戳（-t）
     * @param {string} options.since - 显示自指定时间以来的日志（--since），如 "2023-01-01"
     * @param {string} options.until - 显示指定时间之前的日志（--until）
     * @returns {{command: string, description: string}} 生成的 docker logs 命令对象
     */
    function generateLogsCommand(container, options = {}) {
        if (!container || typeof container !== 'string') {
            throw new Error('容器名称不能为空');
        }

        const opts = normalizeOptions(options);
        const parts = ['docker logs'];

        // 选项
        if (opts.follow) parts.push('-f');
        if (opts.timestamps) parts.push('-t');
        if (opts.tail !== undefined) parts.push(`--tail ${opts.tail}`);
        if (opts.since) parts.push(`--since ${escapeArg(opts.since)}`);
        if (opts.until) parts.push(`--until ${escapeArg(opts.until)}`);

        // 容器
        parts.push(escapeArg(container));

        return buildResult(parts.join(' '), '查看容器日志');
    }

    // ==================== docker ps ====================

    /**
     * 生成 docker ps 命令
     * @param {object} options - 选项
     * @param {boolean} options.all - 显示所有容器（-a），包括已停止的
     * @param {boolean} options.quiet - 仅显示容器 ID（-q）
     * @param {boolean} options.size - 显示文件大小（-s）
     * @param {string} options.filter - 过滤器（--filter），如 "status=running"
     * @param {string} options.format - 格式化输出（--format）
     * @returns {{command: string, description: string}} 生成的 docker ps 命令对象
     */
    function generatePsCommand(options = {}) {
        const opts = normalizeOptions(options);
        const parts = ['docker ps'];

        // 选项
        if (opts.all) parts.push('-a');
        if (opts.quiet) parts.push('-q');
        if (opts.size) parts.push('-s');
        if (opts.filter) parts.push(`--filter ${escapeArg(opts.filter)}`);
        if (opts.format) parts.push(`--format ${escapeArg(opts.format)}`);

        return buildResult(parts.join(' '), '列出容器');
    }

    // ==================== docker images ====================

    /**
     * 生成 docker images 命令
     * @param {object} options - 选项
     * @param {boolean} options.all - 显示所有镜像（-a），包括中间层
     * @param {boolean} options.quiet - 仅显示镜像 ID（-q）
     * @param {boolean} options.digests - 显示摘要（--digests）
     * @param {string} options.filter - 过滤器（--filter），如 "dangling=true"
     * @param {string} options.format - 格式化输出（--format）
     * @returns {{command: string, description: string}} 生成的 docker images 命令对象
     */
    function generateImagesCommand(options = {}) {
        const opts = normalizeOptions(options);
        const parts = ['docker images'];

        // 选项
        if (opts.all) parts.push('-a');
        if (opts.quiet) parts.push('-q');
        if (opts.digests) parts.push('--digests');
        if (opts.filter) parts.push(`--filter ${escapeArg(opts.filter)}`);
        if (opts.format) parts.push(`--format ${escapeArg(opts.format)}`);

        return buildResult(parts.join(' '), '列出镜像');
    }

    // ==================== docker pull/push ====================

    /**
     * 生成 docker pull 或 docker push 命令
     * @param {string} image - 镜像名称
     * @param {string} action - 操作：pull 或 push
     * @param {object} options - 选项
     * @param {boolean} options.allTags - 拉取所有标签（-a），仅适用于 pull
     * @param {string} options.platform - 目标平台（--platform），仅适用于 pull
     * @returns {{command: string, description: string}} 生成的 docker pull/push 命令对象
     */
    function generatePullPushCommand(image, action, options = {}) {
        if (!image || typeof image !== 'string') {
            throw new Error('镜像名称不能为空');
        }
        if (action !== 'pull' && action !== 'push') {
            throw new Error('action 必须是 pull 或 push');
        }

        const opts = normalizeOptions(options);
        const parts = [`docker ${action}`];

        // 选项
        if (action === 'pull') {
            if (opts.allTags) parts.push('-a');
            if (opts.platform) parts.push(`--platform ${escapeArg(opts.platform)}`);
        }

        // 镜像
        parts.push(escapeArg(image));

        const description = action === 'pull' ? '拉取镜像' : '推送镜像';
        return buildResult(parts.join(' '), description);
    }

    // ==================== docker stop/start/restart/rm ====================

    /**
     * 生成容器管理命令：stop, start, restart, rm
     * @param {string} action - 操作：stop, start, restart, rm
     * @param {string|Array<string>} containers - 容器名称或 ID（可以是数组）
     * @param {object} options - 选项
     * @param {boolean} options.force - 强制删除（-f），仅适用于 rm
     * @param {boolean} options.volumes - 同时删除卷（-v），仅适用于 rm
     * @param {number} options.time - 停止等待时间（-t），仅适用于 stop
     * @returns {{command: string, description: string}} 生成的容器管理命令对象
     */
    function generateContainerCommand(action, containers, options = {}) {
        const validActions = ['stop', 'start', 'restart', 'rm'];
        if (!action || !validActions.includes(action)) {
            throw new Error(`无效的 action: ${action}，支持的操作: ${validActions.join(', ')}`);
        }
        if (!containers || (Array.isArray(containers) && containers.length === 0)) {
            throw new Error('容器名称不能为空');
        }

        const opts = normalizeOptions(options);
        const parts = [`docker ${action}`];

        // 选项
        if (action === 'rm') {
            if (opts.force) parts.push('-f');
            if (opts.volumes) parts.push('-v');
        }
        if (action === 'stop' && opts.time !== undefined) {
            parts.push(`-t ${opts.time}`);
        }

        // 容器列表
        if (Array.isArray(containers)) {
            containers.forEach(c => parts.push(escapeArg(c)));
        } else {
            parts.push(escapeArg(containers));
        }

        return buildResult(parts.join(' '), `容器操作：${action}`);
    }

    // ==================== docker service ====================

    /**
     * 生成 docker service create 命令
     * @param {object} options - 选项
     * @returns {{command: string, description: string}}
     */
    function generateServiceCreateCommand(options = {}) {
        const opts = normalizeOptions(options);
        if (!opts.image) throw new Error('镜像名称不能为空');
        if (!opts.name) throw new Error('服务名称不能为空');

        const parts = ['docker service create'];
        parts.push(`--name ${escapeArg(opts.name)}`);

        if (opts.replicas) parts.push(`--replicas ${opts.replicas}`);
        if (opts.publish) {
            const publishParts = buildOption('--publish', opts.publish);
            if (publishParts) parts.push(publishParts);
        }
        if (opts.networks) {
            const networkParts = buildOption('--network', opts.networks);
            if (networkParts) parts.push(networkParts);
        }
        if (opts.endpointMode) parts.push(`--endpoint-mode ${escapeArg(opts.endpointMode)}`);
        if (opts.cpuLimit) parts.push(`--limit-cpu ${escapeArg(opts.cpuLimit)}`);
        if (opts.cpuReserve) parts.push(`--reserve-cpu ${escapeArg(opts.cpuReserve)}`);
        if (opts.memoryLimit) parts.push(`--limit-memory ${escapeArg(opts.memoryLimit)}`);
        if (opts.memoryReserve) parts.push(`--reserve-memory ${escapeArg(opts.memoryReserve)}`);
        if (opts.updateParallelism) parts.push(`--update-parallelism ${opts.updateParallelism}`);
        if (opts.updateDelay) parts.push(`--update-delay ${escapeArg(opts.updateDelay)}`);
        if (opts.updateFailureAction) parts.push(`--update-failure-action ${escapeArg(opts.updateFailureAction)}`);
        if (opts.mounts) {
            const mountParts = buildOption('--mount', opts.mounts);
            if (mountParts) parts.push(mountParts);
        }

        parts.push(escapeArg(opts.image));
        return buildResult(parts.join(' '), '创建服务');
    }

    /**
     * 生成 docker service update 命令
     * @param {string} serviceName - 服务名称
     * @param {object} options - 选项
     * @returns {{command: string, description: string}}
     */
    function generateServiceUpdateCommand(serviceName, options = {}) {
        if (!serviceName) throw new Error('服务名称不能为空');

        const opts = normalizeOptions(options);
        const parts = ['docker service update'];

        if (opts.image) parts.push(`--image ${escapeArg(opts.image)}`);
        if (opts.replicas) parts.push(`--replicas ${opts.replicas}`);
        if (opts.publish) {
            const publishParts = buildOption('--publish-add', opts.publish);
            if (publishParts) parts.push(publishParts);
        }
        if (opts.networks) {
            const networkParts = buildOption('--network-add', opts.networks);
            if (networkParts) parts.push(networkParts);
        }
        if (opts.endpointMode) parts.push(`--endpoint-mode ${escapeArg(opts.endpointMode)}`);
        if (opts.cpuLimit) parts.push(`--limit-cpu ${escapeArg(opts.cpuLimit)}`);
        if (opts.cpuReserve) parts.push(`--reserve-cpu ${escapeArg(opts.cpuReserve)}`);
        if (opts.memoryLimit) parts.push(`--limit-memory ${escapeArg(opts.memoryLimit)}`);
        if (opts.memoryReserve) parts.push(`--reserve-memory ${escapeArg(opts.memoryReserve)}`);
        if (opts.updateParallelism) parts.push(`--update-parallelism ${opts.updateParallelism}`);
        if (opts.updateDelay) parts.push(`--update-delay ${escapeArg(opts.updateDelay)}`);
        if (opts.updateFailureAction) parts.push(`--update-failure-action ${escapeArg(opts.updateFailureAction)}`);
        if (opts.mounts) {
            const mountParts = buildOption('--mount-add', opts.mounts);
            if (mountParts) parts.push(mountParts);
        }

        parts.push(escapeArg(serviceName));
        return buildResult(parts.join(' '), '更新服务');
    }

    /**
     * 生成 docker service scale 命令
     * @param {string} serviceName - 服务名称
     * @param {string|number} replicas - 副本数量
     * @returns {{command: string, description: string}}
     */
    function generateServiceScaleCommand(serviceName, replicas) {
        if (!serviceName) throw new Error('服务名称不能为空');
        if (replicas === undefined || replicas === '') throw new Error('副本数量不能为空');

        return buildResult(`docker service scale ${escapeArg(serviceName)}=${replicas}`, '伸缩服务副本');
    }

    /**
     * 生成 docker service logs 命令
     * @param {string} serviceName - 服务名称
     * @param {object} options - 选项
     * @returns {{command: string, description: string}}
     */
    function generateServiceLogsCommand(serviceName, options = {}) {
        if (!serviceName) throw new Error('服务名称不能为空');

        const opts = normalizeOptions(options);
        const parts = ['docker service logs'];

        if (opts.follow) parts.push('--follow');
        if (opts.timestamps) parts.push('--timestamps');
        if (opts.tail) parts.push(`--tail ${opts.tail}`);

        parts.push(escapeArg(serviceName));
        return buildResult(parts.join(' '), '查看服务日志');
    }

    /**
     * 生成 docker service ps 命令
     * @param {string} serviceName - 服务名称
     * @returns {{command: string, description: string}}
     */
    function generateServicePsCommand(serviceName) {
        if (!serviceName) throw new Error('服务名称不能为空');
        return buildResult(`docker service ps ${escapeArg(serviceName)}`, '查看服务任务');
    }

    /**
     * 生成 docker service ls 命令
     * @returns {{command: string, description: string}}
     */
    function generateServiceLsCommand() {
        return buildResult('docker service ls', '列出服务');
    }

    /**
     * 生成 docker service rm 命令
     * @param {string|Array<string>} serviceNames - 服务名称
     * @returns {{command: string, description: string}}
     */
    function generateServiceRmCommand(serviceNames) {
        if (!serviceNames || (Array.isArray(serviceNames) && serviceNames.length === 0)) {
            throw new Error('服务名称不能为空');
        }

        const parts = ['docker service rm'];
        if (Array.isArray(serviceNames)) {
            serviceNames.forEach(name => parts.push(escapeArg(name)));
        } else {
            parts.push(escapeArg(serviceNames));
        }

        return buildResult(parts.join(' '), '删除服务');
    }

    // ==================== docker swarm ====================

    /**
     * 生成 docker swarm init 命令
     * @param {object} options - 选项
     * @returns {{command: string, description: string}}
     */
    function generateSwarmInitCommand(options = {}) {
        const opts = normalizeOptions(options);
        const parts = ['docker swarm init'];

        if (opts.advertiseAddr) parts.push(`--advertise-addr ${escapeArg(opts.advertiseAddr)}`);
        if (opts.listenAddr) parts.push(`--listen-addr ${escapeArg(opts.listenAddr)}`);
        if (opts.forceNewCluster) parts.push('--force-new-cluster');

        return buildResult(parts.join(' '), '初始化 Swarm 集群');
    }

    /**
     * 生成 docker swarm join 命令
     * @param {string} addr - Manager/Worker 地址
     * @param {object} options - 选项
     * @returns {{command: string, description: string}}
     */
    function generateSwarmJoinCommand(addr, options = {}) {
        if (!addr) throw new Error('节点地址不能为空');

        const opts = normalizeOptions(options);
        const parts = ['docker swarm join'];

        if (opts.token) parts.push(`--token ${escapeArg(opts.token)}`);
        if (opts.advertiseAddr) parts.push(`--advertise-addr ${escapeArg(opts.advertiseAddr)}`);
        if (opts.listenAddr) parts.push(`--listen-addr ${escapeArg(opts.listenAddr)}`);

        parts.push(escapeArg(addr));
        return buildResult(parts.join(' '), '加入 Swarm 集群');
    }

    /**
     * 生成 docker swarm leave 命令
     * @param {object} options - 选项
     * @returns {{command: string, description: string}}
     */
    function generateSwarmLeaveCommand(options = {}) {
        const opts = normalizeOptions(options);
        const parts = ['docker swarm leave'];

        if (opts.force) parts.push('--force');

        return buildResult(parts.join(' '), '离开 Swarm 集群');
    }

    /**
     * 生成 docker swarm update 命令
     * @param {object} options - 选项
     * @returns {{command: string, description: string}}
     */
    function generateSwarmUpdateCommand(options = {}) {
        const opts = normalizeOptions(options);
        const parts = ['docker swarm update'];

        if (opts.autolock === true) parts.push('--autolock=true');
        else if (opts.autolock === false) parts.push('--autolock=false');
        if (opts.certExpiry) parts.push(`--cert-expiry ${escapeArg(opts.certExpiry)}`);
        if (opts.dispatcherHeartbeat) parts.push(`--dispatcher-heartbeat ${escapeArg(opts.dispatcherHeartbeat)}`);

        return buildResult(parts.join(' '), '更新 Swarm 集群配置');
    }

    /**
     * 生成 docker swarm unlock 命令
     * @returns {{command: string, description: string}}
     */
    function generateSwarmUnlockCommand() {
        return buildResult('docker swarm unlock', '解锁 Swarm 集群');
    }

    // ==================== docker stack ====================

    /**
     * 生成 docker stack deploy 命令
     * @param {string} stackName - Stack 名称
     * @param {object} options - 选项
     * @returns {{command: string, description: string}}
     */
    function generateStackDeployCommand(stackName, options = {}) {
        if (!stackName) throw new Error('Stack 名称不能为空');

        const opts = normalizeOptions(options);
        const parts = ['docker stack deploy'];

        if (opts.composeFiles) {
            const files = Array.isArray(opts.composeFiles) ? opts.composeFiles : [opts.composeFiles];
            files.forEach(f => {
                if (f) parts.push(`-c ${escapeArg(f)}`);
            });
        }

        if (opts.withRegistryAuth) parts.push('--with-registry-auth');
        if (opts.prune) parts.push('--prune');
        if (opts.resolveImage && opts.resolveImage !== 'always') {
            parts.push(`--resolve-image ${escapeArg(opts.resolveImage)}`);
        }

        parts.push(escapeArg(stackName));
        return buildResult(parts.join(' '), '部署 Stack');
    }

    /**
     * 生成 docker stack ls 命令
     * @returns {{command: string, description: string}}
     */
    function generateStackLsCommand() {
        return buildResult('docker stack ls', '列出 Stack');
    }

    /**
     * 生成 docker stack ps 命令
     * @param {string} stackName - Stack 名称
     * @returns {{command: string, description: string}}
     */
    function generateStackPsCommand(stackName) {
        if (!stackName) throw new Error('Stack 名称不能为空');
        return buildResult(`docker stack ps ${escapeArg(stackName)}`, '查看 Stack 任务');
    }

    /**
     * 生成 docker stack services 命令
     * @param {string} stackName - Stack 名称
     * @returns {{command: string, description: string}}
     */
    function generateStackServicesCommand(stackName) {
        if (!stackName) throw new Error('Stack 名称不能为空');
        return buildResult(`docker stack services ${escapeArg(stackName)}`, '查看 Stack 服务');
    }

    /**
     * 生成 docker stack rm 命令
     * @param {string|Array<string>} stackNames - Stack 名称
     * @returns {{command: string, description: string}}
     */
    function generateStackRmCommand(stackNames) {
        if (!stackNames || (Array.isArray(stackNames) && stackNames.length === 0)) {
            throw new Error('Stack 名称不能为空');
        }

        const parts = ['docker stack rm'];
        if (Array.isArray(stackNames)) {
            stackNames.forEach(name => parts.push(escapeArg(name)));
        } else {
            parts.push(escapeArg(stackNames));
        }

        return buildResult(parts.join(' '), '删除 Stack');
    }

    // ==================== docker network ====================

    /**
     * 生成 docker network 命令
     * @param {string} action - 操作类型：create, ls, rm, inspect, connect, disconnect
     * @param {string} name - 网络名称
     * @param {object} options - 选项
     * @returns {object} { command, description }
     */
    function generateNetworkCommand(action, name, options = {}) {
        const parts = ['docker network'];
        const act = (action || '').toLowerCase();

        switch (act) {
            case 'create':
                if (!name) throw new Error('创建网络需要提供网络名称');
                parts.push('create');
                if (options.driver) {
                    parts.push(`-d ${escapeArg(options.driver)}`);
                }
                if (options.subnet) {
                    parts.push(`--subnet ${escapeArg(options.subnet)}`);
                }
                if (options.gateway) {
                    parts.push(`--gateway ${escapeArg(options.gateway)}`);
                }
                if (options.ipRange) {
                    parts.push(`--ip-range ${escapeArg(options.ipRange)}`);
                }
                if (options.internal) {
                    parts.push('--internal');
                }
                if (options.attachable) {
                    parts.push('--attachable');
                }
                parts.push(escapeArg(name));
                return buildResult(parts.join(' '), `创建网络 ${name}`);

            case 'ls':
                parts.push('ls');
                if (options.filter) {
                    parts.push(`--filter ${escapeArg(options.filter)}`);
                }
                return buildResult(parts.join(' '), '列出网络');

            case 'rm':
                if (!name) throw new Error('删除网络需要提供网络名称');
                parts.push('rm');
                if (options.force) {
                    parts.push('-f');
                }
                parts.push(escapeArg(name));
                return buildResult(parts.join(' '), `删除网络 ${name}`);

            case 'inspect':
                if (!name) throw new Error('查看网络需要提供网络名称');
                parts.push('inspect', escapeArg(name));
                return buildResult(parts.join(' '), `查看网络 ${name} 详情`);

            case 'connect':
                if (!name) throw new Error('连接网络需要提供网络名称');
                if (!options.container) throw new Error('连接网络需要提供容器名称');
                parts.push('connect');
                if (options.ip) {
                    parts.push(`--ip ${escapeArg(options.ip)}`);
                }
                if (options.alias) {
                    parts.push(`--alias ${escapeArg(options.alias)}`);
                }
                parts.push(escapeArg(name), escapeArg(options.container));
                return buildResult(parts.join(' '), `将容器 ${options.container} 连接到网络 ${name}`);

            case 'disconnect':
                if (!name) throw new Error('断开网络需要提供网络名称');
                if (!options.container) throw new Error('断开网络需要提供容器名称');
                parts.push('disconnect');
                if (options.force) {
                    parts.push('-f');
                }
                parts.push(escapeArg(name), escapeArg(options.container));
                return buildResult(parts.join(' '), `将容器 ${options.container} 从网络 ${name} 断开`);

            case 'prune':
                parts.push('prune', '-f');
                return buildResult(parts.join(' '), '清理未使用的网络');

            default:
                throw new Error(`未知的网络操作: ${action}`);
        }
    }

    // ==================== docker volume ====================

    /**
     * 生成 docker volume 命令
     * @param {string} action - 操作类型：create, ls, rm, inspect, prune
     * @param {string} name - 卷名称
     * @param {object} options - 选项
     * @returns {object} { command, description }
     */
    function generateVolumeCommand(action, name, options = {}) {
        const parts = ['docker volume'];
        const act = (action || '').toLowerCase();

        switch (act) {
            case 'create':
                if (!name) throw new Error('创建卷需要提供卷名称');
                parts.push('create');
                if (options.driver) {
                    parts.push(`-d ${escapeArg(options.driver)}`);
                }
                if (options.label) {
                    const labels = Array.isArray(options.label) ? options.label : [options.label];
                    labels.forEach(l => parts.push(`--label ${escapeArg(l)}`));
                }
                if (options.opt) {
                    const opts = Array.isArray(options.opt) ? options.opt : [options.opt];
                    opts.forEach(o => parts.push(`-o ${escapeArg(o)}`));
                }
                parts.push(escapeArg(name));
                return buildResult(parts.join(' '), `创建卷 ${name}`);

            case 'ls':
                parts.push('ls');
                if (options.filter) {
                    parts.push(`--filter ${escapeArg(options.filter)}`);
                }
                if (options.quiet) {
                    parts.push('-q');
                }
                return buildResult(parts.join(' '), '列出卷');

            case 'rm':
                if (!name) throw new Error('删除卷需要提供卷名称');
                parts.push('rm');
                if (options.force) {
                    parts.push('-f');
                }
                parts.push(escapeArg(name));
                return buildResult(parts.join(' '), `删除卷 ${name}`);

            case 'inspect':
                if (!name) throw new Error('查看卷需要提供卷名称');
                parts.push('inspect', escapeArg(name));
                return buildResult(parts.join(' '), `查看卷 ${name} 详情`);

            case 'prune':
                parts.push('prune', '-f');
                if (options.all) {
                    parts.push('-a');
                }
                return buildResult(parts.join(' '), '清理未使用的卷');

            default:
                throw new Error(`未知的卷操作: ${action}`);
        }
    }

    // ==================== docker system prune ====================

    /**
     * 生成 docker system prune 命令
     * @param {object} options - 选项
     * @returns {object} { command, description }
     */
    function generateSystemPruneCommand(options = {}) {
        const parts = ['docker system prune'];
        const descriptions = ['清理未使用的资源'];

        if (options.force) {
            parts.push('-f');
        }

        if (options.all) {
            parts.push('-a');
            descriptions.push('包括未使用的镜像');
        }

        if (options.volumes) {
            parts.push('--volumes');
            descriptions.push('包括卷');
        }

        if (options.filter) {
            parts.push(`--filter ${escapeArg(options.filter)}`);
        }

        return buildResult(parts.join(' '), descriptions.join('，'));
    }

    // ==================== docker cp ====================

    /**
     * 生成 docker cp 命令
     * @param {string} source - 源路径
     * @param {string} dest - 目标路径
     * @param {object} options - 选项
     * @returns {object} { command, description }
     */
    function generateCpCommand(source, dest, options = {}) {
        if (!source) throw new Error('源路径不能为空');
        if (!dest) throw new Error('目标路径不能为空');

        const parts = ['docker cp'];

        if (options.archive) {
            parts.push('-a');
        }

        if (options.followLink) {
            parts.push('-L');
        }

        parts.push(escapeArg(source), escapeArg(dest));

        const isToContainer = dest.includes(':');
        const description = isToContainer ? '复制文件到容器' : '从容器复制文件';

        return buildResult(parts.join(' '), description);
    }

    // 导出 API
    return {
        generateRunCommand,
        generateBuildCommand,
        generateComposeCommand,
        generateExecCommand,
        generateLogsCommand,
        generatePsCommand,
        generateImagesCommand,
        generatePullPushCommand,
        generateContainerCommand,
        generateServiceCreateCommand,
        generateServiceUpdateCommand,
        generateServiceScaleCommand,
        generateServiceLogsCommand,
        generateServicePsCommand,
        generateServiceLsCommand,
        generateServiceRmCommand,
        generateSwarmInitCommand,
        generateSwarmJoinCommand,
        generateSwarmLeaveCommand,
        generateSwarmUpdateCommand,
        generateSwarmUnlockCommand,
        generateStackDeployCommand,
        generateStackLsCommand,
        generateStackPsCommand,
        generateStackServicesCommand,
        generateStackRmCommand,
        generateNetworkCommand,
        generateVolumeCommand,
        generateSystemPruneCommand,
        generateCpCommand,
        // 仅供测试
        _escapeArg: escapeArg
    };
});
