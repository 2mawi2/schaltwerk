#!/bin/bash

echo "=== Final comprehensive terminology fix ==="

# 1. Fix Sidebar component properly
echo "1. Fixing Sidebar component..."
perl -pi -e '
  # Remove "main" from commander display
  s/<div className="font-medium text-slate-100">main \(commander\)<\/div>/<div className="font-medium text-slate-100">commander<\/div>/g;
  
  # Fix the badge text
  s/<span className="text-xs px-1\.5 py-0\.5 rounded bg-blue-600\/20 text-blue-400">main repo<\/span>/<span className="text-xs px-1.5 py-0.5 rounded bg-blue-600\/20 text-blue-400">{commanderBranch}<\/span>/g;
  
  # Fix description
  s/Original repository from which sessions are created/Original repository from which agents are created/g;
' src/components/sidebar/Sidebar.tsx

# Add commanderBranch state to Sidebar (if not already there)
if ! grep -q "commanderBranch, setCommanderBranch" src/components/sidebar/Sidebar.tsx; then
  perl -pi -e '
    s/(const \[idleByTime, setIdleByTime\] = useState)/$1/;
    if (/const \[idleByTime, setIdleByTime\] = useState/) {
      $_ .= "    const [commanderBranch, setCommanderBranch] = useState<string>(\"main\")\n";
    }
  ' src/components/sidebar/Sidebar.tsx
  
  # Add effect to fetch branch
  perl -pi -e '
    if (/\/\/ Compute time-based idle sessions/) {
      print "    // Fetch current branch for commander\n";
      print "    useEffect(() => {\n";
      print "        invoke<string>(\"get_current_branch_name\", { sessionName: null })\n";
      print "            .then(branch => setCommanderBranch(branch))\n";
      print "            .catch(() => setCommanderBranch(\"main\"))\n";
      print "    }, [])\n\n";
    }
  ' src/components/sidebar/Sidebar.tsx
fi

# 2. Fix tutorial terminology completely
echo "2. Fixing all tutorial terminology..."
perl -pi -e '
  # Fix switch sessions
  s/Switch sessions instantly/Switch agents instantly/g;
  
  # Fix any remaining session references in context
  s/managing AI-powered development sessions/managing AI-powered development agents/g;
  s/Session list and project navigation/Agent list and project navigation/g;
  s/Regular Sessions/Running Agents/g;
  s/Plan Sessions/Plans/g;
  s/switch sessions/switch agents/g;
  s/specific session/specific agent/g;
  s/managing all sessions/managing all agents/g;
  s/Plan agents → Launch sessions/Create plans → Start agents/g;
  s/Launch sessions/Start agents/g;
  s/reviewed sessions/reviewed agents/g;
' src/components/onboarding/steps.tsx

# 3. Fix SettingsModal keyboard shortcuts terminology
echo "3. Fixing SettingsModal terminology..."
perl -pi -e '
  # Fix session references in keyboard shortcuts
  s/navigate between sessions/navigate between agents/g;
  s/starting sessions with/starting agents with/g;
  s/all sessions in this/all agents in this/g;
  s/Name of the session/Name of the agent/g;
  s/commander and session views/commander and agent views/g;
' src/components/modals/SettingsModal.tsx

# 4. Fix test files that might have hardcoded strings
echo "4. Updating test files..."
find src -type f -name "*.test.tsx" -exec perl -pi -e '
  s/"main \(commander\)"/"commander"/g;
  s/>main \(commander\)</>commander</g;
' {} \;

# 5. Fix any remaining "Create" buttons to "Start" for agents
echo "5. Standardizing button terminology..."
find src -type f \( -name "*.tsx" -o -name "*.ts" \) -exec perl -pi -e '
  # Only change Create to Start for agent-related buttons, not for plans
  s/>Create Agent</>Start Agent</g;
  s/"Create Agent"/"Start Agent"/g;
  s/>Run Agent</>Start Agent</g;
  s/"Run Agent"/"Start Agent"/g;
' {} \;

echo "=== Final terminology fix complete! ==="