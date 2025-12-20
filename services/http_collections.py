"""HTTP 请求集合管理服务"""
import json
import uuid
from pathlib import Path
from typing import Dict, List, Optional
from dataclasses import dataclass, asdict


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

    def __init__(self, data_dir: Path):
        self.data_dir = data_dir
        self.collections_file = data_dir / "collections.json"
        self._ensure_file()

    def _ensure_file(self):
        """确保数据目录和文件存在"""
        self.data_dir.mkdir(parents=True, exist_ok=True)
        if not self.collections_file.exists():
            self.collections_file.write_text(
                json.dumps({"version": "1.0.0", "collections": []}, ensure_ascii=False, indent=2),
                encoding="utf-8"
            )

    def _load_data(self) -> Dict:
        """加载数据"""
        try:
            return json.loads(self.collections_file.read_text(encoding="utf-8"))
        except Exception:
            return {"version": "1.0.0", "collections": []}

    def _save_data(self, data: Dict):
        """保存数据"""
        self.collections_file.write_text(
            json.dumps(data, ensure_ascii=False, indent=2),
            encoding="utf-8"
        )

    def get_collections(self) -> List[Dict]:
        """获取所有集合"""
        data = self._load_data()
        return data.get("collections", [])

    def add_collection(self, name: str, description: str = "") -> Dict:
        """新建集合"""
        data = self._load_data()
        new_collection = {
            "id": str(uuid.uuid4()),
            "name": name,
            "description": description,
            "folders": [],
            "requests": [],
            "environments": []
        }
        data["collections"].append(new_collection)
        self._save_data(data)
        return new_collection

    def delete_collection(self, collection_id: str):
        """删除集合"""
        data = self._load_data()
        data["collections"] = [c for c in data["collections"] if c["id"] != collection_id]
        self._save_data(data)

    def add_folder(self, collection_id: str, name: str, parent_path: List[str] = None, level: int = 1) -> Dict:
        """新建文件夹（最多3级）"""
        if level > 3:
            raise ValueError("文件夹层级不能超过3级")

        data = self._load_data()
        collection = next((c for c in data["collections"] if c["id"] == collection_id), None)
        if not collection:
            raise ValueError("集合不存在")

        new_folder = {
            "id": str(uuid.uuid4()),
            "name": name,
            "level": level,
            "folders": [],
            "requests": []
        }

        # 如果没有父路径，添加到根级别
        if not parent_path:
            collection["folders"].append(new_folder)
        else:
            # 根据路径找到父文件夹
            parent = self._find_folder_by_path(collection, parent_path)
            if parent:
                parent["folders"].append(new_folder)
            else:
                raise ValueError("父文件夹不存在")

        self._save_data(data)
        return new_folder

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
        data = self._load_data()
        collection = next((c for c in data["collections"] if c["id"] == collection_id), None)
        if not collection:
            raise ValueError("集合不存在")

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

        # 如果没有文件夹路径，添加到根级别
        if not folder_path:
            collection["requests"].append(new_request)
        else:
            # 根据路径找到文件夹
            folder = self._find_folder_by_path(collection, folder_path)
            if folder:
                folder["requests"].append(new_request)
            else:
                raise ValueError("文件夹不存在")

        self._save_data(data)
        return new_request

    def update_request(self, collection_id: str, request_id: str, request_data: Dict) -> Dict:
        """更新请求"""
        data = self._load_data()
        collection = next((c for c in data["collections"] if c["id"] == collection_id), None)
        if not collection:
            raise ValueError("集合不存在")

        # 递归查找并更新请求
        def update_in_container(container):
            for req in container.get("requests", []):
                if req["id"] == request_id:
                    req.update(request_data)
                    return True
            for folder in container.get("folders", []):
                if update_in_container(folder):
                    return True
            return False

        if not update_in_container(collection):
            raise ValueError("请求不存在")

        self._save_data(data)
        return request_data

    def delete_request(self, collection_id: str, request_id: str):
        """删除请求"""
        data = self._load_data()
        collection = next((c for c in data["collections"] if c["id"] == collection_id), None)
        if not collection:
            raise ValueError("集合不存在")

        # 递归查找并删除请求
        def delete_in_container(container):
            container["requests"] = [r for r in container.get("requests", []) if r["id"] != request_id]
            for folder in container.get("folders", []):
                delete_in_container(folder)

        delete_in_container(collection)
        self._save_data(data)

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

        # 添加到集合
        data = self._load_data()
        collection = next((c for c in data["collections"] if c["id"] == new_collection["id"]), None)
        if collection:
            collection["folders"].extend(folders)
            collection["requests"].extend(requests)
            self._save_data(data)

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
