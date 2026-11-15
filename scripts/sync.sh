#!/usr/bin/env bash
# Run as the dedicated repository owner. No credentials belong in this file.
set -euo pipefail
PROJECT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_DIR"
exec 9> .sync.lock
if ! flock -n 9; then
  echo '已有同步任务在运行，跳过。'
  exit 0
fi
export GIT_TERMINAL_PROMPT=0
if [ -n "$(git status --porcelain)" ]; then
  echo '工作区有未提交内容，请先处理，停止自动同步。' >&2
  exit 1
fi
if [ "$(git branch --show-current)" != 'main' ]; then
  echo '请在专用 main 分支检出中运行同步。' >&2
  exit 1
fi
git pull --ff-only origin main
python3 scripts/fetch_menu.py
if ! git diff --quiet -- docs/data/menus.json; then
  git add -- docs/data/menus.json
  git commit -m 'Update school menus'
fi
# Also retry a previous successful commit whose push failed temporarily.
git push origin HEAD:main
