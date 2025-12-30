# 狗狗百宝箱 🐕🧰

一款实用的开发者工具集桌面应用，集成多种常用开发工具。

![Version](https://img.shields.io/badge/Version-v1.2.0-orange.svg)
![Python](https://img.shields.io/badge/Python-3.10+-blue.svg)
![License](https://img.shields.io/badge/License-MIT-green.svg)
![Platform](https://img.shields.io/badge/Platform-macOS%20%7C%20Windows-lightgrey.svg)

## ✨ 功能特性

### 🔧 编码转换
- **Base64 编解码** (M2) - 文本/图片 Base64 转换、Hex 互转
- **Unicode 编解码** (M19) - `\uXXXX` / `\xXX` / `&#xXXXX;` 等格式互转
- **URL 编解码** (M9) - URL 参数编码解码
- **进制转换** (M10) - 二/八/十/十六进制互转
- **变量命名转换** (M2) - camelCase/snake_case/PascalCase 等格式互转

### 🔐 加密安全
- **哈希计算** (M5) - MD5/SHA1/SHA256/SHA512
- **HMAC 计算** (M21) - HMAC-MD5/SHA1/SHA256/SHA512 签名
- **对称加密** (M6) - AES-128/192/256 加解密
- **RSA 非对称加密** (M20) - 密钥对生成、公钥加密、私钥解密、签名验签
- **JWT 解析** (M3) - JWT Token 解析与验证

### 📝 文本处理
- **JSON 格式化** (M13) - JSON 美化、压缩、树形视图
- **CSV 文本格式化** (M23) - CSV/JSON 互转、分隔符调整
- **Markdown 预览** (M22) - 实时渲染、GFM 语法支持
- **文本处理** (M15) - 大小写转换、去重、排序、统计
- **字符统计** (M11) - 字符数、单词数、行数统计
- **文本对比** (M7) - 逐行差异对比
- **正则测试** (M16) - 正则表达式匹配测试

### 🛠️ 开发工具
- **UUID 生成器** (M2) - 批量生成 UUID v1/v4
- **时间戳转换** (M4) - Unix 时间戳与日期互转
- **日期计算器** (M32) - 日期差值、日期加减、星期计算
- **密码生成器** (M12) - 强密码生成、自定义字符集
- **颜色转换** (M14) - Hex/RGB/HSL 互转、取色
- **IP 工具** (M15) - IP 地址转换、CIDR 计算
- **Cron 解析** (M15) - Cron 表达式解析与验证
- **cURL 解析** (M13) - cURL 命令转 JavaScript/Python 代码

### 📊 数据处理
- **数据格式转换** (M18) - JSON/XML/YAML 互转
- **Excel/CSV 转 JSON** (M31) - 表格数据转 JSON 格式
- **JSON Schema 生成** (M28) - 从 JSON 生成 Schema
- **Mock 数据生成** (M29) - 生成测试用假数据
- **数据脱敏** (M30) - 手机号、身份证、邮箱等脱敏
- **SQL 格式化** (M15) - SQL 语句格式化

### 🐳 命令生成器
- **Git 命令生成器** (M26) - 可视化生成 Git 命令（提交、分支、日志、重置等）
- **Docker 命令生成器** (M27) - Docker/Docker Compose 命令生成

### 🌐 网络工具
- **HTTP 接口集合** - 接口管理、历史记录、环境变量、批量测试
- **API 导出** - 支持 Postman、OpenAPI、Apifox、cURL、HTTPie 格式
- **节点转换** - 代理节点格式转换（SS/SSR/VMess/VLESS/Trojan）
- **节点标签** - 为节点添加标签，支持按标签筛选

### 🤖 AI 智能辅助
- **JSON 工具** - AI 生成 JSON、修复语法错误、分析数据结构
- **SQL 工具** - AI 生成 SQL 查询、修复语法错误
- **Mock 数据** - AI 生成测试数据、分析数据质量
- **多 Provider 支持** - OpenAI、Claude、第三方兼容 API

### 💻 系统工具
- **电脑使用管理** - 远程命令执行与凭证管理
- **数据备份** - 应用数据导出与恢复
- **全局搜索** - 快速搜索所有工具和功能

### 🎨 界面特性
- **多主题支持** - 7 种主题（暗色/亮色/可爱/办公/霓虹/赛博朋克/赛博亮色）
- **可爱的狗狗吉祥物** - 随主题变化
- **响应式布局** - 适配不同屏幕尺寸
- **分组导航** - 工具按类别分组管理

## 🔔 最新更新

### v1.2.0 (2025-12-30)

**🎉 重大新功能**
- ✅ **HTTP 接口集合** - 完整的接口管理系统（分组、搜索、历史记录）
- ✅ **AI 智能辅助** - 集成 OpenAI/Claude，支持生成/修复/分析 JSON、SQL、Mock 数据
- ✅ **API 多格式导出** - 支持 Postman、OpenAPI、Apifox、cURL、HTTPie 格式
- ✅ **节点标签系统** - 为代理节点添加标签，支持按标签筛选
- ✅ **全局搜索** - 快速搜索所有工具和功能（Cmd/Ctrl+K）

**🚀 功能增强**
- ✅ 环境变量管理 - HTTP 集合支持变量替换
- ✅ 接口历史记录 - 自动保存测试历史，支持快速恢复
- ✅ 批量接口测试 - 一键执行集合内所有接口
- ✅ AI Provider 管理 - 支持多个 AI 提供商配置和切换

**💎 界面优化**
- ✅ AI Provider 切换样式优化
- ✅ 历史会话样式美化
- ✅ 移除部分不必要的视觉特效

**🐛 Bug 修复**
- ✅ 修复数据库依赖注入问题（HttpCollectionsService、ComputerUsageService）
- ✅ 修复 API 初始化顺序，确保数据库优先创建
- ✅ 修复 NodeConverter 文件不存在时的崩溃问题
- ✅ 修复 Tab ID 映射保持外键完整性
- ✅ 修复父目录不存在导致的写入失败
- ✅ 修复特效在不应出现的区域显示的问题

---

### v1.0.1 (2025-12-16)

**Bug 修复**
- ✅ 修复 M23 CSV 工具缺失的 UI 函数实现（添加 98 行完整逻辑）
- ✅ 修复 Git/Docker 命令预览区域显示过小问题（添加专用 CSS 样式）
- ✅ 修复应用退出后残留 Python 进程问题（影响 3 个项目）

**功能优化**
- ✅ 明确区分 M23"CSV 文本格式化"与 M31"Excel/CSV 转 JSON"的定位
  - M23: 轻量级文本处理（CSV/JSON 互转、分隔符调整）
  - M31: 表格数据转换器（Excel 支持、批量数据迁移）

**系统改进**
- ✅ 为所有 PyWebView 应用添加进程清理机制，确保窗口关闭后正确退出

---

## 📸 截图

<!-- 可以添加应用截图 -->

## 🚀 快速开始

### 方式一：下载预编译版本

前往 [Releases](https://github.com/xrjjing/doggy-toolbox/releases) 下载对应平台的安装包。

### 方式二：从源码运行

```bash
# 克隆项目
git clone https://github.com/xrjjing/doggy-toolbox.git
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
│   ├── pages/           # 页面片段（按需注入）
│   ├── styles.css       # 样式表
│   ├── js/              # 拆分后的前端主逻辑
│   │   ├── app_state.js         # 全局状态（集中管理）
│   │   ├── app_core.js          # 启动/导航/主题/页面加载
│   │   ├── app_computer_usage.js# 凭证/命令/页签
│   │   ├── app_nodes_converter.js# 节点转换/节点列表
│   │   └── app_tools_*.js       # 工具页逻辑（分文件）
│   ├── app.js           # 兼容占位（已拆分）
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
