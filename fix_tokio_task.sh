#!/bin/bash
set -e

echo "Fixing tokio::task references that were incorrectly renamed..."

# Fix tokio::agent back to tokio::task
find src-tauri -name "*.rs" | \
  xargs perl -pi -e 's/tokio::agent/tokio::task/g'

# Also fix any "spawn agent" error messages back to "spawn task"
find src-tauri -name "*.rs" | \
  xargs perl -pi -e 's/Failed to spawn agent/Failed to spawn task/g'

echo "Fixed tokio::task references"