#!/bin/bash
# Stop Transcritor Local services.

BACKEND_PORT="${TRANSCRITOR_BACKEND_PORT:-8001}"
FRONTEND_PORT="${TRANSCRITOR_FRONTEND_PORT:-5174}"

RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m'

echo -e "${RED}Stopping Transcritor Local...${NC}"

pkill -f "uvicorn transcritor.server" && echo -e "${GREEN}Backend stopped${NC}" || true
pkill -f "vite.*${FRONTEND_PORT}" && echo -e "${GREEN}Frontend stopped${NC}" || true

sleep 2

if lsof -i ":$BACKEND_PORT" >/dev/null 2>&1 || lsof -i ":$FRONTEND_PORT" >/dev/null 2>&1; then
    echo -e "${RED}Some processes still listening:${NC}"
    lsof -i ":$BACKEND_PORT" -i ":$FRONTEND_PORT"
    exit 1
fi

echo -e "${GREEN}All stopped.${NC}"
