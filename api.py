"""PyWebView API - 暴露给前端的接口"""
import logging
import os
import json
import sys
from pathlib import Path
from typing import List

from services import ComputerUsageService, NodeConverterService
from services.http_collections import HttpCollectionsService
from services.ai_manager import AIManager

logger = logging.getLogger(__name__)


class Api:
    def __init__(self, data_dir: Path):
        self.data_dir = data_dir
        self.data_dir.mkdir(parents=True, exist_ok=True)

        # 数据布局兼容策略（A 方案）：旧版与新版都能读
        # - 旧版（legacy）：文件在 data_dir 根目录
        # - 新版（structured）：文件在 data_dir/电脑使用 与 data_dir/转化节点
        # - 混合（hybrid）：按“旧优先、存在优先”逐文件选择
        paths = self._resolve_data_paths(self.data_dir)
        self._data_paths = paths

        # 注意：这里不强制迁移/复制用户文件，只做路径选择与兼容读取
        self.computer_usage = ComputerUsageService(
            data_dir=self.data_dir,
            commands_file=paths["commands_file"],
            credentials_file=paths["credentials_file"],
            tabs_file=paths["tabs_file"],
        )
        self.node_converter = NodeConverterService(
            data_dir=self.data_dir,
            nodes_file=paths["nodes_file"],
        )
        self.http_collections = HttpCollectionsService(
            data_dir=self.data_dir / "HTTP请求"
        )

        # AI Manager - 使用独立的 AI配置 文件夹
        self.ai_manager = AIManager(self.data_dir / "AI配置")

        self._window = None

    @staticmethod
    def _resolve_data_paths(data_dir: Path) -> dict:
        """解析数据文件真实路径（旧版/新版/混合兼容）。"""
        legacy_root = data_dir
        structured_computer = data_dir / "电脑使用"
        structured_nodes = data_dir / "转化节点"

        legacy_commands = legacy_root / "commands.json"
        legacy_credentials = legacy_root / "credentials.json"
        legacy_tabs = legacy_root / "command_tabs.json"
        legacy_nodes = legacy_root / "nodes.md"

        structured_commands = structured_computer / "commands.json"
        structured_credentials = structured_computer / "credentials.json"
        structured_tabs = structured_computer / "command_tabs.json"
        structured_nodes_file = structured_nodes / "nodes.md"

        legacy_any = any(p.exists() for p in (legacy_commands, legacy_credentials, legacy_tabs))
        prefer_legacy_computer = legacy_any
        prefer_legacy_nodes = legacy_nodes.exists()

        def pick(primary: Path, secondary: Path, fallback: Path) -> Path:
            # 存在优先：两者都存在时返回 primary（用于“旧优先”）
            if primary.exists():
                return primary
            if secondary.exists():
                return secondary
            return fallback

        # 电脑使用：如果检测到旧版任意文件存在，则整体偏向旧版根目录
        computer_fallback_dir = legacy_root if prefer_legacy_computer else structured_computer
        commands_file = pick(
            legacy_commands,
            structured_commands,
            computer_fallback_dir / "commands.json",
        )
        credentials_file = pick(
            legacy_credentials,
            structured_credentials,
            computer_fallback_dir / "credentials.json",
        )
        tabs_file = pick(
            legacy_tabs,
            structured_tabs,
            computer_fallback_dir / "command_tabs.json",
        )

        # 转化节点：有旧 nodes.md 就用旧，否则用新版子目录
        nodes_fallback_dir = legacy_root if prefer_legacy_nodes else structured_nodes
        nodes_file = pick(
            legacy_nodes,
            structured_nodes_file,
            nodes_fallback_dir / "nodes.md",
        )

        return {
            "commands_file": commands_file,
            "credentials_file": credentials_file,
            "tabs_file": tabs_file,
            "nodes_file": nodes_file,
        }

    def set_window(self, window):
        """设置窗口引用"""
        self._window = window

    def __dir__(self):
        """限制暴露成员，避免 pywebview 深度遍历内部 Path 导致噪声日志"""
        # 仅暴露公开方法（避免把内部/迁移等“私有方法”暴露给前端）
        return [
            name
            for name, val in self.__class__.__dict__.items()
            if callable(val) and not name.startswith("_")
        ]

    def get_runtime_info(self):
        """获取运行时信息（用于排查“按钮无效/数据未识别”等问题）。"""
        def _p(path: Path) -> str:
            try:
                return str(path)
            except Exception:
                return ""

        paths = getattr(self, "_data_paths", {}) or {}
        info = {
            "data_dir": _p(self.data_dir),
            "paths": {k: _p(v) for k, v in paths.items()},
            "exists": {k: bool(v.exists()) for k, v in paths.items() if isinstance(v, Path)},
        }
        try:
            info["stats"] = self.get_data_stats()
        except Exception as e:
            info["stats_error"] = str(e)
        return info

    # ========== 窗口控制 ==========
    def window_close(self):
        """关闭窗口"""
        import threading
        import os

        def force_exit():
            """延迟强制退出，给 destroy 一点时间清理"""
            import time
            time.sleep(0.5)
            os._exit(0)

        # 启动强制退出线程作为保底
        threading.Thread(target=force_exit, daemon=True).start()

        # 尝试正常关闭窗口
        if self._window:
            self._window.destroy()

    def window_minimize(self):
        """最小化窗口"""
        if self._window:
            self._window.minimize()

    def window_toggle_fullscreen(self):
        """切换全屏/最大化"""
        if self._window:
            self._window.toggle_fullscreen()

    # ========== 页签管理 ==========
    def get_tabs(self):
        return self.computer_usage.get_tabs()

    def add_tab(self, name: str):
        return self.computer_usage.add_tab(name)

    def update_tab(self, id: str, name: str):
        return self.computer_usage.update_tab(id, name)

    def delete_tab(self, id: str):
        return self.computer_usage.delete_tab(id)

    def reorder_tabs(self, tab_ids: List[str]):
        return self.computer_usage.reorder_tabs(tab_ids)

    # ========== 命令块管理 ==========
    def get_commands(self):
        return self.computer_usage.get_commands()

    def get_commands_by_tab(self, tab_id: str):
        return self.computer_usage.get_commands_by_tab(tab_id)

    def add_command(self, title: str, description: str, commands: List[str], tab_id: str = "0", tags: List[str] = None):
        return self.computer_usage.add_command(title, description, commands, tab_id, tags)

    def update_command(self, id: str, title: str, description: str, commands: List[str], tab_id: str = None, tags: List[str] = None):
        return self.computer_usage.update_command(id, title, description, commands, tab_id, tags)

    def move_command_to_tab(self, cmd_id: str, target_tab_id: str):
        return self.computer_usage.move_command_to_tab(cmd_id, target_tab_id)

    def delete_command(self, id: str):
        return self.computer_usage.delete_command(id)

    def reorder_commands(self, tab_id: str, command_ids: List[str]):
        return self.computer_usage.reorder_commands(tab_id, command_ids)

    def import_commands(self, text: str):
        return self.computer_usage.import_commands_txt(text)

    # ========== 凭证管理 ==========
    def get_credentials(self):
        return self.computer_usage.get_credentials()

    def add_credential(self, service: str, url: str, account: str, password: str, extra: List[str] = None):
        return self.computer_usage.add_credential(service, url, account, password, extra)

    def update_credential(self, id: str, service: str, url: str, account: str, password: str, extra: List[str] = None):
        return self.computer_usage.update_credential(id, service, url, account, password, extra)

    def delete_credential(self, id: str):
        return self.computer_usage.delete_credential(id)

    def import_credentials(self, text: str):
        return self.computer_usage.import_credentials_txt(text)

    def reorder_credentials(self, credential_ids: List[str]):
        return self.computer_usage.reorder_credentials(credential_ids)

    # ========== 节点转换 ==========
    def convert_links(self, links_text: str):
        return self.node_converter.convert_links(links_text)

    def fetch_subscription(self, url: str):
        return self.node_converter.fetch_subscription(url)

    # ========== 节点管理 ==========
    def get_nodes(self):
        return self.node_converter.get_nodes()

    def save_node(self, name: str, node_type: str, server: str, port: int, raw_link: str, yaml_config: str):
        return self.node_converter.save_node(name, node_type, server, port, raw_link, yaml_config)

    def delete_node(self, id: str):
        return self.node_converter.delete_node(id)

    # ========== HTTP 请求集合管理 ==========
    def get_http_collections(self):
        return self.http_collections.get_collections()

    def add_http_collection(self, name: str, description: str = ""):
        return self.http_collections.add_collection(name, description)

    def delete_http_collection(self, collection_id: str):
        return self.http_collections.delete_collection(collection_id)

    def add_http_folder(self, collection_id: str, name: str, parent_path: List[str] = None, level: int = 1):
        return self.http_collections.add_folder(collection_id, name, parent_path, level)

    def add_http_request(self, collection_id: str, request_data: dict, folder_path: List[str] = None):
        return self.http_collections.add_request(collection_id, request_data, folder_path)

    def update_http_request(self, collection_id: str, request_id: str, request_data: dict):
        return self.http_collections.update_request(collection_id, request_id, request_data)

    def delete_http_request(self, collection_id: str, request_id: str):
        return self.http_collections.delete_request(collection_id, request_id)

    def import_postman_collection(self, postman_data: dict):
        return self.http_collections.import_postman(postman_data)

    def import_apifox_collection(self, apifox_data: dict):
        return self.http_collections.import_apifox(apifox_data)

    def import_openapi_collection(self, openapi_data: dict):
        return self.http_collections.import_openapi(openapi_data)

    def open_collection_file_dialog(self):
        """打开文件选择对话框，选择集合 JSON 文件"""
        import webview

        if not self._window:
            return {"success": False, "error": "窗口未初始化"}

        try:
            file_types = ['JSON 文件 (*.json)', '所有文件 (*.*)']
            result = self._window.create_file_dialog(
                webview.OPEN_DIALOG,
                file_types=file_types,
            )

            if result and len(result) > 0:
                file_path = Path(result[0])
                if not file_path.exists():
                    return {"success": False, "error": "文件不存在"}

                # 读取文件内容
                content = file_path.read_text(encoding="utf-8")
                return {
                    "success": True,
                    "fileName": file_path.name,
                    "content": content
                }
            else:
                return {"success": False, "error": "未选择文件"}

        except Exception as e:
            logger.error(f"打开文件对话框失败: {e}")
            return {"success": False, "error": str(e)}

    # ========== 系统配置 ==========
    def get_theme(self):
        """获取保存的主题设置"""
        config_path = self.data_dir / "config.json"
        if config_path.exists():
            try:
                with open(config_path, "r", encoding="utf-8") as f:
                    config = json.load(f)
                    return config.get("theme", "dark")
            except Exception:
                pass
        return "dark"

    def save_theme(self, theme: str):
        """保存主题设置"""
        config_path = self.data_dir / "config.json"
        config = {}
        if config_path.exists():
            try:
                with open(config_path, "r", encoding="utf-8") as f:
                    config = json.load(f)
            except Exception:
                pass
        config["theme"] = theme
        try:
            with open(config_path, "w", encoding="utf-8") as f:
                json.dump(config, f, ensure_ascii=False, indent=2)
            return True
        except Exception:
            return False

    def get_glass_mode(self):
        """获取毛玻璃模式设置"""
        config_path = self.data_dir / "config.json"
        if config_path.exists():
            try:
                with open(config_path, "r", encoding="utf-8") as f:
                    config = json.load(f)
                    return config.get("glass_mode", False)
            except Exception:
                pass
        return False

    def save_glass_mode(self, enabled: bool):
        """保存毛玻璃模式设置"""
        config_path = self.data_dir / "config.json"
        config = {}
        if config_path.exists():
            try:
                with open(config_path, "r", encoding="utf-8") as f:
                    config = json.load(f)
            except Exception:
                pass
        config["glass_mode"] = enabled
        try:
            with open(config_path, "w", encoding="utf-8") as f:
                json.dump(config, f, ensure_ascii=False, indent=2)
            return True
        except Exception:
            return False

    def get_glass_opacity(self):
        """获取毛玻璃透明度设置"""
        config_path = self.data_dir / "config.json"
        if config_path.exists():
            try:
                with open(config_path, "r", encoding="utf-8") as f:
                    config = json.load(f)
                    return config.get("glass_opacity", 60)
            except Exception:
                pass
        return 60

    def save_glass_opacity(self, opacity: int):
        """保存毛玻璃透明度设置"""
        config_path = self.data_dir / "config.json"
        config = {}
        if config_path.exists():
            try:
                with open(config_path, "r", encoding="utf-8") as f:
                    config = json.load(f)
            except Exception:
                pass
        config["glass_opacity"] = opacity
        try:
            with open(config_path, "w", encoding="utf-8") as f:
                json.dump(config, f, ensure_ascii=False, indent=2)
            return True
        except Exception:
            return False

    def get_titlebar_mode(self):
        """获取标题栏模式设置"""
        config_path = self.data_dir / "config.json"
        if config_path.exists():
            try:
                with open(config_path, "r", encoding="utf-8") as f:
                    config = json.load(f)
                    return config.get("titlebar_mode", "fixed")
            except Exception:
                pass
        return "fixed"

    def save_titlebar_mode(self, mode: str):
        """保存标题栏模式设置"""
        config_path = self.data_dir / "config.json"
        config = {}
        if config_path.exists():
            try:
                with open(config_path, "r", encoding="utf-8") as f:
                    config = json.load(f)
            except Exception:
                pass
        config["titlebar_mode"] = mode
        try:
            with open(config_path, "w", encoding="utf-8") as f:
                json.dump(config, f, ensure_ascii=False, indent=2)
            return True
        except Exception:
            return False

    def get_accent_color(self):
        """获取标题栏颜色设置"""
        config_path = self.data_dir / "config.json"
        if config_path.exists():
            try:
                with open(config_path, "r", encoding="utf-8") as f:
                    config = json.load(f)
                    return config.get("accent_color", "")
            except Exception:
                pass
        return ""

    def save_accent_color(self, color: str):
        """保存标题栏颜色设置"""
        config_path = self.data_dir / "config.json"
        config = {}
        if config_path.exists():
            try:
                with open(config_path, "r", encoding="utf-8") as f:
                    config = json.load(f)
            except Exception:
                pass
        config["accent_color"] = color
        try:
            with open(config_path, "w", encoding="utf-8") as f:
                json.dump(config, f, ensure_ascii=False, indent=2)
            return True
        except Exception:
            return False

    # ========== 数据备份与恢复 ==========
    def export_data(self):
        """导出所有数据为 JSON 格式"""
        from datetime import datetime

        data = {
            "version": "1.0",
            "exported_at": datetime.now().isoformat(),
            "app": "狗狗百宝箱",
            "data": {
                "tabs": self.computer_usage.get_tabs(),
                "commands": self.computer_usage.get_commands(),
                "credentials": self.computer_usage.get_credentials(),
                "nodes": self.node_converter.get_nodes(),
                "theme": self.get_theme()
            }
        }
        return data

    def import_data(self, json_data: dict):
        """从 JSON 数据导入（覆盖现有数据）"""
        try:
            if not isinstance(json_data, dict) or "data" not in json_data:
                return {"success": False, "error": "无效的备份数据格式"}

            data = json_data["data"]
            imported = {"tabs": 0, "commands": 0, "credentials": 0, "nodes": 0}

            # 导入页签
            if "tabs" in data and isinstance(data["tabs"], list):
                tabs_file = self.computer_usage.tabs_file
                tabs_file.write_text(json.dumps(data["tabs"], ensure_ascii=False, indent=2), encoding="utf-8")
                imported["tabs"] = len(data["tabs"])

            # 导入命令
            if "commands" in data and isinstance(data["commands"], list):
                cmds_file = self.computer_usage.commands_file
                cmds_file.write_text(json.dumps(data["commands"], ensure_ascii=False, indent=2), encoding="utf-8")
                imported["commands"] = len(data["commands"])

            # 导入凭证
            if "credentials" in data and isinstance(data["credentials"], list):
                creds_file = self.computer_usage.credentials_file
                creds_file.write_text(json.dumps(data["credentials"], ensure_ascii=False, indent=2), encoding="utf-8")
                imported["credentials"] = len(data["credentials"])

            # 导入节点（格式与 _save_nodes_md 保持一致）
            if "nodes" in data and isinstance(data["nodes"], list):
                nodes = data["nodes"]
                lines = ["# 代理节点", ""]
                for node in nodes:
                    # 类型校验：跳过非 dict 项
                    if not isinstance(node, dict):
                        continue
                    # 安全处理：移除换行符防止 Markdown 注入
                    name = str(node.get('name', 'Unknown')).replace('\n', ' ').replace('\r', '')
                    node_type = str(node.get('type', '')).replace('\n', ' ')
                    server = str(node.get('server', '')).replace('\n', ' ')
                    port = str(node.get('port', '')).replace('\n', ' ')
                    raw_link = str(node.get('raw_link', '')).replace('\n', ' ').replace('`', '')

                    lines.append(f"## {name}")
                    lines.append("")
                    lines.append(f"- **类型**: {node_type}")
                    lines.append(f"- **服务器**: {server}")
                    lines.append(f"- **端口**: {port}")
                    if raw_link:
                        lines.append(f"- **链接**: `{raw_link}`")

                    # 安全处理 config/yaml
                    config = node.get("config")
                    if isinstance(config, dict):
                        yaml_content = config.get("yaml")
                        if isinstance(yaml_content, str) and yaml_content.strip():
                            # 移除可能破坏代码块的独立 ``` 行
                            safe_yaml = yaml_content.replace('\n```', '\n` ` `')
                            lines.append("")
                            lines.append("```yaml")
                            lines.append(safe_yaml)
                            lines.append("```")
                    lines.append("")
                self.node_converter.nodes_file.write_text("\n".join(lines), encoding="utf-8")
                imported["nodes"] = len([n for n in nodes if isinstance(n, dict)])

            # 导入主题
            if "theme" in data:
                self.save_theme(data["theme"])

            return {"success": True, "imported": imported}
        except Exception as e:
            return {"success": False, "error": str(e)}

    def get_data_stats(self):
        """获取数据统计信息"""
        return {
            "tabs": len(self.computer_usage.get_tabs()),
            "commands": len(self.computer_usage.get_commands()),
            "credentials": len(self.computer_usage.get_credentials()),
            "nodes": len(self.node_converter.get_nodes())
        }

    # ========== HTTP 请求代理 ==========
    def http_request(self, method: str, url: str, headers: dict = None, body: str = None, timeout: int = 30):
        """
        代理 HTTP 请求，解决前端 CORS 限制。

        Args:
            method: HTTP 方法 (GET, POST, PUT, DELETE, PATCH, HEAD, OPTIONS)
            url: 请求 URL
            headers: 请求头字典
            body: 请求体字符串
            timeout: 超时时间（秒）

        Returns:
            dict: {success, status, statusText, headers, body, duration}
        """
        import urllib.request
        import urllib.error
        import time

        try:
            start_time = time.time()

            # 构建请求
            req = urllib.request.Request(url, method=method.upper())

            # 添加请求头
            if headers:
                for key, value in headers.items():
                    req.add_header(key, value)

            # 添加请求体
            data = None
            if body and method.upper() in ('POST', 'PUT', 'PATCH'):
                data = body.encode('utf-8')

            # 发送请求
            with urllib.request.urlopen(req, data=data, timeout=timeout) as response:
                end_time = time.time()
                duration = int((end_time - start_time) * 1000)

                # 读取响应
                response_body = response.read().decode('utf-8', errors='replace')
                response_headers = dict(response.getheaders())

                return {
                    "success": True,
                    "status": response.status,
                    "statusText": response.reason,
                    "headers": response_headers,
                    "body": response_body,
                    "duration": duration
                }

        except urllib.error.HTTPError as e:
            end_time = time.time()
            duration = int((end_time - start_time) * 1000)

            # HTTP 错误也返回响应内容
            try:
                error_body = e.read().decode('utf-8', errors='replace')
            except Exception:
                error_body = ""

            return {
                "success": True,  # HTTP 错误也算请求成功
                "status": e.code,
                "statusText": e.reason,
                "headers": dict(e.headers) if e.headers else {},
                "body": error_body,
                "duration": duration
            }

        except urllib.error.URLError as e:
            return {
                "success": False,
                "error": f"连接失败: {str(e.reason)}"
            }

        except Exception as e:
            return {
                "success": False,
                "error": str(e)
            }

    # ========== 文件保存对话框 ==========
    def save_file_dialog(self, *args, **kwargs):
        """
        打开保存文件对话框，让用户选择保存位置。
        使用 *args 捕获所有参数以处理 pywebview 的各种参数传递方式。

        Returns:
            dict: {success: bool, path: str|None, error: str|None}
        """
        import webview

        if not self._window:
            return {"success": False, "error": "窗口未初始化"}

        try:
            # ========= 参数归一化（兼容不同 pywebview 版本/前端封装差异）=========
            # pywebview 通常会把 JS 的入参序列化后按位置参数传入 Python：
            # - JS: api.f(a, b)         -> Python: args=(a, b)
            # 但在某些封装/版本中可能变成：
            # - JS: api.f(a, b)         -> Python: args=((a, b),)   （参数被额外包了一层）
            # - JS: api.f({content,...})-> Python: args=({'content':...},)
            raw_args = args
            raw_kwargs = kwargs

            def _safe_preview(value, *, max_len: int = 160):
                """
                生成用于日志的“安全预览”，避免把 content 等大字段直接打印出来。
                仅用于调试，不保证可逆。
                """
                try:
                    if value is None:
                        return None
                    if isinstance(value, str):
                        if len(value) <= max_len:
                            return value
                        return f"<str len={len(value)}>"
                    if isinstance(value, bytes):
                        return f"<bytes len={len(value)}>"
                    if isinstance(value, dict):
                        keys = sorted(str(k) for k in value.keys())
                        return {"_type": "dict", "keys": keys[:50], "keys_len": len(keys)}
                    if isinstance(value, (list, tuple)):
                        elem_types = [type(v).__name__ for v in value[:10]]
                        return {
                            "_type": type(value).__name__,
                            "len": len(value),
                            "elem_types_preview": elem_types,
                        }
                    return f"<{type(value).__name__}>"
                except Exception:
                    return f"<{type(value).__name__} preview_failed>"

            debug_enabled = os.environ.get("DOGGY_TOOLBOX_DEBUG_FILE_DIALOG") == "1"
            if debug_enabled:
                logger.setLevel(logging.DEBUG)
                logger.debug(
                    "save_file_dialog 收到 raw_args=%s raw_kwargs=%s",
                    [_safe_preview(v) for v in raw_args],
                    {k: _safe_preview(v) for k, v in raw_kwargs.items()},
                )
                # 兜底：如果日志未配置 handler，至少能在终端看到调试信息
                if not logger.handlers and not logging.getLogger().handlers:
                    print(
                        "[DEBUG] save_file_dialog 收到参数:",
                        {"raw_args": [_safe_preview(v) for v in raw_args], "raw_kwargs_keys": sorted(list(raw_kwargs.keys()))},
                        file=sys.stderr,
                    )

            def _looks_like_param_container(value) -> bool:
                """判断 value 是否像“装了参数的容器”（list/tuple 且长度合理）。"""
                return isinstance(value, (list, tuple)) and 1 <= len(value) <= 3

            # 处理“单个 dict 作为参数对象”的情况：save_file_dialog({content, default_filename, file_types})
            if len(args) == 1 and not kwargs and isinstance(args[0], dict):
                kwargs = args[0]
                args = ()

            # 处理“单个 list/tuple 装了多个位置参数”的情况：args=((content, filename),)
            if len(args) == 1 and not kwargs and _looks_like_param_container(args[0]):
                args = tuple(args[0])

            def _to_text(value) -> str:
                """把 JS 传入的各种类型安全转换为文本。"""
                if value is None:
                    return ""
                if isinstance(value, bytes):
                    try:
                        return value.decode("utf-8")
                    except Exception:
                        return value.decode("utf-8", errors="replace")
                if isinstance(value, str):
                    return value
                # 常见场景：前端可能传对象/数组，兜底转 JSON 文本
                if isinstance(value, (dict, list, tuple)):
                    try:
                        return json.dumps(value, ensure_ascii=False)
                    except Exception:
                        return str(value)
                return str(value)

            def _to_filename(value) -> str:
                """把文件名参数安全转换为字符串。"""
                if value is None:
                    return "file.txt"
                # 防御：有些错误封装会传 ('name.txt',) 这种单元素容器
                if isinstance(value, (list, tuple)) and len(value) == 1:
                    value = value[0]
                value = str(value).strip()
                return value if value else "file.txt"

            def _infer_file_types_from_filename(name: str):
                """根据文件扩展名推断 file_types（pywebview 期望：('描述 (*.ext[;*.ext])', ...)）。"""
                ext = name.rsplit(".", 1)[-1].lower() if "." in name else ""
                if ext == "json":
                    return ("JSON 文件 (*.json)",)
                if ext == "html":
                    return ("HTML 文件 (*.html)",)
                if ext == "csv":
                    return ("CSV 文件 (*.csv)",)
                if ext == "txt":
                    return ("文本文件 (*.txt)",)
                return ("所有文件 (*.*)",)

            def _normalize_file_types(value, fallback_filename: str):
                """
                归一化 file_types：
                - pywebview（当前版本）期望：('描述 (*.ext[;*.ext])', ...) —— 每项必须是字符串
                - 兼容旧格式输入：
                  - ('描述', '*.json')
                  - [('描述', '*.json'), ('所有文件', '*.*')]
                  - {'描述': '*.json'}  （会转为 ('描述 (*.json)',)）
                  - 额外嵌套一层: ((('描述','*.json'),),) 等
                """
                if value is None:
                    return _infer_file_types_from_filename(fallback_filename)

                # 单元素嵌套：反复剥一层，直到不是“单元素容器”
                while isinstance(value, (list, tuple)) and len(value) == 1:
                    value = value[0]

                def _as_filter_string(desc, pattern) -> str:
                    desc = str(desc).strip()
                    # 兼容旧写法：调用方可能把 desc 直接写成完整过滤器字符串，例如 "JSON 文件 (*.json)"
                    # 此时忽略 pattern，直接返回 desc，避免生成 "JSON 文件 (*.json) (*.json)" 这种无效格式。
                    if "(" in desc and ")" in desc and "*" in desc:
                        return desc
                    if isinstance(pattern, (list, tuple)):
                        pattern = ";".join(str(p).strip() for p in pattern)
                    pattern = str(pattern).strip()
                    # 容错：有些调用方可能把 pattern 写成 "(*.json)" 或 "*.json; *.txt"
                    pattern = pattern.strip("()").replace(" ", "")
                    return f"{desc} ({pattern})" if desc else f"所有文件 ({pattern})"

                if isinstance(value, dict):
                    value = [(_as_filter_string(k, v)) for k, v in value.items()]

                # 单个过滤器字符串
                if isinstance(value, str):
                    value = (value,)

                # 单个 (desc, pattern) 对
                if isinstance(value, (list, tuple)) and len(value) == 2 and isinstance(value[0], str):
                    value = (_as_filter_string(value[0], value[1]),)

                if not isinstance(value, (list, tuple)):
                    # 兜底：当成一个 pattern
                    return (f"所有文件 ({str(value).strip()})",)

                candidates: list[str] = []
                for item in value:
                    if isinstance(item, (list, tuple)) and len(item) == 1:
                        item = item[0]

                    if isinstance(item, str):
                        candidates.append(item)
                        continue

                    if isinstance(item, (list, tuple)) and len(item) == 2:
                        candidates.append(_as_filter_string(item[0], item[1]))
                        continue

                    # 跳过不可识别项，避免传进 pywebview 后在内部正则处报 tuple/type 错
                    continue

                # 预校验：避免 pywebview 内部 parse_file_type 直接抛错
                valid: list[str] = []
                try:
                    from webview.util import parse_file_type as _parse_file_type

                    for f in candidates:
                        try:
                            _parse_file_type(str(f))
                            valid.append(str(f))
                        except Exception:
                            continue
                except Exception:
                    # 极端情况（导入失败）则不做预校验，但仍保证元素为 str
                    valid = [str(f) for f in candidates if isinstance(f, str)]

                return tuple(valid) if valid else _infer_file_types_from_filename(fallback_filename)

            # 解析参数（位置参数优先，但 kwargs 可覆盖）
            content = args[0] if len(args) >= 1 else ""
            default_filename = args[1] if len(args) >= 2 else "file.txt"
            file_types = args[2] if len(args) >= 3 else None

            # 支持多种命名：content / filename / default_filename / save_filename
            content = kwargs.get("content", content)
            default_filename = kwargs.get("default_filename", default_filename)
            default_filename = kwargs.get("filename", default_filename)
            default_filename = kwargs.get("save_filename", default_filename)
            file_types = kwargs.get("file_types", file_types)

            content_text = _to_text(content)
            default_filename_text = _to_filename(default_filename)
            file_types_norm = _normalize_file_types(file_types, default_filename_text)

            if debug_enabled:
                logger.debug(
                    "save_file_dialog 归一化结果 default_filename=%r file_types=%s",
                    default_filename_text,
                    list(file_types_norm),
                )

            # 打开保存对话框
            result = self._window.create_file_dialog(
                webview.SAVE_DIALOG,
                save_filename=default_filename_text,
                file_types=file_types_norm,
            )

            if result:
                # macOS 上 result 通常是元组，取第一个元素
                file_path = result[0] if isinstance(result, (tuple, list)) else result
                # 写入文件
                file_path_str = str(file_path)
                Path(file_path_str).write_text(content_text, encoding="utf-8")
                return {"success": True, "path": file_path_str}
            else:
                return {"success": False, "error": "用户取消了保存"}

        except Exception as e:
            # 不回传具体内容，避免日志/前端提示包含大段文本；仅提供类型信息辅助排查
            debug = {
                "args_types": [type(v).__name__ for v in raw_args],
                "kwargs_keys": sorted(list(raw_kwargs.keys())),
            }
            return {"success": False, "error": str(e), "debug": debug}

    def save_binary_file_dialog(self, base64_data: str, default_filename: str = "file.bin", file_types: list = None):
        """
        保存二进制文件（如图片）到用户选择的位置。

        Args:
            base64_data: Base64 编码的二进制数据
            default_filename: 默认文件名
            file_types: 文件类型过滤器

        Returns:
            dict: {success: bool, path: str|None, error: str|None}
        """
        import webview
        import base64

        if not self._window:
            return {"success": False, "error": "窗口未初始化"}

        try:
            # 解码 base64 数据
            binary_data = base64.b64decode(base64_data)

            # 推断文件类型
            if file_types is None:
                ext = default_filename.rsplit(".", 1)[-1].lower() if "." in default_filename else ""
                if ext == "png":
                    file_types = ("PNG 图片 (*.png)",)
                elif ext in ("jpg", "jpeg"):
                    file_types = ("JPEG 图片 (*.jpg;*.jpeg)",)
                elif ext == "gif":
                    file_types = ("GIF 图片 (*.gif)",)
                else:
                    file_types = ("所有文件 (*.*)",)
            elif isinstance(file_types, list):
                # 归一化 file_types
                normalized = []
                for ft in file_types:
                    if isinstance(ft, (list, tuple)) and len(ft) == 2:
                        normalized.append(f"{ft[0]} ({ft[1]})")
                    elif isinstance(ft, str):
                        normalized.append(ft)
                file_types = tuple(normalized) if normalized else ("所有文件 (*.*)",)

            # 打开保存对话框
            result = self._window.create_file_dialog(
                webview.SAVE_DIALOG,
                save_filename=default_filename,
                file_types=file_types,
            )

            if result:
                file_path = result[0] if isinstance(result, (tuple, list)) else result
                file_path_str = str(file_path)
                # 写入二进制文件
                Path(file_path_str).write_bytes(binary_data)
                return {"success": True, "path": file_path_str}
            else:
                return {"success": False, "error": "用户取消了保存"}

        except Exception as e:
            return {"success": False, "error": str(e)}

    def open_image_file_dialog(self):
        """
        打开图片文件选择对话框。

        Returns:
            dict: {success: bool, data: str|None, filename: str|None, mimetype: str|None, error: str|None}
                  data 为 Base64 编码的图片内容
        """
        import webview
        import base64
        import mimetypes

        if not self._window:
            return {"success": False, "error": "窗口未初始化"}

        try:
            file_types = ("图片文件 (*.png;*.jpg;*.jpeg;*.gif;*.webp;*.bmp;*.ico;*.svg)",)

            result = self._window.create_file_dialog(
                webview.OPEN_DIALOG,
                file_types=file_types,
            )

            if result and len(result) > 0:
                file_path = result[0] if isinstance(result, (tuple, list)) else result
                file_path_str = str(file_path)

                # 读取文件内容
                with open(file_path_str, "rb") as f:
                    binary_data = f.read()

                # Base64 编码
                base64_data = base64.b64encode(binary_data).decode("utf-8")

                # 获取 MIME 类型
                mimetype, _ = mimetypes.guess_type(file_path_str)
                if not mimetype:
                    ext = file_path_str.rsplit(".", 1)[-1].lower()
                    mime_map = {
                        "png": "image/png",
                        "jpg": "image/jpeg",
                        "jpeg": "image/jpeg",
                        "gif": "image/gif",
                        "webp": "image/webp",
                        "bmp": "image/bmp",
                        "ico": "image/x-icon",
                        "svg": "image/svg+xml",
                    }
                    mimetype = mime_map.get(ext, "application/octet-stream")

                # 获取文件名
                filename = Path(file_path_str).name

                return {
                    "success": True,
                    "data": base64_data,
                    "filename": filename,
                    "mimetype": mimetype,
                    "size": len(binary_data),
                }
            else:
                return {"success": False, "error": "用户取消了选择"}

        except Exception as e:
            return {"success": False, "error": str(e)}

    # ========== AI 配置管理 ==========
    def get_ai_providers(self):
        """获取所有 AI Provider 列表"""
        try:
            return self.ai_manager.get_available_providers()
        except Exception as e:
            logger.error(f"获取 AI Provider 列表失败: {e}")
            return []

    def fetch_ai_models(self, temp_config: dict):
        """动态获取 AI 模型列表"""
        import asyncio
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        try:
            models = loop.run_until_complete(self.ai_manager.fetch_models(temp_config))
            return {
                'success': True,
                'models': models
            }
        except Exception as e:
            logger.error(f"获取模型列表失败: {e}")
            return {
                'success': False,
                'error': str(e)
            }
        finally:
            loop.close()

    def test_ai_connection(self, temp_config: dict):
        """测试 AI Provider 连接"""
        import asyncio
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        try:
            result = loop.run_until_complete(self.ai_manager.test_connection(temp_config))
            return result
        except Exception as e:
            logger.error(f"测试连接失败: {e}")
            return {
                'success': False,
                'error': str(e)
            }
        finally:
            loop.close()

    def save_ai_provider(self, provider_config: dict):
        """保存 AI Provider 配置"""
        return self.ai_manager.save_provider(provider_config)

    def delete_ai_provider(self, provider_id: str):
        """删除 AI Provider"""
        return self.ai_manager.delete_provider(provider_id)

    def switch_ai_provider(self, provider_id: str):
        """切换当前使用的 AI Provider"""
        try:
            self.ai_manager.switch_provider(provider_id)
            return {'success': True}
        except Exception as e:
            logger.error(f"切换 Provider 失败: {e}")
            return {'success': False, 'error': str(e)}

    def ai_chat(self, prompt: str, system_prompt: str = None, provider_id: str = None, **kwargs):
        """AI 对话接口"""
        import asyncio
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        try:
            result = loop.run_until_complete(
                self.ai_manager.chat(prompt, system_prompt, provider_id, **kwargs)
            )
            return result
        except Exception as e:
            logger.error(f"AI 对话失败: {e}")
            return {'success': False, 'error': str(e)}
        finally:
            loop.close()
