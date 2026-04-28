#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

PYTHON_BIN="${PYTHON:-python}"
if [ -x ".venv/bin/python" ]; then
  PYTHON_BIN=".venv/bin/python"
fi

echo "==> Python tests"
"$PYTHON_BIN" -m pytest

echo "==> Web build"
npm run build

echo "==> Python package build"
"$PYTHON_BIN" -m pip install --upgrade build
"$PYTHON_BIN" -m build

echo "==> Release preflight passed"
