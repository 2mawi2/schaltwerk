#!/bin/bash
set -e

echo "Fixing draft_content references to plan_content..."

# Fix Rust code references to draft_content
find src-tauri -name "*.rs" | \
  xargs perl -pi -e '
    s/\bdraft_content\b/plan_content/g;
    s/update_draft_content/update_plan_content/g;
    s/append_draft_content/append_plan_content/g;
  '

echo "Fixed draft_content references in Rust code"