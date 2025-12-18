#!/usr/bin/env bash
set -uo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

TS="$(date "+%Y%m%d_%H%M%S")"
REPORT_DIR="test_reports"
mkdir -p "$REPORT_DIR"
REPORT_FILE="$REPORT_DIR/regression_${TS}.log"

PY_BIN="python"
if [ -x ".venv/bin/python" ]; then
  PY_BIN=".venv/bin/python"
fi

{
  echo "=== 回归测试报告 ==="
  echo "时间: $(date "+%F %T %Z")"
  echo "工作目录: $ROOT_DIR"
  echo "Python: $("$PY_BIN" -V 2>&1)"
  echo "Node: $(node -v 2>&1 || echo "未安装")"
  echo

  run_step() {
    local title="$1"
    shift
    echo "== $title =="
    local start end rc
    start="$(date +%s)"
    set +e
    "$@"
    rc=$?
    set -e
    end="$(date +%s)"
    if [ $rc -eq 0 ]; then
      echo "结果: ✓ 通过"
    else
      echo "结果: ✗ 失败（退出码 $rc）"
    fi
    echo "耗时: $((end-start))s"
    echo
    return 0
  }

  set -e

  run_step "1) 前端拆分静态审计" "$PY_BIN" "scripts/frontend_split_audit.py"
  echo

  run_step "2) 前端脚本语法检查（node --check）" bash -lc '
    node --check "web/js/app_state.js" &&
    node --check "web/js/app_core.js" &&
    node --check "web/js/app_computer_usage.js" &&
    node --check "web/js/app_nodes_converter.js" &&
    node --check "web/js/app_tools_a.js" &&
    node --check "web/js/app_tools_b.js" &&
    node --check "web/js/app_tools_c.js"
  '

  run_step "3) Node 单测（tests/*.js）" bash -lc '
    for f in tests/*.js; do
      echo
      echo "--- node \"$f\" ---"
      node "$f"
    done
  '

  run_step "4) 启动准备耗时测量（scripts/measure_startup_prepare.py）" "$PY_BIN" "scripts/measure_startup_prepare.py"

  run_step "5) Python 启动自检（test_startup.py）" "$PY_BIN" "test_startup.py"

  run_step "6) 打包配置校验（verify_build.py）" "$PY_BIN" "verify_build.py"

  run_step "7) PyInstaller 打包测试（build.py）" "$PY_BIN" "build.py"

  echo "== 8) 打包产物资源核查（dist） =="
  DIST_DIR="dist/狗狗百宝箱.app/Contents/Resources/web"
  if [ -d "$DIST_DIR" ]; then
    echo "找到: $DIST_DIR"
    echo "页面片段数量: $(find "$DIST_DIR/pages" -maxdepth 1 -name "*.html" 2>/dev/null | wc -l | tr -d " ")"
    echo "拆分脚本数量: $(find "$DIST_DIR/js" -maxdepth 1 -name "app_*.js" 2>/dev/null | wc -l | tr -d " ")"
    echo "工具模块数量: $(find "$DIST_DIR" -maxdepth 1 -name "tools_m*.js" 2>/dev/null | wc -l | tr -d " ")"
  else
    echo "未找到预期 web 资源目录（可能是 onedir 结构不同）：$DIST_DIR"
    echo "dist 目录内容："
    ls -la "dist" || true
  fi
  echo

  echo "=== 结束时间: $(date "+%F %T %Z") ==="
} 2>&1 | tee "$REPORT_FILE"

echo
echo "✅ 回归测试完成，报告已保存：$REPORT_FILE"
