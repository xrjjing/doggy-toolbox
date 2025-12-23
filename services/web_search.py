# -*- coding: utf-8 -*-
"""
Web Search Service
使用 DuckDuckGo 提供网络搜索功能
"""

import logging
from typing import List, Dict, Any, Optional
from concurrent.futures import ThreadPoolExecutor

logger = logging.getLogger(__name__)

# 线程池用于异步执行同步的 DuckDuckGo 搜索
_executor = ThreadPoolExecutor(max_workers=2)


def _search_sync(query: str, max_results: int = 5, region: str = 'wt-wt') -> List[Dict[str, Any]]:
    """
    同步搜索（内部使用）

    Args:
        query: 搜索关键词
        max_results: 最大结果数量
        region: 搜索区域，默认 wt-wt（全球）以获得更好的结果
    """
    try:
        from duckduckgo_search import DDGS
        import time

        # 重试机制，最多重试 3 次
        for attempt in range(3):
            try:
                results = []
                with DDGS() as ddgs:
                    for r in ddgs.text(query, region=region, max_results=max_results):
                        results.append({
                            'title': r.get('title', ''),
                            'url': r.get('href', ''),
                            'snippet': r.get('body', '')
                        })

                if results:
                    return results

                # 如果没有结果，等待后重试
                if attempt < 2:
                    logger.warning(f"搜索无结果，第 {attempt + 1} 次重试...")
                    time.sleep(0.5)

            except Exception as e:
                if attempt < 2:
                    logger.warning(f"搜索出错，第 {attempt + 1} 次重试: {e}")
                    time.sleep(0.5)
                else:
                    raise

        return results

    except ImportError:
        logger.error("duckduckgo-search 库未安装，请运行: pip install duckduckgo-search")
        return []
    except Exception as e:
        logger.error(f"搜索失败: {e}")
        return []


async def search(query: str, max_results: int = 5, region: str = 'wt-wt') -> List[Dict[str, Any]]:
    """
    异步执行网络搜索

    Args:
        query: 搜索关键词
        max_results: 最大结果数量
        region: 搜索区域，默认 wt-wt（全球）

    Returns:
        搜索结果列表，每项包含 title, url, snippet
    """
    import asyncio
    from functools import partial
    loop = asyncio.get_event_loop()
    func = partial(_search_sync, query, max_results, region)
    return await loop.run_in_executor(_executor, func)


def format_search_results(results: List[Dict[str, Any]], max_length: int = 2000) -> str:
    """
    格式化搜索结果为可注入 prompt 的文本

    Args:
        results: 搜索结果列表
        max_length: 最大文本长度

    Returns:
        格式化后的搜索结果文本
    """
    if not results:
        return ""

    lines = ["以下是相关的网络搜索结果，请基于这些信息回答用户问题：", ""]

    for i, r in enumerate(results, 1):
        title = r.get('title', '无标题')
        url = r.get('url', '')
        snippet = r.get('snippet', '')

        # 截断过长的摘要
        if len(snippet) > 300:
            snippet = snippet[:300] + "..."

        lines.append(f"[{i}] {title}")
        if url:
            lines.append(f"    链接: {url}")
        if snippet:
            lines.append(f"    摘要: {snippet}")
        lines.append("")

    text = "\n".join(lines)

    # 如果超过最大长度，截断
    if len(text) > max_length:
        text = text[:max_length] + "\n...(搜索结果已截断)"

    return text


def extract_search_query(user_message: str) -> str:
    """
    从用户消息中提取搜索关键词
    简单实现：直接使用用户消息，去除常见的搜索指令词

    Args:
        user_message: 用户原始消息

    Returns:
        提取后的搜索关键词
    """
    # 去除常见的搜索指令词
    remove_phrases = [
        '搜索一下', '搜一下', '帮我搜', '帮我查', '查一下', '查询一下',
        '请搜索', '请查询', '网上搜', '上网查', '百度一下', '谷歌一下',
        'search for', 'search', 'look up', 'find'
    ]

    query = user_message.strip()
    for phrase in remove_phrases:
        query = query.replace(phrase, '')

    return query.strip()
