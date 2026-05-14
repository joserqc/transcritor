#!/bin/bash
# Local launcher for Transcritor.
# Auto-detects project directory; safe to symlink or call from anywhere.

set -e

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VENV_DIR="$PROJECT_DIR/.venv"
WEB_DIR="$PROJECT_DIR/web"

BACKEND_PORT="${TRANSCRITOR_BACKEND_PORT:-8001}"
FRONTEND_PORT="${TRANSCRITOR_FRONTEND_PORT:-5174}"
BACKEND_LOG="${TRANSCRITOR_BACKEND_LOG:-/tmp/transcritor-backend.log}"
FRONTEND_LOG="${TRANSCRITOR_FRONTEND_LOG:-/tmp/transcritor-frontend.log}"

GREEN='\033[0;32m'
BLUE='\033[0;34m'
RED='\033[0;31m'
NC='\033[0m'

echo -e "${BLUE}Starting Transcritor Local...${NC}"

if lsof -i ":$BACKEND_PORT" -i ":$FRONTEND_PORT" >/dev/null 2>&1; then
    echo -e "${RED}Services already running.${NC}"
    (setsid xdg-open "http://127.0.0.1:$FRONTEND_PORT" &) &
    exit 0
fi

cd "$PROJECT_DIR"

if [ ! -d "$VENV_DIR" ]; then
    echo -e "${RED}Virtualenv not found at $VENV_DIR. Run: python3 -m venv .venv && pip install -r requirements.txt${NC}"
    exit 1
fi

echo -e "${BLUE}Backend (FastAPI) on :$BACKEND_PORT${NC}"
# shellcheck disable=SC1091
source "$VENV_DIR/bin/activate"
nohup uvicorn transcritor.server:app --host 127.0.0.1 --port "$BACKEND_PORT" > "$BACKEND_LOG" 2>&1 &

sleep 3

echo -e "${BLUE}Frontend (Vite) on :$FRONTEND_PORT${NC}"
cd "$WEB_DIR"
nohup npm run dev -- --host 127.0.0.1 --port "$FRONTEND_PORT" > "$FRONTEND_LOG" 2>&1 &

sleep 4

if ! lsof -i ":$BACKEND_PORT" >/dev/null 2>&1; then
    echo -e "${RED}Backend failed to start. See $BACKEND_LOG${NC}"
    exit 1
fi
if ! lsof -i ":$FRONTEND_PORT" >/dev/null 2>&1; then
    echo -e "${RED}Frontend failed to start. See $FRONTEND_LOG${NC}"
    exit 1
fi

echo -e "${GREEN}Up.${NC}"
echo -e "${BLUE}Backend:  http://127.0.0.1:$BACKEND_PORT${NC}"
echo -e "${BLUE}Frontend: http://127.0.0.1:$FRONTEND_PORT${NC}"

(setsid xdg-open "http://127.0.0.1:$FRONTEND_PORT" >/dev/null 2>&1 &) &

echo ""
echo "Stop with: ./stop.sh"
echo "Logs:      $BACKEND_LOG  |  $FRONTEND_LOG"
sleep 2
