# -*- coding: utf-8 -*-
"""
AI Provider 实现
支持 OpenAI、Claude、第三方兼容 API
"""

import httpx
import logging
import os
from typing import List, Dict, Any, Optional, AsyncIterator

from services import web_search

logger = logging.getLogger(__name__)


class AIProvider:
    """AI 提供商基类"""

    def __init__(self, config: Dict[str, Any]):
        self.config = config
        self.provider_id = config.get('id')
        self.provider_type = config.get('type')
        self.provider_name = config.get('name')

    async def chat(self, messages: List[Dict], web_search_enabled: bool = False, **kwargs) -> str:
        """同步对话接口"""
        raise NotImplementedError("子类必须实现 chat 方法")

    async def chat_stream(self, messages: List[Dict], web_search_enabled: bool = False, **kwargs) -> AsyncIterator[str]:
        """流式对话接口"""
        raise NotImplementedError("子类必须实现 chat_stream 方法")

    async def _prepare_messages_with_search(self, messages: List[Dict], web_search_enabled: bool, search_results_out: List[Dict] = None) -> List[Dict]:
        """
        如果启用了网络搜索，执行搜索并注入结果到消息中

        Args:
            messages: 原始消息列表
            web_search_enabled: 是否启用网络搜索
            search_results_out: 可选，用于输出搜索结果的列表

        Returns:
            处理后的消息列表
        """
        if not web_search_enabled:
            return messages

        # 获取用户最后一条消息
        user_message = None
        for msg in reversed(messages):
            if msg.get('role') == 'user':
                user_message = msg.get('content', '')
                break

        if not user_message:
            return messages

        # 提取搜索关键词并执行搜索
        query = web_search.extract_search_query(user_message)
        if not query:
            return messages

        try:
            search_results = await web_search.search(query, max_results=5)
        except Exception as e:
            logger.warning(f"Provider 内搜索失败: {e}")
            return messages

        if not search_results:
            return messages

        # 输出搜索结果
        if search_results_out is not None:
            search_results_out.extend(search_results)

        # 格式化搜索结果
        search_context = web_search.format_search_results(search_results)

        # 注入搜索结果到消息中
        new_messages = []
        has_system = False

        for msg in messages:
            if msg.get('role') == 'system':
                new_content = msg.get('content', '') + "\n\n" + search_context
                new_messages.append({'role': 'system', 'content': new_content})
                has_system = True
            else:
                new_messages.append(msg)

        if not has_system:
            new_messages.insert(0, {'role': 'system', 'content': search_context})

        return new_messages

    def validate_config(self) -> bool:
        """验证配置有效性"""
        required_fields = ['api_key', 'base_url', 'default_model']
        config_dict = self.config.get('config', {})
        return all(config_dict.get(field) for field in required_fields)

    def get_capabilities(self) -> Dict[str, Any]:
        """获取 Provider 能力"""
        return self.config.get('capabilities', {})


class OpenAIProvider(AIProvider):
    """OpenAI 官方 API Provider（仅支持 API Key）"""

    def __init__(self, config: Dict[str, Any]):
        super().__init__(config)

        # 获取 API Key
        api_key = config.get('config', {}).get('api_key')
        if not api_key:
            api_key = os.environ.get("OPENAI_API_KEY")

        self.api_key = api_key
        self.base_url = config.get('config', {}).get('base_url', 'https://api.openai.com/v1')
        self.organization = config.get('config', {}).get('organization')
        self.project = config.get('config', {}).get('project')
        self.default_model = config.get('config', {}).get('default_model', 'gpt-4.1')
        self.timeout = config.get('config', {}).get('timeout', 120)

    def _build_headers(self) -> Dict[str, str]:
        """构建请求头"""
        if not self.api_key:
            raise ValueError("未配置 OpenAI API Key")

        headers = {
            'Authorization': f'Bearer {self.api_key}',
            'Content-Type': 'application/json'
        }
        if self.organization:
            headers['OpenAI-Organization'] = self.organization
        if self.project:
            headers['OpenAI-Project'] = self.project
        return headers

    async def chat(self, messages: List[Dict], model: Optional[str] = None,
                   web_search_enabled: bool = False, **kwargs) -> str:
        """对话接口"""
        # 处理网络搜索
        messages = await self._prepare_messages_with_search(messages, web_search_enabled)

        url = f"{self.base_url.rstrip('/')}/chat/completions"
        headers = self._build_headers()

        payload = {
            'model': model or self.default_model,
            'messages': messages,
            **kwargs
        }

        async with httpx.AsyncClient(timeout=self.timeout) as client:
            response = await client.post(url, headers=headers, json=payload)
            response.raise_for_status()
            data = response.json()
            return data['choices'][0]['message']['content']

    async def chat_stream(self, messages: List[Dict], model: Optional[str] = None,
                          web_search_enabled: bool = False, **kwargs) -> AsyncIterator[str]:
        """流式响应（带重试）"""
        logger.debug(f"OpenAI chat_stream: web_search_enabled={web_search_enabled}, messages_count={len(messages)}")
        messages = await self._prepare_messages_with_search(messages, web_search_enabled)

        url = f"{self.base_url.rstrip('/')}/chat/completions"
        headers = self._build_headers()

        payload = {
            'model': model or self.default_model,
            'messages': messages,
            'stream': True,
            **kwargs
        }

        stream_timeout = httpx.Timeout(connect=30.0, read=300.0, write=30.0, pool=30.0)
        max_retries = 3
        last_error = None

        for attempt in range(max_retries):
            try:
                async with httpx.AsyncClient(timeout=stream_timeout) as client:
                    async with client.stream('POST', url, headers=headers, json=payload) as response:
                        response.raise_for_status()
                        async for line in response.aiter_lines():
                            if line.startswith('data: '):
                                data_str = line[6:]
                                if data_str == '[DONE]':
                                    break
                                try:
                                    import json
                                    data = json.loads(data_str)
                                    delta = data['choices'][0]['delta']
                                    if 'content' in delta:
                                        yield delta['content']
                                except Exception as e:
                                    logger.warning(f"解析流式数据失败: {e}")
                        return
            except (httpx.ConnectError, httpx.ReadTimeout, httpx.ConnectTimeout) as e:
                last_error = e
                if attempt < max_retries - 1:
                    import asyncio
                    wait_time = (attempt + 1) * 2
                    logger.warning(f"连接失败，{wait_time}秒后重试 ({attempt + 1}/{max_retries}): {type(e).__name__}")
                    await asyncio.sleep(wait_time)
                    continue

        if last_error:
            raise ValueError(f"连接失败，已重试 {max_retries} 次: {type(last_error).__name__}") from last_error


class ClaudeProvider(AIProvider):
    """Claude (Anthropic) API Provider"""

    def __init__(self, config: Dict[str, Any]):
        super().__init__(config)
        self.api_key = config.get('config', {}).get('api_key')
        self.base_url = config.get('config', {}).get('base_url', 'https://api.anthropic.com')
        self.api_version = config.get('config', {}).get('api_version', '2023-06-01')
        self.default_model = config.get('config', {}).get('default_model', 'claude-3-5-sonnet-20241022')
        self.timeout = config.get('config', {}).get('timeout', 60)
        # 思考模式配置
        self.thinking_enabled = config.get('config', {}).get('thinking_enabled', False)
        self.thinking_budget = config.get('config', {}).get('thinking_budget', 2048)

    def _convert_messages(self, openai_messages: List[Dict]) -> tuple:
        """转换 OpenAI 格式消息为 Claude 格式"""
        system_prompt = None
        claude_messages = []

        for msg in openai_messages:
            role = msg['role']
            content = msg['content']

            if role == 'system':
                system_prompt = content
            elif role in ['user', 'assistant']:
                claude_messages.append({
                    'role': role,
                    'content': content
                })

        return system_prompt, claude_messages

    async def chat(self, messages: List[Dict], model: Optional[str] = None,
                   web_search_enabled: bool = False, thinking_enabled: Optional[bool] = None,
                   thinking_budget: Optional[int] = None, **kwargs) -> str:
        """Claude Messages API"""
        # 处理网络搜索
        messages = await self._prepare_messages_with_search(messages, web_search_enabled)

        # 智能 URL 构建：如果 base_url 已包含 /v1 或 /messages，不重复添加
        base = self.base_url.rstrip('/')
        if base.endswith('/v1/messages') or base.endswith('/messages'):
            url = base
        elif base.endswith('/v1'):
            url = f"{base}/messages"
        else:
            url = f"{base}/v1/messages"

        headers = {
            'x-api-key': self.api_key,
            'anthropic-version': self.api_version,
            'Content-Type': 'application/json'
        }

        system_prompt, claude_messages = self._convert_messages(messages)

        payload = {
            'model': model or self.default_model,
            'messages': claude_messages,
            'max_tokens': kwargs.get('max_tokens', 4096)
        }

        if system_prompt:
            payload['system'] = system_prompt

        # 思考模式：使用传入参数或配置中的默认值
        use_thinking = thinking_enabled if thinking_enabled is not None else self.thinking_enabled
        budget = thinking_budget if thinking_budget is not None else self.thinking_budget

        if use_thinking:
            payload['thinking'] = {
                'type': 'enabled',
                'budget_tokens': budget
            }
            logger.info(f"启用思考模式，预算: {budget} tokens")

        # 移除 OpenAI 特有参数
        claude_kwargs = {k: v for k, v in kwargs.items() if k in ['temperature', 'top_p', 'max_tokens']}
        payload.update(claude_kwargs)

        async with httpx.AsyncClient(timeout=self.timeout) as client:
            try:
                response = await client.post(url, headers=headers, json=payload)
                response.raise_for_status()
            except httpx.HTTPStatusError as e:
                # 尝试从响应体提取更详细的错误信息
                error_detail = None
                try:
                    error_data = e.response.json()
                except Exception:
                    error_data = None

                if isinstance(error_data, dict):
                    error_block = error_data.get('error')
                    if isinstance(error_block, dict):
                        error_detail = error_block.get('message') or error_block.get('detail')
                    if not error_detail:
                        error_detail = error_data.get('message') or error_data.get('detail')

                if error_detail:
                    raise ValueError(f"Claude API 错误: {error_detail}") from e
                raise

            data = response.json()

            # 解析响应：思考模式下可能有多个 content 块
            content_blocks = data.get('content', [])
            text_content = ""
            for block in content_blocks:
                if block.get('type') == 'text':
                    text_content = block.get('text', '')
                    break

            return text_content

    async def chat_stream(self, messages: List[Dict], model: Optional[str] = None,
                          web_search_enabled: bool = False, thinking_enabled: bool = False,
                          thinking_budget: int = 32000, **kwargs) -> AsyncIterator[str]:
        """Claude 流式响应（带重试）"""
        logger.debug(f"Claude chat_stream: web_search_enabled={web_search_enabled}, messages_count={len(messages)}")
        messages = await self._prepare_messages_with_search(messages, web_search_enabled)

        base = self.base_url.rstrip('/')
        if base.endswith('/v1/messages') or base.endswith('/messages'):
            url = base
        elif base.endswith('/v1'):
            url = f"{base}/messages"
        else:
            url = f"{base}/v1/messages"

        headers = {
            'x-api-key': self.api_key,
            'anthropic-version': self.api_version,
            'Content-Type': 'application/json'
        }

        system_prompt, claude_messages = self._convert_messages(messages)

        payload = {
            'model': model or self.default_model,
            'messages': claude_messages,
            'max_tokens': kwargs.get('max_tokens', 4096),
            'stream': True
        }

        if system_prompt:
            payload['system'] = system_prompt

        # 思考模式
        if thinking_enabled:
            payload['thinking'] = {
                'type': 'enabled',
                'budget_tokens': thinking_budget
            }
            logger.info(f"流式请求启用思考模式，预算: {thinking_budget} tokens")

        claude_kwargs = {k: v for k, v in kwargs.items() if k in ['temperature', 'top_p', 'max_tokens']}
        payload.update(claude_kwargs)

        stream_timeout = httpx.Timeout(connect=30.0, read=300.0, write=30.0, pool=30.0)
        max_retries = 3
        last_error = None

        for attempt in range(max_retries):
            try:
                async with httpx.AsyncClient(timeout=stream_timeout) as client:
                    async with client.stream('POST', url, headers=headers, json=payload) as response:
                        if response.status_code >= 400:
                            error_body = await response.aread()
                            error_detail = None
                            try:
                                import json
                                error_data = json.loads(error_body)
                                if isinstance(error_data, dict):
                                    error_block = error_data.get('error')
                                    if isinstance(error_block, dict):
                                        error_detail = error_block.get('message') or error_block.get('detail')
                                    if not error_detail:
                                        error_detail = error_data.get('message') or error_data.get('detail')
                            except Exception:
                                pass
                            if error_detail:
                                raise ValueError(f"Claude API 错误: {error_detail}")
                            response.raise_for_status()

                        async for line in response.aiter_lines():
                            if line.startswith('data: '):
                                data_str = line[6:]
                                try:
                                    import json
                                    data = json.loads(data_str)
                                    event_type = data.get('type', '')
                                    if event_type == 'content_block_delta':
                                        delta = data.get('delta', {})
                                        delta_type = delta.get('type', '')
                                        if delta_type == 'text_delta':
                                            yield delta['text']
                                except Exception as e:
                                    logger.warning(f"解析流式数据失败: {e}")
                        return
            except (httpx.ConnectError, httpx.ReadTimeout, httpx.ConnectTimeout) as e:
                last_error = e
                if attempt < max_retries - 1:
                    import asyncio
                    wait_time = (attempt + 1) * 2
                    logger.warning(f"连接失败，{wait_time}秒后重试 ({attempt + 1}/{max_retries}): {type(e).__name__}")
                    await asyncio.sleep(wait_time)
                    continue
            except httpx.HTTPStatusError as e:
                error_detail = None
                try:
                    error_data = e.response.json()
                except Exception:
                    error_data = None

                if isinstance(error_data, dict):
                    error_block = error_data.get('error')
                    if isinstance(error_block, dict):
                        error_detail = error_block.get('message') or error_block.get('detail')
                    if not error_detail:
                        error_detail = error_data.get('message') or error_data.get('detail')

                if error_detail:
                    raise ValueError(f"Claude API 错误: {error_detail}") from e
                raise

        if last_error:
            raise ValueError(f"连接失败，已重试 {max_retries} 次: {type(last_error).__name__}") from last_error


class ThirdPartyProvider(AIProvider):
    """第三方 OpenAI 兼容 API Provider"""

    def __init__(self, config: Dict[str, Any]):
        super().__init__(config)
        self.api_key = config.get('config', {}).get('api_key')
        self.base_url = config.get('config', {}).get('base_url')
        self.default_model = config.get('config', {}).get('default_model')
        self.timeout = config.get('config', {}).get('timeout', 60)

        # 兼容性配置
        compat = config.get('compatibility', {})
        self.endpoint = compat.get('endpoint', '/chat/completions')
        self.auth_header = compat.get('auth_header', 'Authorization')
        self.auth_prefix = compat.get('auth_prefix', 'Bearer ')
        self.custom_headers = compat.get('custom_headers', {})
        self.verify_ssl = compat.get('verify_ssl', True)

    async def chat(self, messages: List[Dict], model: Optional[str] = None,
                   web_search_enabled: bool = False, **kwargs) -> str:
        """第三方兼容 API"""
        # 处理网络搜索
        messages = await self._prepare_messages_with_search(messages, web_search_enabled)

        url = f"{self.base_url.rstrip('/')}{self.endpoint}"

        headers = {
            self.auth_header: f"{self.auth_prefix}{self.api_key}",
            'Content-Type': 'application/json'
        }
        headers.update(self.custom_headers)

        payload = {
            'model': model or self.default_model,
            'messages': messages,
            **kwargs
        }

        async with httpx.AsyncClient(timeout=self.timeout, verify=self.verify_ssl) as client:
            response = await client.post(url, headers=headers, json=payload)
            response.raise_for_status()
            data = response.json()

            # 尝试标准 OpenAI 格式
            try:
                return data['choices'][0]['message']['content']
            except (KeyError, IndexError):
                # 尝试其他常见格式
                if 'response' in data:
                    return data['response']
                elif 'text' in data:
                    return data['text']
                else:
                    raise ValueError(f"无法解析响应格式: {data}")

    async def chat_stream(self, messages: List[Dict], model: Optional[str] = None,
                          web_search_enabled: bool = False, **kwargs) -> AsyncIterator[str]:
        """第三方兼容 API 流式响应（带重试）"""
        logger.debug(f"ThirdParty chat_stream: web_search_enabled={web_search_enabled}, messages_count={len(messages)}")
        messages = await self._prepare_messages_with_search(messages, web_search_enabled)

        url = f"{self.base_url.rstrip('/')}{self.endpoint}"

        headers = {
            self.auth_header: f"{self.auth_prefix}{self.api_key}",
            'Content-Type': 'application/json'
        }
        headers.update(self.custom_headers)

        payload = {
            'model': model or self.default_model,
            'messages': messages,
            'stream': True,
            **kwargs
        }

        stream_timeout = httpx.Timeout(connect=30.0, read=300.0, write=30.0, pool=30.0)
        max_retries = 3
        last_error = None

        for attempt in range(max_retries):
            try:
                async with httpx.AsyncClient(timeout=stream_timeout, verify=self.verify_ssl) as client:
                    async with client.stream('POST', url, headers=headers, json=payload) as response:
                        response.raise_for_status()
                        async for line in response.aiter_lines():
                            if line.startswith('data: '):
                                data_str = line[6:]
                                if data_str == '[DONE]':
                                    break
                                try:
                                    import json
                                    data = json.loads(data_str)
                                    delta = data['choices'][0]['delta']
                                    if 'content' in delta:
                                        yield delta['content']
                                except Exception as e:
                                    logger.warning(f"解析流式数据失败: {e}")
                        return
            except (httpx.ConnectError, httpx.ReadTimeout, httpx.ConnectTimeout) as e:
                last_error = e
                if attempt < max_retries - 1:
                    import asyncio
                    wait_time = (attempt + 1) * 2
                    logger.warning(f"连接失败，{wait_time}秒后重试 ({attempt + 1}/{max_retries}): {type(e).__name__}")
                    await asyncio.sleep(wait_time)
                    continue

        if last_error:
            raise ValueError(f"连接失败，已重试 {max_retries} 次: {type(last_error).__name__}") from last_error


def create_provider(config: Dict[str, Any]) -> AIProvider:
    """工厂方法：根据配置创建对应的 Provider"""
    provider_type = config.get('type')

    if provider_type == 'openai':
        return OpenAIProvider(config)
    elif provider_type == 'claude':
        return ClaudeProvider(config)
    elif provider_type == 'openai-compatible':
        return ThirdPartyProvider(config)
    else:
        raise ValueError(f"不支持的 Provider 类型: {provider_type}")
