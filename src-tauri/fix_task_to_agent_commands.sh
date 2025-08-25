#!/bin/bash

echo "Renaming task-related Tauri commands to use 'agent' terminology..."

# Rename the Rust command function
echo "Updating Rust command definitions..."
find src-tauri -type f -name "*.rs" -exec perl -pi -e '
  s/para_core_get_session_task_content/para_core_get_session_agent_content/g;
' {} \;

# Update TypeScript/React invocations
echo "Updating TypeScript invocations..."
find src -type f \( -name "*.ts" -o -name "*.tsx" \) -exec perl -pi -e '
  s/para_core_get_session_task_content/para_core_get_session_agent_content/g;
' {} \;

echo "Task to agent command renaming complete!"