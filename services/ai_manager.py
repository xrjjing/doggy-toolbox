# -*- coding: utf-8 -*-
"""
AI Manager 统一管理器
负责 Provider 管理、模型获取、请求统计
"""

import json
import logging
import os
import time
import uuid
import httpx
from typing import Dict, List, Any, Optional
from pathlib import Path

from services.ai_providers import create_provider

logger = logging.getLogger(__name__)


class AIManager:
    """统一的 AI 管理器"""

    # 工具推荐目录（用于智能工具推荐功能）
    TOOL_RECOMMENDATION_CATALOG = [
        # 编码/解码
        {'id': 'tool-base64', 'name': 'Base64 编解码', 'keywords': ['base64', '编码', '解码', 'encode', 'decode']},
        {'id': 'tool-url', 'name': 'URL 编解码', 'keywords': ['url', 'urlencode', 'urldecode', '编码', '解码', '链接']},
        {'id': 'tool-unicode', 'name': 'Unicode 转换', 'keywords': ['unicode', '转义', '\\u', '编码']},
        {'id': 'tool-html-entity', 'name': 'HTML 实体', 'keywords': ['html', 'entity', '实体', '转义', '&amp;', '&lt;']},
        {'id': 'tool-b64hex', 'name': 'Base64/Hex 转换', 'keywords': ['hex', '十六进制', 'base64']},
        {'id': 'tool-radix', 'name': '进制转换', 'keywords': ['进制', '二进制', '八进制', '十六进制', 'binary', 'octal', 'hex']},
        # 加密/安全
        {'id': 'tool-hash', 'name': 'Hash 计算', 'keywords': ['hash', 'md5', 'sha', 'sha256', '哈希', '摘要']},
        {'id': 'tool-crypto', 'name': '加密解密', 'keywords': ['加密', '解密', 'aes', 'des', 'encrypt', 'decrypt']},
        {'id': 'tool-jwt', 'name': 'JWT 解析', 'keywords': ['jwt', 'token', '令牌', '解析']},
        {'id': 'tool-password', 'name': '密码生成', 'keywords': ['密码', 'password', '生成', '随机']},
        {'id': 'tool-hmac', 'name': 'HMAC 计算', 'keywords': ['hmac', '签名', 'signature']},
        {'id': 'tool-rsa', 'name': 'RSA 工具', 'keywords': ['rsa', '公钥', '私钥', '非对称', '加密']},
        # 数据处理
        {'id': 'tool-json', 'name': 'JSON 格式化', 'keywords': ['json', '格式化', 'format', '美化', '压缩']},
        {'id': 'tool-json-schema', 'name': 'JSON Schema', 'keywords': ['json', 'schema', '验证', '生成']},
        {'id': 'tool-csv', 'name': 'CSV 工具', 'keywords': ['csv', '表格', 'excel', '转换']},
        {'id': 'tool-mock', 'name': 'Mock 数据', 'keywords': ['mock', '测试数据', '假数据', '生成']},
        {'id': 'tool-toml', 'name': 'TOML 工具', 'keywords': ['toml', '配置', 'config']},
        {'id': 'tool-jsonpath', 'name': 'JSONPath', 'keywords': ['jsonpath', '查询', 'json', '提取']},
        {'id': 'tool-data-convert', 'name': '数据转换', 'keywords': ['转换', 'json', 'yaml', 'xml', 'toml']},
        # 文本处理
        {'id': 'tool-text', 'name': '文本处理', 'keywords': ['文本', '去重', '排序', '替换', 'text']},
        {'id': 'tool-diff', 'name': '文本对比', 'keywords': ['diff', '对比', '比较', '差异']},
        {'id': 'tool-regex', 'name': '正则表达式', 'keywords': ['regex', '正则', '匹配', '提取', 'pattern']},
        {'id': 'tool-charcount', 'name': '字符统计', 'keywords': ['字符', '统计', '字数', 'count']},
        {'id': 'tool-markdown', 'name': 'Markdown', 'keywords': ['markdown', 'md', '预览']},
        {'id': 'tool-text-sort', 'name': '文本排序', 'keywords': ['排序', 'sort', '文本']},
        {'id': 'tool-mask', 'name': '数据脱敏', 'keywords': ['脱敏', 'mask', '隐藏', '手机号', '身份证']},
        {'id': 'tool-sql', 'name': 'SQL 格式化', 'keywords': ['sql', '格式化', '查询', 'mysql', 'postgresql']},
        # 生成器
        {'id': 'tool-uuid', 'name': 'UUID 生成', 'keywords': ['uuid', 'guid', '唯一标识']},
        {'id': 'tool-time', 'name': '时间戳转换', 'keywords': ['时间戳', 'timestamp', '时间', '日期', 'unix']},
        {'id': 'tool-datecalc', 'name': '日期计算', 'keywords': ['日期', '计算', '天数', '间隔']},
        {'id': 'tool-naming', 'name': '命名转换', 'keywords': ['命名', 'camel', 'snake', '驼峰', '下划线']},
        {'id': 'tool-curl', 'name': 'cURL 解析', 'keywords': ['curl', 'http', '请求', 'api']},
        {'id': 'tool-color', 'name': '颜色转换', 'keywords': ['颜色', 'color', 'rgb', 'hex', 'hsl']},
        {'id': 'tool-ip', 'name': 'IP 工具', 'keywords': ['ip', '地址', 'cidr', '子网']},
        {'id': 'tool-cron', 'name': 'Cron 表达式', 'keywords': ['cron', '定时', '任务', '表达式']},
        {'id': 'tool-qrcode', 'name': '二维码', 'keywords': ['二维码', 'qrcode', 'qr', '生成']},
        {'id': 'tool-img-base64', 'name': '图片 Base64', 'keywords': ['图片', 'image', 'base64', '转换']},
        {'id': 'tool-ua', 'name': 'User-Agent', 'keywords': ['ua', 'user-agent', '浏览器', '解析']},
        # 命令生成器
        {'id': 'tool-git', 'name': 'Git 命令', 'keywords': ['git', 'commit', 'merge', 'branch', '版本控制']},
        {'id': 'tool-docker', 'name': 'Docker 命令', 'keywords': ['docker', '容器', 'container', 'image']},
        {'id': 'tool-nginx', 'name': 'Nginx 配置', 'keywords': ['nginx', '反向代理', 'proxy', '配置']},
        # 网络
        {'id': 'http-collections', 'name': 'HTTP 请求', 'keywords': ['http', 'api', '请求', 'request', 'post', 'get']},
        {'id': 'tool-websocket', 'name': 'WebSocket', 'keywords': ['websocket', 'ws', '连接', '实时']},
    ]

    # 工具推荐系统提示词
    TOOL_RECOMMEND_SYSTEM_PROMPT = '''你是开发者工具箱的意图识别助手。根据用户消息，判断是否需要推荐工具。

可用工具列表：
{tool_catalog}

请仅输出 JSON，格式如下：
{{"tools": [{{"id": "tool-xxx", "name": "工具名称", "reason": "推荐理由"}}]}}

规则：
1. 只推荐与用户需求高度相关的工具（最多 3 个）
2. 如果用户只是闲聊或问题与工具无关，返回空数组：{{"tools": []}}
3. reason 要简洁，说明为什么推荐这个工具
4. 不要输出任何多余文字，只输出 JSON'''

    # 代码/命令解释系统提示词
    EXPLAINER_SYSTEM_PROMPT = '''你是代码和命令解释助手。请用中文解释用户提供的代码或命令。

输出格式：
1. **功能概述**：一句话说明这段代码/命令的作用
2. **逐行解释**：解释关键部分的含义
3. **注意事项**：可能的风险、常见错误或最佳实践建议

保持简洁专业，使用 Markdown 格式。'''

    # 工具 AI 功能配置的默认定义（仅包含前端实际支持的工具）
    TOOL_AI_DEFINITIONS = {
        'categories': [
            {
                'id': 'generators',
                'name': '命令生成器',
                'tools': [
                    {'id': 'tool-git', 'name': 'Git 命令生成器', 'features': ['generate', 'fix']},
                    {'id': 'tool-docker', 'name': 'Docker 命令生成器', 'features': ['generate', 'fix']},
                    {'id': 'tool-nginx', 'name': 'nginx 配置生成器', 'features': ['generate', 'fix']},
                ]
            },
            {
                'id': 'data',
                'name': '数据处理',
                'tools': [
                    {'id': 'tool-mock', 'name': 'Mock 数据生成', 'features': ['generate']},
                    {'id': 'tool-json', 'name': 'JSON 格式化', 'features': ['generate', 'fix', 'analyze']},
                    {'id': 'tool-json-schema', 'name': 'JSON Schema 生成', 'features': ['generate']},
                ]
            },
            {
                'id': 'text',
                'name': '文本处理',
                'tools': [
                    {'id': 'tool-regex', 'name': '正则表达式测试', 'features': ['generate', 'fix']},
                    {'id': 'tool-sql', 'name': 'SQL 格式化', 'features': ['generate', 'fix']},
                    {'id': 'tool-curl', 'name': 'cURL 解析', 'features': ['generate', 'fix']},
                    {'id': 'tool-cron', 'name': 'Cron 解析', 'features': ['generate']},
                ]
            },
        ]
    }

    def __init__(self, data_dir: Path):
        self.data_dir = data_dir
        self.data_dir.mkdir(parents=True, exist_ok=True)
        self.config_path = self.data_dir / "providers.json"
        self.tool_ai_config_path = self.data_dir / "tool_ai_config.json"
        self.providers = {}
        self.active_provider_id = None
        self.stats_cache = {}
        self.tool_ai_config_cache = None
        self.load_config()

    def load_config(self):
        """从配置文件加载 AI 提供商"""
        try:
            if not self.config_path.exists():
                logger.warning(f"配置文件不存在: {self.config_path}")
                return

            with open(self.config_path, 'r', encoding='utf-8') as f:
                config = json.load(f)

            providers_config = config.get('providers', [])

            # 清空现有 providers
            self.providers = {}

            # 加载启用的 providers
            for provider_config in providers_config:
                if not provider_config.get('enabled', True):
                    continue

                try:
                    provider_id = provider_config['id']
                    self.providers[provider_id] = create_provider(provider_config)
                    logger.info(f"加载 Provider: {provider_id}")
                except Exception as e:
                    logger.error(f"加载 Provider 失败: {e}")

            # 设置活跃 provider
            self.active_provider_id = config.get('active_provider')

            # 加载统计缓存
            for provider_config in providers_config:
                provider_id = provider_config['id']
                self.stats_cache[provider_id] = provider_config.get('stats', {
                    'total_requests': 0,
                    'failed_requests': 0,
                    'total_latency': 0,
                    'avg_latency': 0
                })

            logger.info(f"AI Manager 初始化完成，活跃 Provider: {self.active_provider_id}")

        except Exception as e:
            logger.error(f"加载配置失败: {e}")

    def get_provider(self, provider_id: Optional[str] = None):
        """获取指定或当前活跃的 Provider"""
        pid = provider_id or self.active_provider_id

        if not pid:
            raise Exception("未配置活跃的 AI Provider")

        if pid not in self.providers:
            raise Exception(f"Provider {pid} 不存在或未启用")

        return self.providers[pid]

    async def chat(self, prompt: str, system_prompt: Optional[str] = None,
                   provider_id: Optional[str] = None, web_search: Optional[bool] = None,
                   thinking_enabled: Optional[bool] = None, thinking_budget: Optional[int] = None,
                   **kwargs) -> Dict[str, Any]:
        """统一的对话接口"""
        pid = provider_id or self.active_provider_id
        provider = self.get_provider(pid)

        # 获取 Provider 配置
        provider_config = self._get_provider_config(pid)
        config_dict = provider_config.get('config', {})

        # web_search：使用传入参数或配置中的默认值
        if web_search is None:
            web_search = config_dict.get('web_search', False)

        # thinking：使用传入参数或配置中的默认值（仅 Claude）
        if thinking_enabled is None:
            thinking_enabled = config_dict.get('thinking_enabled', False)
        if thinking_budget is None:
            thinking_budget = config_dict.get('thinking_budget', 2048)

        # 构建消息
        messages = []
        if system_prompt:
            messages.append({"role": "system", "content": system_prompt})
        messages.append({"role": "user", "content": prompt})

        # 执行请求
        start_time = time.time()
        request_id = str(uuid.uuid4())

        try:
            # 根据 Provider 类型传递不同参数
            if provider_config.get('type') == 'claude':
                result = await provider.chat(
                    messages,
                    web_search_enabled=web_search,
                    thinking_enabled=thinking_enabled,
                    thinking_budget=thinking_budget,
                    **kwargs
                )
            else:
                result = await provider.chat(messages, web_search_enabled=web_search, **kwargs)

            latency = time.time() - start_time

            # 更新统计
            self._update_stats(pid, success=True, latency=latency)

            return {
                'success': True,
                'response': result,
                'request_id': request_id,
                'provider_id': pid,
                'latency': latency,
                'web_search': web_search,
                'thinking_enabled': thinking_enabled if provider_config.get('type') == 'claude' else False
            }

        except Exception as e:
            latency = time.time() - start_time
            self._update_stats(pid, success=False, latency=latency)
            logger.error(f"AI 请求失败: {e}")
            raise e

    def _get_provider_config(self, provider_id: str) -> Dict[str, Any]:
        """获取指定 Provider 的配置"""
        try:
            if not self.config_path.exists():
                return {}

            with open(self.config_path, 'r', encoding='utf-8') as f:
                config = json.load(f)

            for p in config.get('providers', []):
                if p.get('id') == provider_id:
                    return p
        except Exception as e:
            logger.error(f"获取 Provider 配置失败: {e}")

        return {}

    def switch_provider(self, provider_id: str):
        """切换活跃的 Provider"""
        if provider_id not in self.providers:
            raise Exception(f"Provider {provider_id} 不存在或未启用")

        self.active_provider_id = provider_id

        # 保存到配置
        self._save_active_provider(provider_id)

        logger.info(f"切换到 Provider: {provider_id}")

    def get_available_providers(self) -> List[Dict[str, Any]]:
        """获取可用的 Provider 列表"""
        result = []

        try:
            if not self.config_path.exists():
                return result

            with open(self.config_path, 'r', encoding='utf-8') as f:
                config = json.load(f)

            providers_config = config.get('providers', [])

            for provider_config in providers_config:
                if not provider_config.get('enabled', True):
                    continue

                provider_id = provider_config['id']
                stats = self.stats_cache.get(provider_id, {})

                result.append({
                    'id': provider_id,
                    'name': provider_config.get('name', provider_id),
                    'type': provider_config.get('type'),
                    'category': provider_config.get('category'),
                    'active': provider_id == self.active_provider_id,
                    'capabilities': provider_config.get('capabilities', {}),
                    'config': provider_config.get('config', {}),
                    'stats': stats
                })

        except Exception as e:
            logger.error(f"获取 Provider 列表失败: {e}")

        return result

    async def fetch_models(self, temp_config: Dict[str, Any]) -> List[Dict[str, Any]]:
        """动态获取可用模型列表"""
        provider_type = temp_config.get('type')

        try:
            if provider_type == 'openai':
                api_key = temp_config.get('api_key')
                if not api_key:
                    api_key = os.environ.get("OPENAI_API_KEY")

                if api_key:
                    return await self._fetch_openai_models(temp_config)
                else:
                    # 没有 API Key，返回固定模型列表
                    return self._get_openai_models()
            elif provider_type == 'openai-compatible':
                return await self._fetch_openai_models(temp_config)
            elif provider_type == 'claude':
                # 尝试从 API 获取模型列表
                api_key = temp_config.get('api_key')
                if not api_key:
                    api_key = os.environ.get("ANTHROPIC_API_KEY")

                if api_key:
                    try:
                        return await self._fetch_claude_models(temp_config)
                    except Exception as e:
                        logger.warning(f"从 Claude API 获取模型失败: {e}，使用固定列表")
                        return self._get_claude_models()
                else:
                    return self._get_claude_models()
            else:
                return []

        except Exception as e:
            logger.error(f"获取模型列表失败: {e}")
            raise e

    async def _fetch_openai_models(self, config: Dict[str, Any]) -> List[Dict[str, Any]]:
        """从 OpenAI API 获取模型列表"""
        base_url = config.get('base_url', 'https://api.openai.com/v1')
        url = f"{base_url.rstrip('/')}/models"

        api_key = config.get('api_key')
        if not api_key:
            api_key = os.environ.get("OPENAI_API_KEY")

        if not api_key:
            raise ValueError("未找到 OpenAI API Key")

        headers = {
            'Authorization': f'Bearer {api_key}',
            'Content-Type': 'application/json'
        }

        # 多组织/多项目场景
        organization = config.get('organization')
        project = config.get('project')
        if organization:
            headers['OpenAI-Organization'] = organization
        if project:
            headers['OpenAI-Project'] = project

        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.get(url, headers=headers)
            response.raise_for_status()
            data = response.json()

            # 提取模型信息
            models = []
            for model in data.get('data', []):
                models.append({
                    'id': model['id'],
                    'name': model.get('id'),
                    'created': model.get('created'),
                    'owned_by': model.get('owned_by', 'unknown')
                })

            # 过滤和排序（优先显示对话模型）
            chat_models = [m for m in models if any(
                keyword in m['id'].lower() for keyword in ['gpt', 'chat', 'turbo']
            )]
            other_models = [m for m in models if m not in chat_models]

            return chat_models + other_models

    def _get_openai_models(self) -> List[Dict[str, Any]]:
        """返回 OpenAI 固定的模型列表（无 API Key 时使用）"""
        return [
            {
                'id': 'gpt-5.2',
                'name': 'GPT-5.2',
                'description': '最新旗舰模型'
            },
            {
                'id': 'gpt-5.1',
                'name': 'GPT-5.1',
                'description': '稳定旗舰模型'
            },
            {
                'id': 'gpt-5.1-codex',
                'name': 'GPT-5.1 Codex',
                'description': 'Codex 专用模型'
            }
        ]

    async def _fetch_claude_models(self, config: Dict[str, Any]) -> List[Dict[str, Any]]:
        """从 Claude API 获取模型列表"""
        base_url = config.get('base_url', 'https://api.anthropic.com')
        base = base_url.rstrip('/')
        # 智能 URL 构建
        if base.endswith('/v1/models') or base.endswith('/models'):
            url = base
        elif base.endswith('/v1'):
            url = f"{base}/models"
        else:
            url = f"{base}/v1/models"

        api_key = config.get('api_key')
        if not api_key:
            api_key = os.environ.get("ANTHROPIC_API_KEY")

        if not api_key:
            raise ValueError("未找到 Claude API Key")

        api_version = config.get('api_version', '2023-06-01')

        # 兼容第三方 Claude API，同时发送 x-api-key 和 Authorization 头部
        headers = {
            'x-api-key': api_key,
            'Authorization': f'Bearer {api_key}',
            'anthropic-version': api_version,
            'anthropic-beta': 'output-128k-2025-02-19',
            'Content-Type': 'application/json',
            'Accept': 'application/json'
        }

        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.get(url, headers=headers)
            response.raise_for_status()
            data = response.json()

            models = []
            for model in data.get('data', []):
                model_id = model.get('id')
                if not model_id:
                    continue
                # 只保留 Claude 模型
                if 'claude' not in model_id.lower():
                    continue
                models.append({
                    'id': model_id,
                    'name': model_id,  # 直接显示真实模型 ID
                    'created': model.get('created_at') or model.get('created'),
                    'owned_by': model.get('owned_by', 'anthropic')
                })

            return models

    def _get_claude_models(self) -> List[Dict[str, Any]]:
        """返回 Claude 固定的模型列表（API 获取失败时的备用）"""
        return [
            {
                'id': 'claude-opus-4-5-20251101',
                'name': 'claude-opus-4-5-20251101',
                'description': '最强推理能力'
            },
            {
                'id': 'claude-sonnet-4-5-20250929',
                'name': 'claude-sonnet-4-5-20250929',
                'description': '平衡性能与速度'
            },
            {
                'id': 'claude-haiku-4-5-20251001',
                'name': 'claude-haiku-4-5-20251001',
                'description': '最快响应速度'
            }
        ]

    async def test_connection(self, temp_config: Dict[str, Any]) -> Dict[str, Any]:
        """测试 Provider 连接"""
        try:
            # 创建临时 provider
            provider = create_provider(temp_config)

            # 发送测试消息
            test_prompt = "Say 'Hello' in one word."
            messages = [{"role": "user", "content": test_prompt}]

            start_time = time.time()
            response = await provider.chat(messages, max_tokens=10)
            latency = time.time() - start_time

            return {
                'success': True,
                'response': response,
                'latency': round(latency, 2)
            }

        except Exception as e:
            logger.error(f"连接测试失败: {e}")
            return {
                'success': False,
                'error': str(e)
            }

    def save_provider(self, provider_config: Dict[str, Any]) -> Dict[str, Any]:
        """保存 Provider 配置"""
        try:
            config = {'providers': [], 'active_provider': None}
            if self.config_path.exists():
                with open(self.config_path, 'r', encoding='utf-8') as f:
                    config = json.load(f)

            providers = config.get('providers', [])
            provider_id = provider_config['id']

            # 查找是否已存在
            existing_idx = None
            for i, p in enumerate(providers):
                if p['id'] == provider_id:
                    existing_idx = i
                    break

            if existing_idx is not None:
                providers[existing_idx] = provider_config
            else:
                providers.append(provider_config)

            config['providers'] = providers

            # 如果是第一个 provider，自动设为活跃
            if len(providers) == 1:
                config['active_provider'] = provider_id

            with open(self.config_path, 'w', encoding='utf-8') as f:
                json.dump(config, f, indent=2, ensure_ascii=False)

            # 重新加载配置
            self.load_config()

            return {'success': True}

        except Exception as e:
            logger.error(f"保存 Provider 失败: {e}")
            return {'success': False, 'error': str(e)}

    def delete_provider(self, provider_id: str) -> Dict[str, Any]:
        """删除 Provider"""
        try:
            if not self.config_path.exists():
                return {'success': False, 'error': '配置文件不存在'}

            with open(self.config_path, 'r', encoding='utf-8') as f:
                config = json.load(f)

            providers = config.get('providers', [])
            config['providers'] = [p for p in providers if p['id'] != provider_id]

            # 如果删除的是活跃 provider，清空活跃状态
            if config.get('active_provider') == provider_id:
                config['active_provider'] = None

            with open(self.config_path, 'w', encoding='utf-8') as f:
                json.dump(config, f, indent=2, ensure_ascii=False)

            # 重新加载配置
            self.load_config()

            return {'success': True}

        except Exception as e:
            logger.error(f"删除 Provider 失败: {e}")
            return {'success': False, 'error': str(e)}

    def _update_stats(self, provider_id: str, success: bool, latency: float):
        """更新统计信息"""
        if provider_id not in self.stats_cache:
            self.stats_cache[provider_id] = {
                'total_requests': 0,
                'failed_requests': 0,
                'total_latency': 0,
                'avg_latency': 0
            }

        stats = self.stats_cache[provider_id]
        stats['total_requests'] += 1

        if not success:
            stats['failed_requests'] += 1

        stats['total_latency'] += latency
        stats['avg_latency'] = round(stats['total_latency'] / stats['total_requests'], 2)

        # 每 5 次请求保存一次统计
        if stats['total_requests'] % 5 == 0:
            self._save_stats(provider_id, stats)

    def _save_stats(self, provider_id: str, stats: Dict[str, Any]):
        """保存统计到配置文件"""
        try:
            if not self.config_path.exists():
                return

            with open(self.config_path, 'r', encoding='utf-8') as f:
                config = json.load(f)

            providers = config.get('providers', [])

            for provider in providers:
                if provider['id'] == provider_id:
                    provider['stats'] = stats
                    break

            with open(self.config_path, 'w', encoding='utf-8') as f:
                json.dump(config, f, indent=2, ensure_ascii=False)

        except Exception as e:
            logger.error(f"保存统计失败: {e}")

    def _save_active_provider(self, provider_id: str):
        """保存活跃 Provider"""
        try:
            config = {'providers': [], 'active_provider': None}
            if self.config_path.exists():
                with open(self.config_path, 'r', encoding='utf-8') as f:
                    config = json.load(f)

            config['active_provider'] = provider_id

            with open(self.config_path, 'w', encoding='utf-8') as f:
                json.dump(config, f, indent=2, ensure_ascii=False)

        except Exception as e:
            logger.error(f"保存活跃 Provider 失败: {e}")

    # ========== 工具 AI 功能配置管理 ==========

    def get_tool_ai_definitions(self) -> Dict[str, Any]:
        """获取工具 AI 功能定义（包含所有工具及其支持的 AI 功能）"""
        return self.TOOL_AI_DEFINITIONS

    def get_tool_ai_config(self) -> Dict[str, Any]:
        """获取工具 AI 功能配置"""
        if self.tool_ai_config_cache is not None:
            return self.tool_ai_config_cache

        try:
            if self.tool_ai_config_path.exists():
                with open(self.tool_ai_config_path, 'r', encoding='utf-8') as f:
                    self.tool_ai_config_cache = json.load(f)
            else:
                # 返回默认配置：全部启用
                self.tool_ai_config_cache = self._get_default_tool_ai_config()

            return self.tool_ai_config_cache

        except Exception as e:
            logger.error(f"加载工具 AI 配置失败: {e}")
            return self._get_default_tool_ai_config()

    def _get_default_tool_ai_config(self) -> Dict[str, Any]:
        """生成默认的工具 AI 配置（全部启用）"""
        config = {
            'global_enabled': True,
            'tools': {}
        }

        for category in self.TOOL_AI_DEFINITIONS['categories']:
            for tool in category['tools']:
                tool_id = tool['id']
                features = {f: True for f in tool['features']}
                config['tools'][tool_id] = {
                    'enabled': True,
                    'features': features
                }

        return config

    def save_tool_ai_config(self, config: Dict[str, Any]) -> Dict[str, Any]:
        """保存工具 AI 功能配置"""
        try:
            with open(self.tool_ai_config_path, 'w', encoding='utf-8') as f:
                json.dump(config, f, indent=2, ensure_ascii=False)

            # 更新缓存
            self.tool_ai_config_cache = config

            logger.info("工具 AI 配置保存成功")
            return {'success': True}

        except Exception as e:
            logger.error(f"保存工具 AI 配置失败: {e}")
            return {'success': False, 'error': str(e)}

    def get_tool_ai_enabled(self, tool_id: str) -> Dict[str, Any]:
        """获取指定工具的 AI 功能启用状态"""
        config = self.get_tool_ai_config()

        # 全局开关关闭时，所有工具都禁用
        if not config.get('global_enabled', True):
            return {
                'enabled': False,
                'features': {'generate': False, 'fix': False}
            }

        # 获取工具配置
        tool_config = config.get('tools', {}).get(tool_id)
        if tool_config is None:
            # 工具未配置，查找定义中的默认功能
            for category in self.TOOL_AI_DEFINITIONS['categories']:
                for tool in category['tools']:
                    if tool['id'] == tool_id:
                        return {
                            'enabled': True,
                            'features': {f: True for f in tool['features']}
                        }
            # 未知工具，返回禁用
            return {
                'enabled': False,
                'features': {'generate': False, 'fix': False}
            }

        return tool_config

    def set_tool_ai_enabled(self, tool_id: str, enabled: bool) -> Dict[str, Any]:
        """设置指定工具的 AI 功能启用状态"""
        config = self.get_tool_ai_config()

        if tool_id not in config.get('tools', {}):
            # 初始化工具配置
            for category in self.TOOL_AI_DEFINITIONS['categories']:
                for tool in category['tools']:
                    if tool['id'] == tool_id:
                        config.setdefault('tools', {})[tool_id] = {
                            'enabled': enabled,
                            'features': {f: True for f in tool['features']}
                        }
                        break

        if tool_id in config.get('tools', {}):
            config['tools'][tool_id]['enabled'] = enabled

        return self.save_tool_ai_config(config)

    def set_global_ai_enabled(self, enabled: bool) -> Dict[str, Any]:
        """设置全局 AI 功能开关"""
        config = self.get_tool_ai_config()
        config['global_enabled'] = enabled
        return self.save_tool_ai_config(config)

    # ========== 智能工具推荐功能 ==========

    def _parse_json_response(self, raw: str) -> Dict[str, Any]:
        """安全解析 AI 返回的 JSON"""
        import re
        if not raw:
            return {}
        text = raw.strip()
        # 移除 markdown 代码块标记
        if text.startswith("```"):
            text = re.sub(r"^```\w*\n|```$", "", text).strip()
        # 提取 JSON 对象
        match = re.search(r"\{.*\}", text, re.S)
        if not match:
            return {}
        try:
            return json.loads(match.group(0))
        except Exception:
            return {}

    async def recommend_tools(self, user_message: str, provider_id: Optional[str] = None) -> Dict[str, Any]:
        """根据用户消息推荐工具"""
        try:
            # 构建工具目录字符串
            tool_catalog = "\n".join([
                f"- {t['id']}: {t['name']} (关键词: {', '.join(t['keywords'][:3])})"
                for t in self.TOOL_RECOMMENDATION_CATALOG
            ])
            system_prompt = self.TOOL_RECOMMEND_SYSTEM_PROMPT.format(tool_catalog=tool_catalog)

            result = await self.chat(
                user_message,
                system_prompt=system_prompt,
                provider_id=provider_id,
                web_search=False,
                thinking_enabled=False
            )

            if result.get('success'):
                parsed = self._parse_json_response(result.get('response', ''))
                tools = parsed.get('tools', [])
                # 验证工具 ID 是否有效
                valid_ids = {t['id'] for t in self.TOOL_RECOMMENDATION_CATALOG}
                valid_tools = [t for t in tools if t.get('id') in valid_ids]
                return {'tools': valid_tools[:3]}  # 最多返回 3 个

            return {'tools': []}

        except Exception as e:
            logger.warning(f"工具推荐失败: {e}")
            return {'tools': []}

    def recommend_tools_sync(self, user_message: str, provider_id: Optional[str] = None) -> Dict[str, Any]:
        """同步版本的工具推荐（用于非异步上下文）"""
        import asyncio
        try:
            loop = asyncio.get_event_loop()
            if loop.is_running():
                # 如果已有事件循环在运行，创建新线程执行
                import concurrent.futures
                with concurrent.futures.ThreadPoolExecutor() as executor:
                    future = executor.submit(
                        lambda: asyncio.run(self.recommend_tools(user_message, provider_id))
                    )
                    return future.result(timeout=30)
            else:
                return loop.run_until_complete(self.recommend_tools(user_message, provider_id))
        except Exception as e:
            logger.warning(f"同步工具推荐失败: {e}")
            return {'tools': []}
