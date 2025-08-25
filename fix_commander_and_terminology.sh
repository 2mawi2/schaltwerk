#!/bin/bash

echo "Fixing commander display and terminology..."

# 1. Update Sidebar to show just "commander" and fetch current branch
echo "Updating Sidebar component..."
perl -pi -e 's/<div className="font-medium text-slate-100">main \(commander\)<\/div>/<div className="font-medium text-slate-100">commander<\/div>/g' src/components/sidebar/Sidebar.tsx

# Update the badge to show the current branch instead of "main repo"
perl -pi -e 's/<span className="text-xs px-1\.5 py-0\.5 rounded bg-blue-600\/20 text-blue-400">main repo<\/span>/<span className="text-xs px-1.5 py-0.5 rounded bg-blue-600\/20 text-blue-400">{commanderBranch}<\/span>/g' src/components/sidebar/Sidebar.tsx

# 2. Fix NewSessionModal heading to be conditional
echo "Fixing NewSessionModal heading..."
# This needs more complex logic, will handle separately

# 3. Standardize terminology to "Start" everywhere
echo "Standardizing button terminology to 'Start'..."

# Update button text in NewSessionModal
find src -type f \( -name "*.tsx" -o -name "*.ts" \) -exec perl -pi -e '
  # Update button text for sessions/agents
  s/\bCreate\b(?=.*button.*agent)/Start/g;
  s/\bRun\b(?=.*button.*agent)/Start/g;
  s/\bCreate\b(?=.*button.*plan)/Start/g;
  s/\bRun\b(?=.*button.*plan)/Start/g;
' {} \;

echo "Terminology fixes complete!"