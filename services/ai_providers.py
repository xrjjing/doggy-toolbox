# -*- coding: utf-8 -*-
"""
AI Provider 实现
支持 OpenAI、Claude、第三方兼容 API
"""

import httpx
import logging
import os
from typing import List, Dict, Any, Optional, AsyncIterator

logger = logging.getLogger(__name__)


class AIProvider:
    """AI 提供商基类"""

    def __init__(self, config: Dict[str, Any]):
        self.config = config
        self.provider_id = config.get('id')
        self.provider_type = config.get('type')
        self.provider_name = config.get('name')

    async def chat(self, messages: List[Dict], **kwargs) -> str:
        """同步对话接口"""
        raise NotImplementedError("子类必须实现 chat 方法")

    async def chat_stream(self, messages: List[Dict], **kwargs) -> AsyncIterator[str]:
        """流式对话接口"""
        raise NotImplementedError("子类必须实现 chat_stream 方法")

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

    async def chat(self, messages: List[Dict], model: Optional[str] = None, **kwargs) -> str:
        """对话接口"""
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

    async def chat_stream(self, messages: List[Dict], model: Optional[str] = None, **kwargs) -> AsyncIterator[str]:
        """流式响应"""
        url = f"{self.base_url.rstrip('/')}/chat/completions"
        headers = self._build_headers()

        payload = {
            'model': model or self.default_model,
            'messages': messages,
            'stream': True,
            **kwargs
        }

        async with httpx.AsyncClient(timeout=self.timeout) as client:
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


class ClaudeProvider(AIProvider):
    """Claude (Anthropic) API Provider"""

    def __init__(self, config: Dict[str, Any]):
        super().__init__(config)
        self.api_key = config.get('config', {}).get('api_key')
        self.base_url = config.get('config', {}).get('base_url', 'https://api.anthropic.com')
        self.api_version = config.get('config', {}).get('api_version', '2023-06-01')
        self.default_model = config.get('config', {}).get('default_model', 'claude-3-5-sonnet-20241022')
        self.timeout = config.get('config', {}).get('timeout', 60)

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

    async def chat(self, messages: List[Dict], model: Optional[str] = None, **kwargs) -> str:
        """Claude Messages API"""
        url = f"{self.base_url.rstrip('/')}/v1/messages"

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

        # 移除 OpenAI 特有参数
        claude_kwargs = {k: v for k, v in kwargs.items() if k in ['temperature', 'top_p', 'max_tokens']}
        payload.update(claude_kwargs)

        async with httpx.AsyncClient(timeout=self.timeout) as client:
            response = await client.post(url, headers=headers, json=payload)
            response.raise_for_status()
            data = response.json()

            return data['content'][0]['text']

    async def chat_stream(self, messages: List[Dict], model: Optional[str] = None, **kwargs) -> AsyncIterator[str]:
        """Claude 流式响应"""
        url = f"{self.base_url.rstrip('/')}/v1/messages"

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

        claude_kwargs = {k: v for k, v in kwargs.items() if k in ['temperature', 'top_p', 'max_tokens']}
        payload.update(claude_kwargs)

        async with httpx.AsyncClient(timeout=self.timeout) as client:
            async with client.stream('POST', url, headers=headers, json=payload) as response:
                response.raise_for_status()
                async for line in response.aiter_lines():
                    if line.startswith('data: '):
                        data_str = line[6:]
                        try:
                            import json
                            data = json.loads(data_str)
                            if data['type'] == 'content_block_delta':
                                delta = data['delta']
                                if delta['type'] == 'text_delta':
                                    yield delta['text']
                        except Exception as e:
                            logger.warning(f"解析流式数据失败: {e}")


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

    async def chat(self, messages: List[Dict], model: Optional[str] = None, **kwargs) -> str:
        """第三方兼容 API"""
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

    async def chat_stream(self, messages: List[Dict], model: Optional[str] = None, **kwargs) -> AsyncIterator[str]:
        """第三方兼容 API 流式响应"""
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

        async with httpx.AsyncClient(timeout=self.timeout, verify=self.verify_ssl) as client:
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
