#!/usr/bin/env python3
"""验证打包配置"""

import sys
import platform
from pathlib import Path

print("=== 验证打包配置 ===\n")

root = Path(__file__).parent
success = True

# 1. 检查 PyInstaller
print("1. 检查 PyInstaller...")
try:
    import PyInstaller

    print(f"   ✓ PyInstaller 已安装 (版本 {PyInstaller.__version__})")
except ImportError:
    print("   ✗ PyInstaller 未安装")
    success = False

# 2. 检查主程序文件
print("\n2. 检查主程序文件...")
main_py = root / "main.py"
if main_py.exists():
    print("   ✓ main.py 存在")
else:
    print("   ✗ main.py 不存在")
    success = False

# 3. 检查 web 目录
print("\n3. 检查 web 目录...")
web_dir = root / "web"
if web_dir.exists() and web_dir.is_dir():
    print("   ✓ web 目录存在")

    # 统计资源文件
    html_files = list(web_dir.rglob("*.html"))
    css_files = list(web_dir.rglob("*.css"))
    js_files = list(web_dir.rglob("*.js"))
    tool_scripts = list(web_dir.glob("tools_m*.js"))
    page_fragments = list((web_dir / "pages").glob("*.html")) if (web_dir / "pages").exists() else []
    split_app_scripts = list((web_dir / "js").glob("app_*.js")) if (web_dir / "js").exists() else []

    print(f"   - HTML 文件: {len(html_files)}")
    print(f"     - 页面片段 web/pages/*.html: {len(page_fragments)}")
    print(f"   - CSS 文件: {len(css_files)}")
    print(f"   - JS 文件: {len(js_files)} (其中工具模块: {len(tool_scripts)}，拆分入口脚本: {len(split_app_scripts)})")
else:
    print("   ✗ web 目录不存在")
    success = False

# 4. 检查图标文件
print("\n4. 检查图标文件...")
system = platform.system()

if system == "Darwin":
    icon_file = root / "icon.icns"
    if icon_file.exists():
        size_kb = icon_file.stat().st_size / 1024
        print(f"   ✓ icon.icns 存在 ({size_kb:.1f} KB)")
    else:
        print("   ⚠ icon.icns 不存在（可选）")
elif system == "Windows":
    icon_file = root / "icon.ico"
    if icon_file.exists():
        size_kb = icon_file.stat().st_size / 1024
        print(f"   ✓ icon.ico 存在 ({size_kb:.1f} KB)")
    else:
        print("   ⚠ icon.ico 不存在（可选）")
else:
    print(f"   ℹ 当前系统: {system} (不需要特定图标)")

# 5. 检查依赖模块
print("\n5. 检查依赖模块...")
required_modules = [
    ("webview", "pywebview"),
    ("api", "api.py"),
    ("services", "services 目录"),
]

for module_name, display_name in required_modules:
    try:
        if module_name == "api":
            from api import Api
        elif module_name == "services":
            from services import ComputerUsageService, NodeConverterService
        else:
            __import__(module_name)
        print(f"   ✓ {display_name} 可以正常导入")
    except ImportError as e:
        print(f"   ✗ {display_name} 导入失败: {e}")
        success = False

# 6. 生成打包命令预览
print("\n6. 打包命令预览...")
print(f"   平台: {platform.system()} ({platform.machine()})")
print(f"   Python: {sys.version.split()[0]}")

cmd_parts = [
    sys.executable,
    "-m",
    "PyInstaller",
    "--onedir",
    "--windowed",
    "-y",
    "--name",
    "狗狗百宝箱",
    "--add-data",
    f"web:web",
]

if system == "Darwin" and (root / "icon.icns").exists():
    cmd_parts.extend(["--icon", "icon.icns"])
    if platform.machine() == "arm64":
        cmd_parts.extend(["--target-arch", "arm64"])
elif system == "Windows" and (root / "icon.ico").exists():
    cmd_parts.extend(["--icon", "icon.ico"])

cmd_parts.append("main.py")

print(f"\n   命令: {' '.join(cmd_parts)}\n")

# 7. 检查打包脚本
print("7. 检查打包脚本...")
build_script = root / "build.py"
if build_script.exists():
    print("   ✓ build.py 存在")
    print("   提示: 运行 'python build.py' 开始打包")
else:
    print("   ✗ build.py 不存在")
    success = False

# 总结
print("\n" + "=" * 50)
if success:
    print("✅ 打包配置验证通过！项目可以正常打包")
    print("\n打包步骤:")
    print("  1. 运行: python build.py")
    print("  2. 等待打包完成（可能需要几分钟）")
    print("  3. 打包结果位于: dist/狗狗百宝箱/")
else:
    print("❌ 打包配置存在问题，请检查上述错误")
    sys.exit(1)
print("=" * 50 + "\n")
