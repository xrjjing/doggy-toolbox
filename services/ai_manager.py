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
                    {'id': 'tool-json', 'name': 'JSON 格式化', 'features': ['generate', 'fix']},
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
                   provider_id: Optional[str] = None, **kwargs) -> Dict[str, Any]:
        """统一的对话接口"""
        pid = provider_id or self.active_provider_id
        provider = self.get_provider(pid)

        # 构建消息
        messages = []
        if system_prompt:
            messages.append({"role": "system", "content": system_prompt})
        messages.append({"role": "user", "content": prompt})

        # 执行请求
        start_time = time.time()
        request_id = str(uuid.uuid4())

        try:
            result = await provider.chat(messages, **kwargs)
            latency = time.time() - start_time

            # 更新统计
            self._update_stats(pid, success=True, latency=latency)

            return {
                'success': True,
                'response': result,
                'request_id': request_id,
                'provider_id': pid,
                'latency': latency
            }

        except Exception as e:
            latency = time.time() - start_time
            self._update_stats(pid, success=False, latency=latency)
            logger.error(f"AI 请求失败: {e}")
            raise e

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
