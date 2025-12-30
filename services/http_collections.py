"""HTTP 请求集合管理服务"""
import json
import uuid
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional
from dataclasses import dataclass, asdict
import logging

from services.db_manager import DatabaseManager

logger = logging.getLogger(__name__)


@dataclass
class HttpRequest:
    """HTTP 请求"""
    id: str
    name: str
    method: str
    url: str
    headers: List[Dict[str, str]]
    params: List[Dict[str, str]]
    body: Dict[str, str]
    auth: Dict[str, str]
    description: str = ""
    tags: List[str] = None

    def __post_init__(self):
        if self.tags is None:
            self.tags = []


@dataclass
class HttpFolder:
    """HTTP 请求文件夹"""
    id: str
    name: str
    level: int
    folders: List['HttpFolder'] = None
    requests: List[HttpRequest] = None

    def __post_init__(self):
        if self.folders is None:
            self.folders = []
        if self.requests is None:
            self.requests = []


@dataclass
class HttpEnvironment:
    """环境变量"""
    id: str
    name: str
    variables: List[Dict[str, str]]


@dataclass
class HttpCollection:
    """HTTP 请求集合"""
    id: str
    name: str
    description: str = ""
    folders: List[HttpFolder] = None
    requests: List[HttpRequest] = None
    environments: List[HttpEnvironment] = None

    def __post_init__(self):
        if self.folders is None:
            self.folders = []
        if self.requests is None:
            self.requests = []
        if self.environments is None:
            self.environments = []


class HttpCollectionsService:
    """HTTP 请求集合管理服务"""

    def __init__(self, data_dir: Path, db: DatabaseManager | None = None):
        self.data_dir = data_dir
        self.collections_file = data_dir / "collections.json"

        # 数据库支持（优先使用传入的 db，否则创建新实例）
        if db is not None:
            self.db = db
            logger.info("HttpCollectionsService 使用共享数据库实例")
        else:
            self.db_path = self.data_dir / "doggy_toolbox.db"
            self.db = DatabaseManager(self.db_path)
            logger.info("HttpCollectionsService 使用独立数据库")


    def _build_tree_from_db(self) -> List[Dict]:
        """从数据库构建集合树形结构"""
        all_items = self.db.get_all("http_collections", order_by="order_index ASC")

        # 构建 id -> item 映射
        item_map = {item['id']: item for item in all_items}

        # 构建树形结构
        root_collections = []
        for item in all_items:
            if item['parent_id'] is None:
                # 根节点（集合或顶级文件夹/请求）
                collection = self._build_collection_node(item, item_map)
                root_collections.append(collection)

        return root_collections

    def _build_collection_node(self, item: Dict, item_map: Dict) -> Dict:
        """递归构建集合节点"""
        node = {
            'id': item['id'],
            'name': item['name'],
            'description': item.get('description', ''),
            'type': item.get('type', 'folder')
        }

        if item['type'] == 'request':
            # 请求节点，包含完整数据
            node.update(item.get('data', {}))
        else:
            # 文件夹节点，递归构建子节点
            node['folders'] = []
            node['requests'] = []

            # 收集所有子节点并按 order_index 排序
            children = []
            for child_id, child_item in item_map.items():
                if child_item.get('parent_id') == item['id']:
                    children.append(child_item)

            # 按 order_index 排序
            children.sort(key=lambda x: x.get('order_index', 0))

            # 分类添加到 folders 或 requests
            for child_item in children:
                if child_item['type'] == 'folder':
                    node['folders'].append(self._build_collection_node(child_item, item_map))
                elif child_item['type'] == 'request':
                    node['requests'].append(self._build_collection_node(child_item, item_map))

        return node

    def get_collections(self) -> List[Dict]:
        """获取所有集合"""
        try:
            return self._build_tree_from_db()
        except Exception as e:
            logger.error(f"从数据库获取集合失败: {e}")
            return []

    def add_collection(self, name: str, description: str = "") -> Dict:
        """新建集合"""
        new_collection = {
            "id": str(uuid.uuid4()),
            "name": name,
            "description": description,
            "folders": [],
            "requests": [],
            "environments": []
        }

        try:
            # 获取当前所有根集合的最大 order_index
            root_collections = self.db.get_all("http_collections", where="parent_id IS NULL")
            max_order = max([c.get('order_index', 0) for c in root_collections], default=-1)

            self.db.insert("http_collections", {
                "id": new_collection["id"],
                "name": name,
                "description": description,
                "parent_id": None,
                "type": "folder",
                "data": None,
                "order_index": max_order + 1
            })
            return new_collection
        except Exception as e:
            logger.error(f"新建集合失败: {e}")
            raise

    def delete_collection(self, collection_id: str):
        """删除集合"""
        try:
            # 递归删除所有子项
            self._delete_collection_recursive(collection_id)
            return
        except Exception as e:
            logger.error(f"删除集合失败: {e}")
            raise

    def _delete_collection_recursive(self, parent_id: str):
        """递归删除集合及其所有子项"""
        # 查找所有子项
        children = self.db.get_all("http_collections", where="parent_id = ?", params=(parent_id,))

        # 递归删除子项
        for child in children:
            self._delete_collection_recursive(child['id'])

        # 删除当前项
        self.db.delete("http_collections", where="id = ?", params=(parent_id,))

    def add_folder(self, collection_id: str, name: str, parent_path: List[str] = None, level: int = 1) -> Dict:
        """新建文件夹（最多3级）"""
        if level > 3:
            raise ValueError("文件夹层级不能超过3级")

        new_folder = {
            "id": str(uuid.uuid4()),
            "name": name,
            "level": level,
            "folders": [],
            "requests": []
        }

        try:
            # 确定父ID
            parent_id = collection_id if not parent_path else parent_path[-1]

            # 获取当前父级下的最大 order_index
            siblings = self.db.get_all("http_collections", where="parent_id = ?", params=(parent_id,))
            max_order = max([s.get('order_index', 0) for s in siblings], default=-1)

            self.db.insert("http_collections", {
                "id": new_folder["id"],
                "name": name,
                "description": "",
                "parent_id": parent_id,
                "type": "folder",
                "data": None,
                "order_index": max_order + 1
            })
            return new_folder
        except Exception as e:
            logger.error(f"新建文件夹失败: {e}")
            raise

    def _find_folder_by_path(self, collection: Dict, path: List[str]) -> Optional[Dict]:
        """根据路径查找文件夹"""
        current = collection
        for folder_id in path:
            found = False
            for folder in current.get("folders", []):
                if folder["id"] == folder_id:
                    current = folder
                    found = True
                    break
            if not found:
                return None
        return current

    def add_request(self, collection_id: str, request_data: Dict, folder_path: List[str] = None) -> Dict:
        """新建请求"""
        new_request = {
            "id": str(uuid.uuid4()),
            "name": request_data.get("name", "新请求"),
            "method": request_data.get("method", "GET"),
            "url": request_data.get("url", ""),
            "headers": request_data.get("headers", []),
            "params": request_data.get("params", []),
            "body": request_data.get("body", {"type": "none", "content": ""}),
            "auth": request_data.get("auth", {"type": "none"}),
            "description": request_data.get("description", ""),
            "tags": request_data.get("tags", [])
        }

        try:
            # 确定父ID
            parent_id = collection_id if not folder_path else folder_path[-1]

            # 获取当前父级下的最大 order_index
            siblings = self.db.get_all("http_collections", where="parent_id = ?", params=(parent_id,))
            max_order = max([s.get('order_index', 0) for s in siblings], default=-1)

            self.db.insert("http_collections", {
                "id": new_request["id"],
                "name": new_request["name"],
                "description": new_request.get("description", ""),
                "parent_id": parent_id,
                "type": "request",
                "data": new_request,
                "order_index": max_order + 1
            })
            return new_request
        except Exception as e:
            logger.error(f"新建请求失败: {e}")
            raise

    def update_request(self, collection_id: str, request_id: str, request_data: Dict) -> Dict:
        """更新请求"""
        try:
            # 获取原请求
            existing = self.db.get_by_id("http_collections", request_id)
            if not existing or existing['type'] != 'request':
                raise ValueError("请求不存在")

            # 合并数据
            updated_data = existing.get('data', {})
            updated_data.update(request_data)

            # 更新数据库
            self.db.update("http_collections", {
                "name": request_data.get("name", existing['name']),
                "description": request_data.get("description", existing.get('description', '')),
                "data": updated_data
            }, where="id = ?", params=(request_id,))

            return updated_data
        except Exception as e:
            logger.error(f"更新请求失败: {e}")
            raise

    def delete_request(self, collection_id: str, request_id: str):
        """删除请求"""
        try:
            self.db.delete("http_collections", where="id = ?", params=(request_id,))
            return
        except Exception as e:
            logger.error(f"删除请求失败: {e}")
            raise

    def import_postman(self, postman_data: Dict) -> Dict:
        """导入 Postman 集合"""
        collection_name = postman_data.get("info", {}).get("name", "导入的集合")
        new_collection = self.add_collection(collection_name)

        def convert_item(item, level=1):
            """转换 Postman item"""
            if "request" in item:
                # 这是一个请求
                request = item["request"]
                url_obj = request.get("url", {})

                # 处理 URL
                if isinstance(url_obj, str):
                    url = url_obj
                else:
                    url = url_obj.get("raw", "")

                # 处理 headers
                headers = []
                for h in request.get("header", []):
                    if isinstance(h, dict):
                        headers.append({
                            "key": h.get("key", ""),
                            "value": h.get("value", ""),
                            "enabled": not h.get("disabled", False)
                        })

                # 处理 body
                body = {"type": "none", "content": ""}
                if "body" in request:
                    body_obj = request["body"]
                    mode = body_obj.get("mode", "none")
                    if mode == "raw":
                        body = {"type": "raw", "content": body_obj.get("raw", "")}
                    elif mode == "formdata":
                        body = {"type": "form", "content": json.dumps(body_obj.get("formdata", []))}

                return {
                    "name": item.get("name", ""),
                    "method": request.get("method", "GET"),
                    "url": url,
                    "headers": headers,
                    "params": [],
                    "body": body,
                    "auth": {"type": "none"},
                    "description": item.get("description", ""),
                    "tags": []
                }
            elif "item" in item:
                # 这是一个文件夹
                if level > 3:
                    return None  # 超过3级，忽略
                return {
                    "name": item.get("name", ""),
                    "level": level,
                    "items": [convert_item(sub, level + 1) for sub in item["item"]]
                }
            return None

        def process_converted_items(items, parent_folders_list):
            """递归处理转换后的项目"""
            folders = []
            requests = []

            for item in items:
                if not item:
                    continue

                if "items" in item:
                    # 这是文件夹
                    folder_data = {
                        "id": str(uuid.uuid4()),
                        "name": item["name"],
                        "level": item["level"],
                        "folders": [],
                        "requests": []
                    }

                    # 递归处理子项
                    sub_folders, sub_requests = process_converted_items(item["items"], parent_folders_list + [folder_data["id"]])
                    folder_data["folders"] = sub_folders
                    folder_data["requests"] = sub_requests

                    folders.append(folder_data)
                elif "method" in item:
                    # 这是请求
                    requests.append({
                        "id": str(uuid.uuid4()),
                        **item
                    })

            return folders, requests

        # 转换所有 items
        converted_items = [convert_item(item) for item in postman_data.get("item", [])]
        converted_items = [item for item in converted_items if item]

        # 处理转换后的项目
        folders, requests = process_converted_items(converted_items, [])

        # 递归插入文件夹和请求到数据库
        def insert_items_to_db(folders_list, requests_list, parent_id):
            """递归插入文件夹和请求到数据库"""
            # 获取当前父级下已有项目的最大 order_index
            existing = self.db.get_all("http_collections", where="parent_id = ?", params=(parent_id,))
            max_order = max([item.get('order_index', 0) for item in existing], default=-1)
            current_order = max_order + 1

            # 插入文件夹
            for folder in folders_list:
                folder_id = folder["id"]
                self.db.insert("http_collections", {
                    "id": folder_id,
                    "name": folder["name"],
                    "description": "",
                    "parent_id": parent_id,
                    "type": "folder",
                    "data": None,
                    "order_index": current_order
                })
                current_order += 1

                # 递归插入子文件夹和请求
                insert_items_to_db(folder.get("folders", []), folder.get("requests", []), folder_id)

            # 插入请求
            for request in requests_list:
                request_id = request["id"]
                self.db.insert("http_collections", {
                    "id": request_id,
                    "name": request.get("name", ""),
                    "description": request.get("description", ""),
                    "parent_id": parent_id,
                    "type": "request",
                    "data": request,
                    "order_index": current_order
                })
                current_order += 1

        # 插入所有文件夹和请求到集合下
        try:
            insert_items_to_db(folders, requests, new_collection["id"])
        except Exception as e:
            logger.error(f"导入 Postman 集合失败: {e}")
            raise

        return new_collection

    def import_apifox(self, apifox_data: Dict) -> Dict:
        """导入 Apifox 集合"""
        collection_name = apifox_data.get("info", {}).get("name", "导入的集合")
        new_collection = self.add_collection(collection_name)

        # 处理 apiCollection
        for api_folder in apifox_data.get("apiCollection", []):
            self._process_apifox_folder(new_collection["id"], api_folder, [])

        return new_collection

    def _process_apifox_folder(self, collection_id: str, folder_data: Dict, parent_path: List[str]):
        """递归处理 Apifox 文件夹"""
        # 处理当前文件夹中的请求
        for item in folder_data.get("items", []):
            if "api" in item:
                api = item["api"]

                # 构建请求数据
                request_data = {
                    "name": item.get("name", ""),
                    "method": api.get("method", "GET").upper(),
                    "url": api.get("path", ""),
                    "headers": [],
                    "params": [],
                    "body": {"type": "none", "content": ""},
                    "auth": {"type": "none"},
                    "description": api.get("description", ""),
                    "tags": api.get("tags", [])
                }

                # 处理 path 参数
                for param in api.get("parameters", {}).get("path", []):
                    request_data["params"].append({
                        "key": param.get("name", ""),
                        "value": "",
                        "enabled": param.get("enable", True),
                        "type": "path"
                    })

                # 处理 requestBody
                if "requestBody" in api:
                    req_body = api["requestBody"]
                    body_type = req_body.get("type", "")
                    if "application/json" in body_type:
                        examples = req_body.get("examples", [])
                        if examples:
                            request_data["body"] = {
                                "type": "json",
                                "content": examples[0].get("value", "")
                            }

                self.add_request(collection_id, request_data, parent_path)

    def import_openapi(self, openapi_data: Dict) -> Dict:
        """导入 OpenAPI 文档"""
        collection_name = openapi_data.get("info", {}).get("title", "导入的集合")
        new_collection = self.add_collection(collection_name)

        # 处理 paths
        for path, methods in openapi_data.get("paths", {}).items():
            for method, operation in methods.items():
                if method.lower() in ["get", "post", "put", "delete", "patch", "head", "options"]:
                    request_data = {
                        "name": operation.get("summary", path),
                        "method": method.upper(),
                        "url": path,
                        "headers": [],
                        "params": [],
                        "body": {"type": "none", "content": ""},
                        "auth": {"type": "none"},
                        "description": operation.get("description", ""),
                        "tags": operation.get("tags", [])
                    }

                    # 处理 parameters
                    for param in operation.get("parameters", []):
                        param_in = param.get("in", "")
                        if param_in == "path" or param_in == "query":
                            request_data["params"].append({
                                "key": param.get("name", ""),
                                "value": "",
                                "enabled": True,
                                "type": param_in
                            })

                    # 处理 requestBody
                    if "requestBody" in operation:
                        content = operation["requestBody"].get("content", {})
                        if "application/json" in content:
                            schema = content["application/json"].get("schema", {})
                            example = content["application/json"].get("example", {})
                            if example:
                                request_data["body"] = {
                                    "type": "json",
                                    "content": json.dumps(example, ensure_ascii=False, indent=2)
                                }

                    self.add_request(new_collection["id"], request_data)

        return new_collection

    # ==================== 导出功能 ====================

    def export_openapi(self, collection_id: str = None) -> Dict:
        """
        导出为 OpenAPI 3.0 格式

        Args:
            collection_id: 集合 ID，为空则导出所有

        Returns:
            OpenAPI 3.0 文档
        """
        collections = self.get_collections()
        if collection_id:
            collections = [c for c in collections if c['id'] == collection_id]

        if not collections:
            return {"error": "未找到集合"}

        # 构建 OpenAPI 文档
        openapi_doc = {
            "openapi": "3.0.3",
            "info": {
                "title": collections[0]['name'] if len(collections) == 1 else "API 文档",
                "description": collections[0].get('description', '') if len(collections) == 1 else "导出的 API 集合",
                "version": "1.0.0"
            },
            "servers": [],
            "paths": {},
            "components": {
                "schemas": {},
                "securitySchemes": {}
            }
        }

        servers_set = set()

        def process_request(req: Dict, tag: str = None):
            if req.get('type') != 'request':
                return

            data = req.get('data', req)
            url = data.get('url', '')
            method = data.get('method', 'GET').lower()

            parsed = self._parse_url(url)
            if parsed['host']:
                servers_set.add(f"{parsed['scheme']}://{parsed['host']}")

            path = parsed['path'] or '/'
            # 移除查询参数
            if '?' in path:
                path = path.split('?')[0]

            operation = {
                "summary": data.get('name', ''),
                "description": data.get('description', ''),
                "operationId": f"{method}_{req.get('id', '')}",
                "parameters": [],
                "responses": {
                    "200": {"description": "成功响应"}
                }
            }

            if tag:
                operation["tags"] = [tag]

            # 处理 Query 参数
            for param in data.get('params', []):
                if param.get('enabled', True) and param.get('key'):
                    operation["parameters"].append({
                        "name": param.get('key', ''),
                        "in": param.get('type', 'query'),
                        "required": False,
                        "schema": {"type": "string"},
                        "example": param.get('value', '')
                    })

            # 处理 Headers（敏感信息脱敏）
            SENSITIVE_HEADERS = {'authorization', 'x-api-key', 'api-key', 'token', 'x-token', 'bearer', 'cookie', 'set-cookie', 'proxy-authorization', 'x-auth-token'}
            for header in data.get('headers', []):
                if header.get('enabled', True) and header.get('key'):
                    header_key = header.get('key', '')
                    header_value = header.get('value', '')
                    if header_key.lower().strip() in SENSITIVE_HEADERS:
                        header_value = '***REDACTED***'
                    operation["parameters"].append({
                        "name": header_key,
                        "in": "header",
                        "required": False,
                        "schema": {"type": "string"},
                        "example": header_value
                    })

            # 处理 Body
            body = data.get('body', {})
            if body.get('type') not in ['none', None, '']:
                content_type = "application/json"
                if body.get('type') == 'form':
                    content_type = "application/x-www-form-urlencoded"
                elif body.get('type') == 'raw':
                    content_type = "text/plain"

                example_content = body.get('content', '')
                try:
                    example_content = json.loads(example_content)
                except (json.JSONDecodeError, TypeError):
                    pass

                operation["requestBody"] = {
                    "content": {
                        content_type: {
                            "schema": {"type": "object"},
                            "example": example_content
                        }
                    }
                }

            if path not in openapi_doc["paths"]:
                openapi_doc["paths"][path] = {}
            openapi_doc["paths"][path][method] = operation

        def process_folder(folder: Dict, parent_tag: str = None):
            tag = folder.get('name', parent_tag)
            for req in folder.get('requests', []):
                process_request(req, tag)
            for sub_folder in folder.get('folders', []):
                process_folder(sub_folder, tag)

        for collection in collections:
            tag = collection.get('name', '')
            for req in collection.get('requests', []):
                process_request(req, tag)
            for folder in collection.get('folders', []):
                process_folder(folder, tag)

        openapi_doc["servers"] = [{"url": s} for s in servers_set] or [{"url": "http://localhost"}]
        return openapi_doc

    def export_postman(self, collection_id: str = None) -> Dict:
        """
        导出为 Postman Collection v2.1 格式

        Args:
            collection_id: 集合 ID，为空则导出所有

        Returns:
            Postman Collection v2.1 文档
        """
        collections = self.get_collections()
        if collection_id:
            collections = [c for c in collections if c['id'] == collection_id]

        if not collections:
            return {"error": "未找到集合"}

        def convert_request(req: Dict) -> Dict:
            data = req.get('data', req)
            url = data.get('url', '')
            parsed = self._parse_url(url)

            url_obj = {
                "raw": url,
                "protocol": parsed['scheme'],
                "host": parsed['host'].split('.') if parsed['host'] else [],
                "path": [p for p in parsed['path'].split('/') if p]
            }

            # 添加查询参数
            if data.get('params'):
                url_obj["query"] = [
                    {"key": p.get('key', ''), "value": p.get('value', ''), "disabled": not p.get('enabled', True)}
                    for p in data.get('params', []) if p.get('key')
                ]

            # Headers（敏感信息脱敏）
            SENSITIVE_HEADERS = {'authorization', 'x-api-key', 'api-key', 'token', 'x-token', 'bearer', 'cookie', 'set-cookie', 'proxy-authorization', 'x-auth-token'}
            headers = []
            for h in data.get('headers', []):
                if h.get('key'):
                    header_key = h.get('key', '')
                    header_value = h.get('value', '')
                    if header_key.lower().strip() in SENSITIVE_HEADERS:
                        header_value = '***REDACTED***'
                    headers.append({
                        "key": header_key,
                        "value": header_value,
                        "type": "text",
                        "disabled": not h.get('enabled', True)
                    })

            body = None
            req_body = data.get('body', {})
            if req_body.get('type') not in ['none', None, '']:
                if req_body.get('type') == 'json':
                    body = {
                        "mode": "raw",
                        "raw": req_body.get('content', ''),
                        "options": {"raw": {"language": "json"}}
                    }
                elif req_body.get('type') == 'form':
                    body = {"mode": "formdata", "formdata": []}
                else:
                    body = {"mode": "raw", "raw": req_body.get('content', '')}

            return {
                "name": data.get('name', ''),
                "request": {
                    "method": data.get('method', 'GET'),
                    "header": headers,
                    "body": body,
                    "url": url_obj,
                    "description": data.get('description', '')
                }
            }

        def convert_folder(folder: Dict) -> Dict:
            items = []
            for req in folder.get('requests', []):
                if req.get('type') == 'request':
                    items.append(convert_request(req))
            for sub_folder in folder.get('folders', []):
                items.append(convert_folder(sub_folder))
            return {"name": folder.get('name', ''), "item": items}

        if len(collections) == 1:
            collection = collections[0]
            items = []
            for req in collection.get('requests', []):
                if req.get('type') == 'request':
                    items.append(convert_request(req))
            for folder in collection.get('folders', []):
                items.append(convert_folder(folder))

            return {
                "info": {
                    "_postman_id": collection.get('id', ''),
                    "name": collection.get('name', ''),
                    "description": collection.get('description', ''),
                    "schema": "https://schema.getpostman.com/json/collection/v2.1.0/collection.json"
                },
                "item": items
            }
        else:
            all_items = [convert_folder(c) for c in collections]
            return {
                "info": {
                    "_postman_id": str(uuid.uuid4()),
                    "name": "导出的 API 集合",
                    "schema": "https://schema.getpostman.com/json/collection/v2.1.0/collection.json"
                },
                "item": all_items
            }

    def _parse_url(self, url: str) -> Dict:
        """解析 URL"""
        from urllib.parse import urlparse

        try:
            parsed = urlparse(url)
            return {
                "scheme": parsed.scheme or "https",
                "host": parsed.netloc,
                "path": parsed.path or "/",
                "query": parsed.query
            }
        except Exception:
            return {"scheme": "https", "host": "", "path": url, "query": ""}

    # ==================== 环境变量管理 ====================

    def get_environments(self) -> List[Dict]:
        """获取所有环境变量"""
        try:
            rows = self.db.get_all("http_environments", order_by="created_at ASC")
            return [
                {
                    "id": row["id"],
                    "name": row["name"],
                    "variables": row["variables"] if isinstance(row["variables"], list) else (json.loads(row["variables"]) if row["variables"] else []),
                    "is_active": bool(row["is_active"])
                }
                for row in rows
            ]
        except Exception as e:
            logger.error(f"获取环境变量失败: {e}")
            return []

    def get_active_environment(self) -> Optional[Dict]:
        """获取当前活跃的环境"""
        try:
            rows = self.db.execute_query(
                "SELECT * FROM http_environments WHERE is_active = 1 LIMIT 1"
            )
            if rows:
                row = rows[0]
                variables = row["variables"]
                if isinstance(variables, str):
                    variables = json.loads(variables) if variables else []
                elif not isinstance(variables, list):
                    variables = []
                return {
                    "id": row["id"],
                    "name": row["name"],
                    "variables": variables
                }
            return None
        except Exception as e:
            logger.error(f"获取活跃环境失败: {e}")
            return None

    def create_environment(self, name: str, variables: List[Dict] = None) -> Dict:
        """创建环境"""
        try:
            env_id = str(uuid.uuid4())
            now = datetime.now().isoformat()
            self.db.insert("http_environments", {
                "id": env_id,
                "name": name,
                "variables": json.dumps(variables or []),
                "is_active": 0,
                "created_at": now,
                "updated_at": now
            })
            return {"success": True, "id": env_id}
        except Exception as e:
            logger.error(f"创建环境失败: {e}")
            return {"success": False, "error": str(e)}

    def update_environment(self, env_id: str, name: str = None, variables: List[Dict] = None) -> Dict:
        """更新环境"""
        try:
            updates = {"updated_at": datetime.now().isoformat()}
            if name is not None:
                updates["name"] = name
            if variables is not None:
                updates["variables"] = json.dumps(variables)

            self.db.update("http_environments", updates, "id = ?", (env_id,))
            return {"success": True}
        except Exception as e:
            logger.error(f"更新环境失败: {e}")
            return {"success": False, "error": str(e)}

    def delete_environment(self, env_id: str) -> Dict:
        """删除环境"""
        try:
            self.db.delete("http_environments", "id = ?", (env_id,))
            return {"success": True}
        except Exception as e:
            logger.error(f"删除环境失败: {e}")
            return {"success": False, "error": str(e)}

    def set_active_environment(self, env_id: str = None) -> Dict:
        """设置活跃环境"""
        try:
            # 先清除所有活跃状态
            self.db.execute_update("UPDATE http_environments SET is_active = 0")

            # 如果指定了环境，设置为活跃
            if env_id:
                self.db.update("http_environments", {"is_active": 1}, "id = ?", (env_id,))

            return {"success": True}
        except Exception as e:
            logger.error(f"设置活跃环境失败: {e}")
            return {"success": False, "error": str(e)}

    def replace_variables(self, text: str, env_id: str = None) -> str:
        """替换文本中的环境变量"""
        import re

        if not text:
            return text

        # 获取环境变量
        env = None
        if env_id:
            rows = self.db.execute_query("SELECT * FROM http_environments WHERE id = ?", (env_id,))
            if rows:
                env = rows[0]
        else:
            env_data = self.get_active_environment()
            if env_data:
                return self._do_replace(text, env_data.get("variables", []))
            return text

        if env:
            variables = env["variables"]
            if isinstance(variables, str):
                variables = json.loads(variables) if variables else []
            elif not isinstance(variables, list):
                variables = []
            return self._do_replace(text, variables)

        return text

    def _do_replace(self, text: str, variables: List[Dict]) -> str:
        """执行变量替换"""
        import re

        if not variables:
            return text

        # 构建变量映射
        var_map = {}
        for v in variables:
            if v.get("enabled", True) and v.get("key"):
                var_map[v["key"]] = v.get("value", "")

        # 替换 {{variable}} 格式
        def replacer(match):
            key = match.group(1)
            return var_map.get(key, match.group(0))

        return re.sub(r'\{\{(\w+)\}\}', replacer, text)
