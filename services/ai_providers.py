# -*- coding: utf-8 -*-
"""
AI Provider 实现
支持 OpenAI、Claude、第三方兼容 API
"""

import httpx
import logging
import os
from typing import List, Dict, Any, Optional, AsyncIterator, Tuple

from services import web_search

logger = logging.getLogger(__name__)


def _safe_json_loads(data_str: str) -> Optional[Dict[str, Any]]:
    """安全解析 JSON，失败返回 None。"""
    try:
        import json
        obj = json.loads(data_str)
        return obj if isinstance(obj, dict) else None
    except Exception:
        return None


async def _iter_sse_events(lines: AsyncIterator[str]) -> AsyncIterator[Dict[str, str]]:
    """
    解析 SSE（Server-Sent Events）事件流。

    说明：
    - 兼容 OpenAI ChatCompletions 风格（仅 data: 行）
    - 兼容 OpenAI Responses 风格（event: + data: 多行）
    - 每遇到空行输出一个完整事件：{'event': '...', 'data': '...'}
    """
    event_name = ""
    data_lines: List[str] = []

    async for raw_line in lines:
        # httpx 可能返回 None 或空字符串
        if raw_line is None:
            continue
        line = raw_line.rstrip("\r")

        # 事件分隔：空行
        if line == "":
            if data_lines:
                yield {
                    "event": event_name.strip(),
                    "data": "\n".join(data_lines),
                }
            event_name = ""
            data_lines = []
            continue

        # 注释行（心跳）忽略
        if line.startswith(":"):
            continue

        if line.startswith("event:"):
            event_name = line[len("event:"):].strip()
            continue

        if line.startswith("data:"):
            data_lines.append(line[len("data:"):].lstrip())
            continue

        # 容错：遇到不认识的行，按 data 处理
        data_lines.append(line)

    # 结束前如果还有残留事件，输出一次
    if data_lines:
        yield {
            "event": event_name.strip(),
            "data": "\n".join(data_lines),
        }


def _split_system_and_input_messages(messages: List[Dict]) -> Tuple[Optional[str], List[Dict]]:
    """
    将 OpenAI messages 转换为 Responses API 格式。

    Responses API 格式要求：
    - system 消息转为 role: "developer"
    - user/assistant 消息的 content 转为数组格式 [{"type": "input_text", "text": "..."}]
    """
    input_messages: List[Dict] = []

    for msg in messages:
        role = msg.get("role")
        content = msg.get("content", "")

        if role == "system":
            # system 消息转为 developer 角色
            if content:
                input_messages.append({
                    "role": "developer",
                    "content": str(content)
                })
        elif role == "user":
            # user 消息的 content 转为数组格式
            input_messages.append({
                "role": "user",
                "content": [{"type": "input_text", "text": str(content)}]
            })
        elif role == "assistant":
            # assistant 消息保持简单格式
            input_messages.append({
                "role": "assistant",
                "content": [{"type": "output_text", "text": str(content)}]
            })
        else:
            # 其他角色保持原样
            input_messages.append({"role": role, "content": content})

    return None, input_messages


def _extract_text_from_chat_completions(data: Dict[str, Any]) -> str:
    """从 ChatCompletions 响应中提取文本。"""
    choices = data.get("choices") or []
    if not choices:
        return ""
    first = choices[0] or {}
    message = first.get("message") or {}
    content = message.get("content")
    return content if isinstance(content, str) else ""


def _extract_text_from_responses(data: Dict[str, Any]) -> str:
    """从 Responses 响应中提取文本（尽量兼容多种形态）。"""
    output_text = data.get("output_text")
    if isinstance(output_text, str):
        return output_text

    # 兼容：output -> content blocks
    output = data.get("output")
    if isinstance(output, list):
        parts: List[str] = []
        for item in output:
            if not isinstance(item, dict):
                continue
            content_list = item.get("content")
            if not isinstance(content_list, list):
                continue
            for block in content_list:
                if not isinstance(block, dict):
                    continue
                block_type = block.get("type")
                if block_type in ("output_text", "text"):
                    text = block.get("text")
                    if isinstance(text, str) and text:
                        parts.append(text)
        return "".join(parts)

    return ""


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
    """
    OpenAI 风格 Provider（支持官方 OpenAI 与第三方兼容服务）。

    支持两种 API 格式：
    - chat_completions：/chat/completions
    - responses：/responses（支持 previous_response_id，SSE 事件风格不同）
    """

    def __init__(self, config: Dict[str, Any]):
        super().__init__(config)

        config_dict = config.get("config", {}) or {}
        compat = config.get("compatibility", {}) or {}

        # 重要：api_format 放在 config 中（默认 chat_completions）
        self.api_format = config_dict.get("api_format") or "chat_completions"
        if self.api_format not in ("chat_completions", "responses"):
            raise ValueError(f"不支持的 api_format: {self.api_format}")

        provider_type = config.get("type")

        api_key = config_dict.get("api_key")
        if not api_key and provider_type == "openai":
            api_key = os.environ.get("OPENAI_API_KEY")

        base_url = config_dict.get("base_url")
        if not base_url and provider_type == "openai":
            base_url = "https://api.openai.com/v1"

        self.api_key = api_key
        self.base_url = base_url
        self.default_model = config_dict.get("default_model")
        self.timeout = config_dict.get("timeout", 60)

        # OpenAI 官方额外 header（第三方一般可忽略，但不影响）
        self.organization = config_dict.get("organization")
        self.project = config_dict.get("project")

        # 兼容性配置（鉴权/端点/自定义头/SSL）
        self.endpoint = compat.get("endpoint")
        if not self.endpoint:
            self.endpoint = "/chat/completions" if self.api_format == "chat_completions" else "/responses"

        self.auth_header = compat.get("auth_header", "Authorization")
        self.auth_prefix = compat.get("auth_prefix", "Bearer ")
        self.custom_headers = compat.get("custom_headers", {}) or {}
        self.verify_ssl = compat.get("verify_ssl", True)

    def _build_headers(self) -> Dict[str, str]:
        """构建请求头（支持 OpenAI 官方与第三方兼容）。"""
        if not self.api_key:
            raise ValueError("未配置 API Key")

        headers = {
            self.auth_header: f"{self.auth_prefix}{self.api_key}",
            "Content-Type": "application/json",
        }

        # OpenAI 官方扩展头
        if self.organization:
            headers["OpenAI-Organization"] = self.organization
        if self.project:
            headers["OpenAI-Project"] = self.project

        headers.update(self.custom_headers)
        return headers

    def _build_url(self) -> str:
        """构建请求 URL。"""
        if not self.base_url:
            raise ValueError("未配置 Base URL")
        return f"{self.base_url.rstrip('/')}{self.endpoint}"

    def _build_payload_chat_completions(self, messages: List[Dict], model: Optional[str], stream: bool, **kwargs) -> Dict[str, Any]:
        payload: Dict[str, Any] = {
            "model": model or self.default_model,
            "messages": messages,
            **kwargs,
        }
        if stream:
            payload["stream"] = True
        return payload

    def _build_payload_responses(
        self,
        messages: List[Dict],
        model: Optional[str],
        stream: bool,
        previous_response_id: Optional[str],
        **kwargs,
    ) -> Dict[str, Any]:
        _, input_messages = _split_system_and_input_messages(messages)

        payload: Dict[str, Any] = {
            "model": model or self.default_model,
            "input": input_messages,
        }

        # Responses API 参数映射：max_tokens -> max_output_tokens
        if "max_tokens" in kwargs:
            payload["max_output_tokens"] = kwargs.pop("max_tokens")

        # 只保留 Responses API 支持的参数
        supported_params = {"temperature", "top_p", "max_output_tokens", "reasoning", "text"}
        for key, value in kwargs.items():
            if key in supported_params:
                payload[key] = value

        if previous_response_id:
            payload["previous_response_id"] = previous_response_id
        if stream:
            payload["stream"] = True
        return payload

    async def chat(self, messages: List[Dict], model: Optional[str] = None,
                   web_search_enabled: bool = False, previous_response_id: Optional[str] = None,
                   **kwargs) -> Dict[str, Any]:
        """统一对话接口：返回结构化结果（包含 text 与 response_id）。"""
        # 处理网络搜索
        messages = await self._prepare_messages_with_search(messages, web_search_enabled)

        url = self._build_url()
        headers = self._build_headers()

        if self.api_format == "chat_completions":
            payload = self._build_payload_chat_completions(messages, model=model, stream=False, **kwargs)
            async with httpx.AsyncClient(timeout=self.timeout, verify=self.verify_ssl) as client:
                response = await client.post(url, headers=headers, json=payload)
                response.raise_for_status()
                data = response.json()

                if not isinstance(data, dict):
                    raise ValueError(f"无法解析响应格式: {data}")

                text = _extract_text_from_chat_completions(data)
                return {
                    "success": True,
                    "api_format": self.api_format,
                    "text": text,
                    "response_id": data.get("id"),
                    "model": data.get("model") or (model or self.default_model),
                    "usage": data.get("usage"),
                    "raw": data,
                }
        else:
            # Responses API 即使 stream=false 也返回 SSE 格式，需要流式读取
            payload = self._build_payload_responses(
                messages,
                model=model,
                stream=True,  # 强制使用流式
                previous_response_id=previous_response_id,
                **kwargs,
            )

            text_parts: List[str] = []
            captured_response_id: Optional[str] = None
            captured_model: Optional[str] = None

            stream_timeout = httpx.Timeout(connect=30.0, read=300.0, write=30.0, pool=30.0)
            async with httpx.AsyncClient(timeout=stream_timeout, verify=self.verify_ssl) as client:
                async with client.stream('POST', url, headers=headers, json=payload) as response:
                    response.raise_for_status()
                    async for evt in _iter_sse_events(response.aiter_lines()):
                        data_str = (evt.get("data") or "").strip()
                        if not data_str or data_str == "[DONE]":
                            continue

                        data = _safe_json_loads(data_str)
                        if not data:
                            continue

                        # 捕获 response_id 和 model
                        if not captured_response_id:
                            resp_obj = data.get("response") if isinstance(data.get("response"), dict) else data
                            if isinstance(resp_obj.get("id"), str):
                                captured_response_id = resp_obj.get("id")
                            if isinstance(resp_obj.get("model"), str):
                                captured_model = resp_obj.get("model")

                        # 提取文本
                        event_name = (evt.get("event") or "").strip()
                        json_type = data.get("type") if isinstance(data.get("type"), str) else ""
                        effective_type = event_name or json_type

                        if "output_text.delta" in effective_type or effective_type.endswith(".delta"):
                            delta_text = data.get("delta") or data.get("text")
                            if isinstance(delta_text, str):
                                text_parts.append(delta_text)

                        # 容错：output_text 字段
                        fallback_text = data.get("output_text")
                        if isinstance(fallback_text, str) and fallback_text and not text_parts:
                            text_parts.append(fallback_text)

            return {
                "success": True,
                "api_format": self.api_format,
                "text": "".join(text_parts),
                "response_id": captured_response_id,
                "model": captured_model or (model or self.default_model),
                "usage": None,
                "raw": None,
            }

    async def chat_stream(self, messages: List[Dict], model: Optional[str] = None,
                          web_search_enabled: bool = False, previous_response_id: Optional[str] = None,
                          **kwargs) -> AsyncIterator[Dict[str, Any]]:
        """
        流式响应：统一输出结构化事件。

        事件格式：
        - {'type': 'delta', 'text': '...'}
        - {'type': 'completed', 'response_id': '...', 'api_format': '...'}
        - {'type': 'error', 'error': '...'}
        """
        logger.debug(f"ThirdParty chat_stream: web_search_enabled={web_search_enabled}, messages_count={len(messages)}")
        messages = await self._prepare_messages_with_search(messages, web_search_enabled)

        url = self._build_url()
        headers = self._build_headers()

        if self.api_format == "chat_completions":
            payload = self._build_payload_chat_completions(messages, model=model, stream=True, **kwargs)
        else:
            payload = self._build_payload_responses(
                messages,
                model=model,
                stream=True,
                previous_response_id=previous_response_id,
                **kwargs,
            )

        stream_timeout = httpx.Timeout(connect=30.0, read=300.0, write=30.0, pool=30.0)
        max_retries = 3
        last_error = None
        captured_response_id: Optional[str] = None

        for attempt in range(max_retries):
            try:
                async with httpx.AsyncClient(timeout=stream_timeout, verify=self.verify_ssl) as client:
                    async with client.stream('POST', url, headers=headers, json=payload) as response:
                        response.raise_for_status()
                        async for evt in _iter_sse_events(response.aiter_lines()):
                            data_str = (evt.get("data") or "").strip()
                            if not data_str:
                                continue

                            # ChatCompletions 常见结束标记
                            if data_str == "[DONE]":
                                yield {
                                    "type": "completed",
                                    "api_format": self.api_format,
                                    "response_id": captured_response_id,
                                }
                                return

                            data = _safe_json_loads(data_str)
                            if not data:
                                continue

                            # 尽早捕获 id（responses 里通常会出现）
                            if not captured_response_id and isinstance(data.get("id"), str):
                                captured_response_id = data.get("id")

                            if self.api_format == "chat_completions":
                                try:
                                    choices = data.get("choices") or []
                                    if not choices:
                                        continue
                                    delta = (choices[0] or {}).get("delta") or {}
                                    content = delta.get("content")
                                    if isinstance(content, str) and content:
                                        yield {"type": "delta", "text": content}
                                except Exception as e:
                                    logger.warning(f"解析流式数据失败: {e}")
                                    continue
                            else:
                                # Responses：事件名可能在 SSE 的 event:，也可能在 JSON 的 type 字段
                                event_name = (evt.get("event") or "").strip()
                                json_type = data.get("type") if isinstance(data.get("type"), str) else ""
                                effective_type = event_name or json_type

                                # 常见 delta 类型：response.output_text.delta
                                if "output_text.delta" in effective_type or effective_type.endswith(".delta"):
                                    delta_text = data.get("delta") or data.get("text")
                                    if isinstance(delta_text, str) and delta_text:
                                        yield {"type": "delta", "text": delta_text}
                                    continue

                                # 完成事件：response.completed / response.failed 等
                                if any(k in effective_type for k in ("response.completed", "response.failed", "response.cancelled")):
                                    yield {
                                        "type": "completed",
                                        "api_format": self.api_format,
                                        "response_id": captured_response_id,
                                        "status": effective_type,
                                    }
                                    return

                                # 容错：如果出现 output_text 字段，作为一次性输出（某些实现不发 delta）
                                fallback_text = data.get("output_text")
                                if isinstance(fallback_text, str) and fallback_text:
                                    yield {"type": "delta", "text": fallback_text}

                        # 正常结束但没遇到明确 completed
                        yield {
                            "type": "completed",
                            "api_format": self.api_format,
                            "response_id": captured_response_id,
                        }
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
        return ThirdPartyProvider(config)
    elif provider_type == 'claude':
        return ClaudeProvider(config)
    elif provider_type == 'openai-compatible':
        return ThirdPartyProvider(config)
    else:
        raise ValueError(f"不支持的 Provider 类型: {provider_type}")
