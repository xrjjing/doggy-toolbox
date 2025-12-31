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
from services.chat_history import ChatHistoryService
from services.prompt_template import PromptTemplateService

logger = logging.getLogger(__name__)


class Api:
    # 流式聊天会话超时时间（秒）
    CHAT_SESSION_TTL_SECONDS = 300  # 5 分钟

    def __init__(self, data_dir: Path, debug_mode: bool = False):
        self.data_dir = data_dir
        self.data_dir.mkdir(parents=True, exist_ok=True)
        self._debug_mode = debug_mode

        # 统一数据库初始化（必须最先完成）
        from services.db_manager import DatabaseManager
        db_path = self.data_dir / "doggy_toolbox.db"
        self.db = DatabaseManager(db_path)
        logger.info(f"数据库初始化完成: {db_path}")

        # 数据布局兼容策略（A 方案）：旧版与新版都能读
        # - 旧版（legacy）：文件在 data_dir 根目录
        # - 新版（structured）：文件在 data_dir/电脑使用 与 data_dir/转化节点
        # - 混合（hybrid）：按"旧优先、存在优先"逐文件选择
        paths = self._resolve_data_paths(self.data_dir)
        self._data_paths = paths

        # 注意：这里不强制迁移/复制用户文件，只做路径选择与兼容读取
        self.computer_usage = ComputerUsageService(
            data_dir=self.data_dir,
            commands_file=paths["commands_file"],
            credentials_file=paths["credentials_file"],
            tabs_file=paths["tabs_file"],
            db=self.db,
        )
        self.node_converter = NodeConverterService(
            data_dir=self.data_dir,
            nodes_file=paths["nodes_file"],
        )
        self.http_collections = HttpCollectionsService(
            data_dir=self.data_dir,
            db=self.db,
        )

        # AI Manager - 迁移后使用根目录
        self.ai_manager = AIManager(self.data_dir, db=self.db)

        # 聊天历史服务
        self.chat_history = None
        try:
            if self.ai_manager.db:
                self.chat_history = ChatHistoryService(self.ai_manager.db)
        except Exception as e:
            logger.warning(f"聊天历史服务初始化失败: {e}")

        # Prompt 模板服务
        self.prompt_template = None
        try:
            if self.ai_manager.db:
                self.prompt_template = PromptTemplateService(self.ai_manager.db)
        except Exception as e:
            logger.warning(f"Prompt 模板服务初始化失败: {e}")

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

    def is_debug_mode(self):
        """检查当前是否为调试模式"""
        return {'debug': self._debug_mode}

    def open_devtools(self):
        """打开开发者工具"""
        if not self._debug_mode:
            return {'success': False, 'message': '请使用 python main.py -d 启动应用以启用调试模式'}
        if self._window:
            self._window.evaluate_js('console.log("DevTools opened")')
        return {'success': True, 'message': '已启用调试模式，请右键点击页面选择"检查元素"'}

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

    def save_node(self, name: str, node_type: str, server: str, port: int, raw_link: str, yaml_config: str, tags: list = None):
        return self.node_converter.save_node(name, node_type, server, port, raw_link, yaml_config, tags)

    def delete_node(self, id: str):
        return self.node_converter.delete_node(id)

    def update_node_tags(self, node_id: str, tags: list):
        """更新节点标签"""
        return self.node_converter.update_node_tags(node_id, tags)

    def get_nodes_by_tag(self, tag: str):
        """根据标签筛选节点"""
        return self.node_converter.get_nodes_by_tag(tag)

    def get_all_node_tags(self):
        """获取所有节点标签"""
        return self.node_converter.get_all_tags()

    def batch_import_subscriptions(self, urls: list):
        """批量导入订阅链接"""
        return self.node_converter.batch_import_subscriptions(urls)

    def validate_node(self, node: dict):
        """验证节点配置"""
        return self.node_converter.validate_node(node)

    def validate_all_nodes(self, nodes: list):
        """批量验证节点"""
        return self.node_converter.validate_all_nodes(nodes)

    def generate_node_share_link(self, node: dict):
        """生成节点分享链接"""
        link = self.node_converter.generate_share_link(node)
        return {"success": True, "link": link} if link else {"success": False, "error": "不支持的节点类型"}

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

    def export_openapi_collection(self, collection_id: str = None):
        """导出 HTTP 集合为 OpenAPI 3.0 格式"""
        try:
            result = self.http_collections.export_openapi(collection_id)
            if isinstance(result, dict) and result.get("error"):
                return {"success": False, "error": result["error"]}
            return {"success": True, "data": result}
        except Exception as e:
            logger.error(f"导出 OpenAPI 失败: {e}")
            return {"success": False, "error": str(e)}

    def export_postman_collection(self, collection_id: str = None):
        """导出 HTTP 集合为 Postman Collection v2.1 格式"""
        try:
            result = self.http_collections.export_postman(collection_id)
            if isinstance(result, dict) and result.get("error"):
                return {"success": False, "error": result["error"]}
            return {"success": True, "data": result}
        except Exception as e:
            logger.error(f"导出 Postman 失败: {e}")
            return {"success": False, "error": str(e)}

    # ========== HTTP 环境变量 ==========
    def get_http_environments(self):
        """获取所有 HTTP 环境变量"""
        return self.http_collections.get_environments()

    def get_active_http_environment(self):
        """获取当前活跃的 HTTP 环境"""
        return self.http_collections.get_active_environment()

    def create_http_environment(self, name: str, variables: list = None):
        """创建 HTTP 环境"""
        return self.http_collections.create_environment(name, variables)

    def update_http_environment(self, env_id: str, name: str = None, variables: list = None):
        """更新 HTTP 环境"""
        return self.http_collections.update_environment(env_id, name, variables)

    def delete_http_environment(self, env_id: str):
        """删除 HTTP 环境"""
        return self.http_collections.delete_environment(env_id)

    def set_active_http_environment(self, env_id: str = None):
        """设置活跃的 HTTP 环境"""
        return self.http_collections.set_active_environment(env_id)

    def replace_http_variables(self, text: str, env_id: str = None):
        """替换文本中的环境变量"""
        return self.http_collections.replace_variables(text, env_id)

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
        if self.ai_manager.db:
            return self.ai_manager.db.get_app_config("theme", "dark")
        return "dark"

    def save_theme(self, theme: str):
        """保存主题设置"""
        if self.ai_manager.db:
            return self.ai_manager.db.set_app_config("theme", theme)
        return False

    def get_glass_mode(self):
        """获取毛玻璃模式设置"""
        if self.ai_manager.db:
            return self.ai_manager.db.get_app_config("glass_mode", False)
        return False

    def save_glass_mode(self, enabled: bool):
        """保存毛玻璃模式设置"""
        if self.ai_manager.db:
            return self.ai_manager.db.set_app_config("glass_mode", enabled)
        return False

    def get_glass_opacity(self):
        """获取毛玻璃透明度设置"""
        if self.ai_manager.db:
            return self.ai_manager.db.get_app_config("glass_opacity", 60)
        return 60

    def save_glass_opacity(self, opacity: int):
        """保存毛玻璃透明度设置"""
        if self.ai_manager.db:
            return self.ai_manager.db.set_app_config("glass_opacity", opacity)
        return False

    def get_titlebar_mode(self):
        """获取标题栏模式设置"""
        if self.ai_manager.db:
            return self.ai_manager.db.get_app_config("titlebar_mode", "fixed")
        return "fixed"

    def save_titlebar_mode(self, mode: str):
        """保存标题栏模式设置"""
        if self.ai_manager.db:
            return self.ai_manager.db.set_app_config("titlebar_mode", mode)
        return False

    def get_ui_scale(self):
        """获取 UI 缩放设置"""
        if self.ai_manager.db:
            return self.ai_manager.db.get_app_config("ui_scale", None)
        return None

    def save_ui_scale(self, scale: int):
        """保存 UI 缩放设置"""
        if self.ai_manager.db:
            return self.ai_manager.db.set_app_config("ui_scale", scale)
        return False

    def get_accent_color(self):
        """获取标题栏颜色设置"""
        if self.ai_manager.db:
            return self.ai_manager.db.get_app_config("accent_color", "")
        return ""

    def save_accent_color(self, color: str):
        """保存标题栏颜色设置"""
        if self.ai_manager.db:
            return self.ai_manager.db.set_app_config("accent_color", color)
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

            # 导入页签（使用数据库）
            tab_id_map = {}  # 旧 id → 新 id 映射
            if "tabs" in data and isinstance(data["tabs"], list):
                # 先清空现有页签（保留默认页签）
                existing_tabs = self.computer_usage.get_tabs()
                for tab in existing_tabs:
                    if tab.get('id') != '0':  # 保留默认页签
                        self.computer_usage.delete_tab(tab['id'])
                # 导入新页签并建立映射
                for tab in data["tabs"]:
                    if isinstance(tab, dict):
                        old_id = tab.get('id', '0')
                        if old_id == '0':
                            tab_id_map[old_id] = '0'  # 默认页签直接映射
                        else:
                            new_tab = self.computer_usage.add_tab(tab.get('name', '未命名'))
                            tab_id_map[old_id] = new_tab['id']  # 记录新 id
                imported["tabs"] = len(data["tabs"])

            # 导入命令（使用数据库）
            if "commands" in data and isinstance(data["commands"], list):
                # 先清空现有命令
                existing_cmds = self.computer_usage.get_commands()
                for cmd in existing_cmds:
                    self.computer_usage.delete_command(cmd['id'])
                # 导入新命令（使用映射后的 tab_id）
                for cmd in data["commands"]:
                    if isinstance(cmd, dict):
                        old_tab_id = cmd.get('tab_id', '0')
                        new_tab_id = tab_id_map.get(old_tab_id, '0')  # 使用映射，默认回退到 '0'
                        self.computer_usage.add_command(
                            title=cmd.get('title', ''),
                            description=cmd.get('description', ''),
                            commands=cmd.get('commands', []),
                            tab_id=new_tab_id,
                            tags=cmd.get('tags', [])
                        )
                imported["commands"] = len(data["commands"])

            # 导入凭证（使用数据库）
            if "credentials" in data and isinstance(data["credentials"], list):
                # 先清空现有凭证
                existing_creds = self.computer_usage.get_credentials()
                for cred in existing_creds:
                    self.computer_usage.delete_credential(cred['id'])
                # 导入新凭证
                for cred in data["credentials"]:
                    if isinstance(cred, dict):
                        self.computer_usage.add_credential(
                            service=cred.get('service', ''),
                            url=cred.get('url', ''),
                            account=cred.get('account', ''),
                            password=cred.get('password', ''),
                            extra=cred.get('extra', [])
                        )
                imported["credentials"] = len(data["credentials"])

            # 导入节点（使用数据库）
            if "nodes" in data and isinstance(data["nodes"], list):
                # 先清空现有节点
                existing_nodes = self.node_converter.get_nodes()
                for node in existing_nodes:
                    self.node_converter.delete_node(node['id'])
                # 导入新节点
                for node in data["nodes"]:
                    if isinstance(node, dict):
                        config = node.get('config', {})
                        yaml_config = config.get('yaml', '') if isinstance(config, dict) else ''
                        self.node_converter.save_node(
                            name=node.get('name', 'Unknown'),
                            node_type=node.get('type', ''),
                            server=node.get('server', ''),
                            port=node.get('port', 0),
                            raw_link=node.get('raw_link', ''),
                            yaml_config=yaml_config
                        )
                imported["nodes"] = len([n for n in data["nodes"] if isinstance(n, dict)])

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

    def ai_chat(self, prompt: str, system_prompt: str = None, provider_id: str = None,
                web_search: bool = False, thinking_enabled: bool = False, **kwargs):
        """
        AI 对话接口（工具 AI 使用）

        注意：工具 AI 功能默认关闭网络搜索和思考模式，以提高响应速度
        """
        import asyncio
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        try:
            result = loop.run_until_complete(
                self.ai_manager.chat(
                    prompt, system_prompt, provider_id,
                    web_search=web_search,
                    thinking_enabled=thinking_enabled,
                    **kwargs
                )
            )
            return result
        except Exception as e:
            logger.error(f"AI 对话失败: {e}")
            return {'success': False, 'error': str(e)}
        finally:
            loop.close()

    def _cleanup_chat_sessions(self):
        """清理超时的流式聊天会话，防止内存泄漏"""
        import time

        if not hasattr(self, '_chat_sessions') or not hasattr(self, '_chat_sessions_lock'):
            return

        now = time.monotonic()
        expired_ids = []

        with self._chat_sessions_lock:
            for session_id, session in list(self._chat_sessions.items()):
                last_access = session.get('last_access', now)
                if now - last_access > self.CHAT_SESSION_TTL_SECONDS:
                    expired_ids.append(session_id)

            # 删除超时的会话
            for session_id in expired_ids:
                del self._chat_sessions[session_id]

        if expired_ids:
            logger.info(f"清理了 {len(expired_ids)} 个超时的聊天会话")

    def ai_chat_stream(self, message: str, history: list = None, provider_id: str = None,
                        mode: str = 'chat', tool_recommend: bool = True, conversation_id: str = None,
                        web_search_enabled: bool = False, thinking_enabled: bool = False):
        """
        AI 流式对话接口（适配 PyWebView）

        由于 PyWebView 不支持原生流式返回，这里采用轮询方案：
        1. 启动后台任务开始流式请求
        2. 返回 session_id
        3. 前端通过 get_chat_chunk(session_id) 轮询获取增量内容

        Args:
            message: 用户消息
            history: 历史对话记录 [{"role": "user/assistant", "content": "..."}]
            provider_id: Provider ID（可选，默认使用当前启用的）
            mode: 对话模式 ('chat' 普通对话, 'explain' 解释模式)
            tool_recommend: 是否启用工具推荐
            conversation_id: 持久化会话 ID（可选，不传则创建新会话）
            web_search_enabled: 是否启用网络搜索（前端控制）
            thinking_enabled: 是否启用思考模式（前端控制，仅 Claude 有效）

        Returns:
            {"success": True, "session_id": "...", "conversation_id": "...", "tool_recommendations": {...}, "search_results": [...]}
        """
        import asyncio
        import threading
        import time
        import uuid
        from collections import deque
        from services import web_search

        # 生成流式会话 ID（临时，用于轮询）
        session_id = str(uuid.uuid4())

        # 初始化会话字典和线程锁
        if not hasattr(self, '_chat_sessions'):
            self._chat_sessions = {}
        if not hasattr(self, '_chat_sessions_lock'):
            self._chat_sessions_lock = threading.Lock()

        # 清理超时的旧会话
        self._cleanup_chat_sessions()

        # 获取 Provider 配置
        pid = provider_id or self.ai_manager.active_provider_id
        provider_config = self.ai_manager._get_provider_config(pid)

        # 网络搜索：直接同步执行，避免事件循环问题
        search_results = []
        search_attempted = False
        search_error = None
        if web_search_enabled:
            query = web_search.extract_search_query(message)
            if query:
                search_attempted = True
                try:
                    search_results = web_search.search_sync(query, max_results=2)
                except Exception as e:
                    search_error = str(e)

        # 工具推荐（仅在普通对话模式下启用）
        tool_recommendations = None
        if tool_recommend and mode == 'chat':
            try:
                tool_recommendations = self.ai_manager.recommend_tools_sync(message, provider_id)
            except Exception as e:
                error_msg = str(e) or type(e).__name__
                logger.warning(f"工具推荐失败: {error_msg}")

        # 持久化：创建或复用会话
        if self.chat_history:
            if not conversation_id:
                system_prompt = self.ai_manager.EXPLAINER_SYSTEM_PROMPT if mode == 'explain' else None
                create_res = self.chat_history.create_session(
                    title=None, mode=mode, provider_id=pid, system_prompt=system_prompt
                )
                conversation_id = (create_res.get("session") or {}).get("id")
            if conversation_id:
                self.chat_history.append_message(conversation_id, "user", message, provider_id=pid)

        # 创建新会话（带时间戳）
        now = time.monotonic()
        with self._chat_sessions_lock:
            self._chat_sessions[session_id] = {
                'chunks': deque(),  # 存储增量内容
                'buffer': [],       # 完整内容用于落库
                'conversation_id': conversation_id,
                'done': False,
                'error': None,
                'last_access': now  # 记录最后访问时间
            }

        # 构建 messages
        messages = []

        # 解释模式：注入专用系统提示词
        if mode == 'explain':
            messages.append({'role': 'system', 'content': self.ai_manager.EXPLAINER_SYSTEM_PROMPT})

        if history:
            for item in history:
                if isinstance(item, dict) and 'role' in item and 'content' in item:
                    messages.append({'role': item['role'], 'content': item['content']})
        messages.append({'role': 'user', 'content': message})

        # 如果有搜索结果，直接注入到 messages 中（避免 Provider 重复搜索）
        if search_results:
            search_context = web_search.format_search_results(search_results)
            # 查找是否有 system prompt
            has_system = False
            for i, msg in enumerate(messages):
                if msg.get('role') == 'system':
                    messages[i]['content'] = msg['content'] + "\n\n" + search_context
                    has_system = True
                    break
            if not has_system:
                messages.insert(0, {'role': 'system', 'content': search_context})
            # 已注入搜索结果，不需要 Provider 再搜索
            web_search_enabled = False

        # 获取 Provider 配置中的 max_tokens 和 thinking_budget
        max_tokens = provider_config.get('config', {}).get('max_tokens', 4096)
        thinking_budget = provider_config.get('config', {}).get('thinking_budget', 32000)
        provider_type = provider_config.get('type', '')

        # 后台任务
        chat_history_ref = self.chat_history
        def stream_task():
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)
            try:
                async def run_stream():
                    provider = self.ai_manager.get_provider(pid)
                    chunk_count = 0
                    # 根据 Provider 类型传递不同参数
                    stream_kwargs = {
                        'web_search_enabled': web_search_enabled,
                        'max_tokens': max_tokens
                    }
                    if provider_type == 'claude' and thinking_enabled:
                        stream_kwargs['thinking_enabled'] = True
                        stream_kwargs['thinking_budget'] = thinking_budget
                    async for chunk in provider.chat_stream(messages, **stream_kwargs):
                        if chunk:
                            chunk_count += 1
                            # 线程安全地添加 chunk 并更新访问时间
                            with self._chat_sessions_lock:
                                session = self._chat_sessions.get(session_id)
                                if session is None:  # 会话已被清理
                                    break
                                session['chunks'].append(chunk)
                                session['buffer'].append(chunk)
                                session['last_access'] = time.monotonic()

                loop.run_until_complete(run_stream())
                # 标记完成并落库
                with self._chat_sessions_lock:
                    session = self._chat_sessions.get(session_id)
                    if session is not None:
                        session['done'] = True
                        session['last_access'] = time.monotonic()
                        # 持久化助手消息
                        if chat_history_ref and session.get('conversation_id'):
                            content = "".join(session.get('buffer') or [])
                            if content:
                                chat_history_ref.append_message(
                                    session['conversation_id'], "assistant", content, provider_id=pid
                                )
            except Exception as e:
                error_msg = str(e) or type(e).__name__
                logger.error(f"AI 流式对话失败: {error_msg}")
                # 记录错误
                with self._chat_sessions_lock:
                    session = self._chat_sessions.get(session_id)
                    if session is not None:
                        session['error'] = error_msg
                        session['done'] = True
                        session['last_access'] = time.monotonic()
            finally:
                loop.close()

        # 启动后台线程
        thread = threading.Thread(target=stream_task, daemon=True)
        thread.start()

        return {
            'success': True,
            'session_id': session_id,
            'conversation_id': conversation_id,
            'web_search_enabled': web_search_enabled,
            'search_results': search_results,
            'search_attempted': search_attempted,
            'search_error': search_error,
            'tool_recommendations': tool_recommendations
        }

    def get_chat_chunk(self, session_id: str):
        """
        获取流式对话的增量内容（轮询接口）

        Returns:
            {
                "success": True,
                "chunks": ["chunk1", "chunk2", ...],  # 本次获取的所有增量
                "done": False,  # 是否完成
                "error": None   # 错误信息
            }
        """
        import time

        # 每次轮询时清理超时的会话
        self._cleanup_chat_sessions()

        if not hasattr(self, '_chat_sessions') or not hasattr(self, '_chat_sessions_lock'):
            return {'success': False, 'error': '无效的 session_id'}

        # 线程安全地访问和更新会话
        with self._chat_sessions_lock:
            session = self._chat_sessions.get(session_id)
            if session is None:
                return {'success': False, 'error': '无效的 session_id'}

            # 更新最后访问时间
            session['last_access'] = time.monotonic()

            # 取出所有当前队列中的内容
            chunks = []
            while session['chunks']:
                chunks.append(session['chunks'].popleft())

            done = session['done']
            error = session['error']

            # 如果已完成，清理会话
            if done:
                del self._chat_sessions[session_id]

        return {
            'success': True,
            'chunks': chunks,
            'done': done,
            'error': error
        }

    # ========== 工具 AI 功能配置 ==========

    def get_tool_ai_definitions(self):
        """获取工具 AI 功能定义（包含所有工具及其支持的 AI 功能）"""
        return self.ai_manager.get_tool_ai_definitions()

    def get_tool_ai_config(self):
        """获取工具 AI 功能配置"""
        return self.ai_manager.get_tool_ai_config()

    def save_tool_ai_config(self, config: dict):
        """保存工具 AI 功能配置"""
        return self.ai_manager.save_tool_ai_config(config)

    def get_tool_ai_enabled(self, tool_id: str):
        """获取指定工具的 AI 功能启用状态"""
        return self.ai_manager.get_tool_ai_enabled(tool_id)

    def set_tool_ai_enabled(self, tool_id: str, enabled: bool):
        """设置指定工具的 AI 功能启用状态"""
        return self.ai_manager.set_tool_ai_enabled(tool_id, enabled)

    def set_global_ai_enabled(self, enabled: bool):
        """设置全局 AI 功能开关"""
        return self.ai_manager.set_global_ai_enabled(enabled)

    # ========== 聊天历史管理 ==========

    def create_chat_session(self, title: str = None, mode: str = "chat",
                            provider_id: str = None, system_prompt: str = None):
        """创建新的聊天会话"""
        if not self.chat_history:
            return {"success": False, "error": "聊天历史服务不可用"}
        return self.chat_history.create_session(title, mode, provider_id, system_prompt)

    def list_chat_sessions(self, keyword: str = None, limit: int = 50,
                           offset: int = 0, include_archived: bool = False):
        """获取聊天会话列表"""
        if not self.chat_history:
            return {"success": False, "error": "聊天历史服务不可用"}
        sessions = self.chat_history.list_sessions(keyword, limit, offset, include_archived)
        return {"success": True, "sessions": sessions}

    def get_chat_session(self, session_id: str):
        """获取单个聊天会话详情"""
        if not self.chat_history:
            return {"success": False, "error": "聊天历史服务不可用"}
        session = self.chat_history.get_session(session_id)
        return {"success": True, "session": session}

    def get_chat_messages(self, session_id: str, limit: int = None, offset: int = 0):
        """获取聊天会话的消息列表"""
        if not self.chat_history:
            return {"success": False, "error": "聊天历史服务不可用"}
        messages = self.chat_history.get_messages(session_id, limit, offset)
        return {"success": True, "messages": messages}

    def rename_chat_session(self, session_id: str, title: str):
        """重命名聊天会话"""
        if not self.chat_history:
            return {"success": False, "error": "聊天历史服务不可用"}
        ok = self.chat_history.update_session_title(session_id, title)
        return {"success": ok}

    def archive_chat_session(self, session_id: str, archived: bool = True):
        """归档/取消归档聊天会话"""
        if not self.chat_history:
            return {"success": False, "error": "聊天历史服务不可用"}
        ok = self.chat_history.set_session_archived(session_id, archived)
        return {"success": ok}

    def delete_chat_session(self, session_id: str):
        """删除聊天会话"""
        if not self.chat_history:
            return {"success": False, "error": "聊天历史服务不可用"}
        return self.chat_history.delete_session(session_id)

    def search_chat_messages(self, keyword: str, session_id: str = None,
                             limit: int = 50, offset: int = 0):
        """搜索聊天消息"""
        if not self.chat_history:
            return {"success": False, "error": "聊天历史服务不可用"}
        results = self.chat_history.search_messages(keyword, session_id, limit, offset)
        return {"success": True, "results": results}

    def export_chat_session_markdown(self, session_id: str):
        """导出聊天会话为 Markdown"""
        if not self.chat_history:
            return {"success": False, "error": "聊天历史服务不可用"}
        content = self.chat_history.export_session_markdown(session_id)
        return {"success": True, "content": content}

    # ========== Prompt 模板管理 ==========

    def list_prompt_categories(self):
        """获取 Prompt 模板分类列表"""
        if not self.prompt_template:
            return {"success": False, "error": "模板服务不可用"}
        categories = self.prompt_template.list_categories()
        return {"success": True, "categories": categories}

    def create_prompt_category(self, name: str, icon: str = None):
        """创建 Prompt 模板分类"""
        if not self.prompt_template:
            return {"success": False, "error": "模板服务不可用"}
        return self.prompt_template.create_category(name, icon)

    def update_prompt_category(self, category_id: str, name: str, icon: str = None):
        """更新 Prompt 模板分类"""
        if not self.prompt_template:
            return {"success": False, "error": "模板服务不可用"}
        return self.prompt_template.update_category(category_id, name, icon)

    def delete_prompt_category(self, category_id: str):
        """删除 Prompt 模板分类"""
        if not self.prompt_template:
            return {"success": False, "error": "模板服务不可用"}
        return self.prompt_template.delete_category(category_id)

    def reorder_prompt_categories(self, category_ids: List[str]):
        """重排 Prompt 模板分类顺序"""
        if not self.prompt_template:
            return {"success": False, "error": "模板服务不可用"}
        return self.prompt_template.reorder_categories(category_ids)

    def list_prompt_templates(self, category_id: str = None, keyword: str = None, favorites_only: bool = False):
        """获取 Prompt 模板列表"""
        if not self.prompt_template:
            return {"success": False, "error": "模板服务不可用"}
        templates = self.prompt_template.list_templates(category_id, keyword, favorites_only)
        return {"success": True, "templates": templates}

    def get_prompt_template(self, template_id: str):
        """获取单个 Prompt 模板"""
        if not self.prompt_template:
            return {"success": False, "error": "模板服务不可用"}
        template = self.prompt_template.get_template(template_id)
        return {"success": True, "template": template}

    def create_prompt_template(self, title: str, content: str, category_id: str = None,
                               description: str = None, tags: List[str] = None):
        """创建 Prompt 模板"""
        if not self.prompt_template:
            return {"success": False, "error": "模板服务不可用"}
        return self.prompt_template.create_template(title, content, category_id, description, tags)

    def update_prompt_template(self, template_id: str, title: str = None, content: str = None,
                               category_id: str = None, description: str = None, tags: List[str] = None):
        """更新 Prompt 模板"""
        if not self.prompt_template:
            return {"success": False, "error": "模板服务不可用"}
        kwargs = {}
        if title is not None:
            kwargs["title"] = title
        if content is not None:
            kwargs["content"] = content
        if category_id is not None:
            kwargs["category_id"] = category_id
        if description is not None:
            kwargs["description"] = description
        if tags is not None:
            kwargs["tags"] = tags
        return self.prompt_template.update_template(template_id, **kwargs)

    def delete_prompt_template(self, template_id: str):
        """删除 Prompt 模板"""
        if not self.prompt_template:
            return {"success": False, "error": "模板服务不可用"}
        return self.prompt_template.delete_template(template_id)

    def toggle_prompt_template_favorite(self, template_id: str):
        """切换 Prompt 模板收藏状态"""
        if not self.prompt_template:
            return {"success": False, "error": "模板服务不可用"}
        return self.prompt_template.toggle_favorite(template_id)

    def use_prompt_template(self, template_id: str, values: dict = None):
        """使用 Prompt 模板（填充变量并返回内容）"""
        if not self.prompt_template:
            return {"success": False, "error": "模板服务不可用"}
        return self.prompt_template.use_template(template_id, values)

    def parse_prompt_variables(self, content: str):
        """解析 Prompt 内容中的变量"""
        if not self.prompt_template:
            return {"success": False, "error": "模板服务不可用"}
        variables = self.prompt_template.parse_variables(content)
        return {"success": True, "variables": variables}

    def save_message_as_template(self, content: str, title: str = None, category_id: str = None):
        """将消息保存为 Prompt 模板"""
        if not self.prompt_template:
            return {"success": False, "error": "模板服务不可用"}
        return self.prompt_template.save_as_template(content, title, category_id)

    def export_prompt_templates(self, template_ids: List[str] = None, include_categories: bool = True):
        """导出 Prompt 模板为 JSON"""
        if not self.prompt_template:
            return {"success": False, "error": "模板服务不可用"}
        return self.prompt_template.export_templates(template_ids, include_categories)

    def import_prompt_templates(self, import_data: dict, overwrite: bool = False):
        """从 JSON 导入 Prompt 模板"""
        if not self.prompt_template:
            return {"success": False, "error": "模板服务不可用"}
        return self.prompt_template.import_templates(import_data, overwrite)
