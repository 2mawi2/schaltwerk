#!/bin/bash

# Start the Schaltwerk MCP Server
# This script is called when the Tauri app starts

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
MCP_DIR="$SCRIPT_DIR"

if command -v bun >/dev/null 2>&1; then
  PM="bun"
  INSTALL_CMD="bun install"
  BUILD_CMD="bun run build"
else
  PM="npm"
  INSTALL_CMD="npm install"
  BUILD_CMD="npm run build"
fi

# Check if node_modules exists, if not install dependencies
if [ ! -d "$MCP_DIR/node_modules" ]; then
  echo "Installing MCP server dependencies..."
  cd "$MCP_DIR" && $INSTALL_CMD
fi

# Build the TypeScript code if needed
if [ ! -d "$MCP_DIR/build" ]; then
  echo "Building MCP server..."
  cd "$MCP_DIR" && $BUILD_CMD
fi

# Start the MCP server
echo "Starting Schaltwerk MCP server..."
cd "$MCP_DIR" && node build/schaltwerk-mcp-server.js
