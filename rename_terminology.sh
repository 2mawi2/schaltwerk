#!/bin/bash
set -e

echo "Starting terminology rename: Draft→Plan, Task→Agent, Orchestrator→Commander"

# Draft → Plan replacements
echo "Renaming Draft to Plan..."
find . -type f \( -name "*.ts" -o -name "*.tsx" -o -name "*.rs" -o -name "*.md" -o -name "*.yml" -o -name "*.toml" -o -name "*.json" \) \
  -not -path "./node_modules/*" \
  -not -path "./target/*" \
  -not -path "./.git/*" \
  -not -path "./dist/*" \
  -not -path "./src-tauri/target/*" \
  -not -path "./mcp-server/node_modules/*" \
  -not -path "./mcp-server/dist/*" \
  -not -path "./package-lock.json" \
  -not -path "./mcp-server/package-lock.json" \
  -not -path "./src-tauri/Cargo.lock" | \
  xargs perl -pi -e '
    s/\bdraft\b/plan/g;
    s/\bDraft\b/Plan/g;
    s/\bDRAFT\b/PLAN/g;
    s/\bdrafts\b/plans/g;
    s/\bDrafts\b/Plans/g;
    s/\bDRAFTS\b/PLANS/g;
  '

# Task → Agent replacements (for session context)
echo "Renaming Task to Agent..."
find . -type f \( -name "*.ts" -o -name "*.tsx" -o -name "*.rs" -o -name "*.md" -o -name "*.yml" -o -name "*.toml" -o -name "*.json" \) \
  -not -path "./node_modules/*" \
  -not -path "./target/*" \
  -not -path "./.git/*" \
  -not -path "./dist/*" \
  -not -path "./src-tauri/target/*" \
  -not -path "./mcp-server/node_modules/*" \
  -not -path "./mcp-server/dist/*" \
  -not -path "./package-lock.json" \
  -not -path "./mcp-server/package-lock.json" \
  -not -path "./src-tauri/Cargo.lock" | \
  xargs perl -pi -e '
    # Replace DraftTask with PlanAgent first to avoid double replacement
    s/\bDraftTask/PlanAgent/g;
    s/\bdraftTask/planAgent/g;
    
    # Now replace general Task/task but exclude specific contexts
    # Skip replacements in task management tools context (package.json scripts, etc)
    unless (/npm run|just |Task tool|TodoWrite|task\.json|\.task\b/) {
      s/\bTask\b/Agent/g;
      s/\btask\b/agent/g;
      s/\bTASK\b/AGENT/g;
      s/\bTasks\b/Agents/g;
      s/\btasks\b/agents/g;
      s/\bTASKS\b/AGENTS/g;
    }
  '

# Orchestrator → Commander replacements
echo "Renaming Orchestrator to Commander..."
find . -type f \( -name "*.ts" -o -name "*.tsx" -o -name "*.rs" -o -name "*.md" -o -name "*.yml" -o -name "*.toml" -o -name "*.json" \) \
  -not -path "./node_modules/*" \
  -not -path "./target/*" \
  -not -path "./.git/*" \
  -not -path "./dist/*" \
  -not -path "./src-tauri/target/*" \
  -not -path "./mcp-server/node_modules/*" \
  -not -path "./mcp-server/dist/*" \
  -not -path "./package-lock.json" \
  -not -path "./mcp-server/package-lock.json" \
  -not -path "./src-tauri/Cargo.lock" | \
  xargs perl -pi -e '
    s/\borchestrator\b/commander/g;
    s/\bOrchestrator\b/Commander/g;
    s/\bORCHESTRATOR\b/COMMANDER/g;
    s/\bOrchestrators\b/Commanders/g;
    s/\borchestrators\b/commanders/g;
    
    # Also update specific component names
    s/SwitchOrchestrator/SwitchCommander/g;
    s/switchOrchestrator/switchCommander/g;
  '

echo "Rename complete!"