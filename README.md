# 狗狗百宝箱 🐕🧰

一款实用的开发者工具集桌面应用，集成多种常用开发工具。

![Python](https://img.shields.io/badge/Python-3.10+-blue.svg)
![License](https://img.shields.io/badge/License-MIT-green.svg)
![Platform](https://img.shields.io/badge/Platform-macOS%20%7C%20Windows-lightgrey.svg)

## ✨ 功能特性

### 🔧 开发工具
- **JSON 格式化** - JSON 美化、压缩、校验
- **Base64 编解码** - 文本/图片 Base64 转换
- **URL 编解码** - URL 参数编码解码
- **时间戳转换** - Unix 时间戳与日期互转
- **UUID 生成器** - 批量生成 UUID
- **哈希计算** - MD5/SHA1/SHA256 等多种算法
- **正则测试** - 正则表达式在线测试
- **Diff 对比** - 文本差异对比

### 🔐 加密工具
- **AES 加解密** - AES-128/192/256 加解密
- **DES 加解密** - DES/3DES 加解密
- **JWT 解析** - JWT Token 解析与验证

### 🌐 网络工具
- **节点转换** - 代理节点格式转换（SS/SSR/VMess/VLESS/Trojan）
- **HTTP 请求** - 简易 HTTP 客户端

### 💻 系统工具
- **电脑使用管理** - 远程命令执行与凭证管理

### 🎨 界面特性
- 多主题支持（亮色/暗色）
- 可爱的狗狗吉祥物
- 响应式布局

## 📸 截图

<!-- 可以添加应用截图 -->

## 🚀 快速开始

### 方式一：下载预编译版本

前往 [Releases](https://github.com/your-username/doggy-toolbox/releases) 下载对应平台的安装包。

### 方式二：从源码运行

```bash
# 克隆项目
git clone https://github.com/your-username/doggy-toolbox.git
cd doggy-toolbox

# 创建虚拟环境
python -m venv .venv
source .venv/bin/activate  # Windows: .venv\Scripts\activate

# 安装依赖
pip install -r requirements.txt

# 运行应用
python main.py
```

## 📦 打包

```bash
# 安装打包工具
pip install pyinstaller

# 运行打包脚本
python build.py

# 或手动打包
# macOS
pyinstaller --onedir --windowed --name "狗狗百宝箱" --add-data "web:web" --add-data "services:services" main.py

# Windows
pyinstaller --onedir --windowed --name "狗狗百宝箱" --add-data "web;web" --add-data "services;services" main.py
```

打包完成后，可执行文件位于 `dist/狗狗百宝箱/` 目录。

## 🗂️ 项目结构

```
doggy-toolbox/
├── main.py              # 应用入口
├── api.py               # PyWebView API 接口
├── build.py             # 打包脚本
├── services/            # 业务逻辑层
│   ├── computer_usage.py    # 电脑使用服务
│   └── node_converter.py    # 节点转换服务
├── web/                 # 前端资源
│   ├── index.html       # 主页面
│   ├── styles.css       # 样式表
│   ├── app.js           # 主逻辑
│   └── tools_m*.js      # 各工具模块
└── icons/               # 图标资源
```

## 🔧 技术栈

- **后端**: Python 3.10+
- **桌面框架**: [pywebview](https://pywebview.flowrl.com/)
- **前端**: 原生 HTML/CSS/JavaScript
- **打包**: PyInstaller

## 🤝 贡献

欢迎提交 Issue 和 Pull Request！

## 📜 许可证

本项目采用 [MIT 许可证](LICENSE)。
