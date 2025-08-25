#!/bin/bash

echo "=== Comprehensive terminology fix ==="

# 1. Fix Sidebar component - Remove "main" from commander and add branch state
echo "1. Fixing Sidebar component..."
cat > /tmp/sidebar_patch.txt << 'EOF'
--- a/src/components/sidebar/Sidebar.tsx
+++ b/src/components/sidebar/Sidebar.tsx
@@ -74,6 +74,7 @@
     const [filterMode, setFilterMode] = useState<FilterMode>(defaultFilter)
     const [sortMode, setSortMode] = useState<SortMode>(defaultSort)
     const [idleByTime, setIdleByTime] = useState<Set<string>>(new Set())
+    const [commanderBranch, setCommanderBranch] = useState<string>('main')
     
     // Separate running and plan sessions
     const contextSessions = allSessions.filter(s => s.info.session_id !== 'commander')
@@ -141,6 +142,14 @@
         [contextSessions]
     )
 
+    // Fetch current branch for commander
+    useEffect(() => {
+        invoke<string>('get_current_branch_name', { sessionName: null })
+            .then(branch => setCommanderBranch(branch))
+            .catch(() => setCommanderBranch('main'))
+    }, [])
+
     // Session actions (cancel, ready, convert)
     const [markReadyModalOpen, setMarkReadyModalOpen] = useState(false)
     const [convertToDraftModalOpen, setConvertToDraftModalOpen] = useState(false)
@@ -505,9 +514,9 @@
                     title="Select commander (⌘1)"
                 >
                     <div className="flex items-center justify-between">
-                        <div className="font-medium text-slate-100">main (commander)</div>
+                        <div className="font-medium text-slate-100">commander</div>
                     <div className="flex items-center gap-2">
                         <span className="text-xs px-1.5 py-0.5 rounded bg-slate-700/50 text-slate-400">⌘1</span>
-                        <span className="text-xs px-1.5 py-0.5 rounded bg-blue-600/20 text-blue-400">main repo</span>
+                        <span className="text-xs px-1.5 py-0.5 rounded bg-blue-600/20 text-blue-400">{commanderBranch}</span>
                     </div>
                     </div>
EOF
cd /Users/marius.wichtner/Documents/git/para-ui/.schaltwerk/worktrees/priceless_brattain
patch -p0 < /tmp/sidebar_patch.txt 2>/dev/null || true

# 2. Fix NewSessionModal - conditional heading and button text
echo "2. Fixing NewSessionModal component..."
perl -pi -e '
  # Fix the heading to be conditional
  s/<div className="px-4 py-3 border-b border-slate-800 text-slate-200 font-medium">Start new agent<\/div>/<div className="px-4 py-3 border-b border-slate-800 text-slate-200 font-medium">{createAsDraft ? "Create new plan" : "Start new agent"}<\/div>/g;
  
  # Fix the button text
  s/<span>\{createAsDraft \? .Create Plan. : .Create.\}<\/span>/<span>{createAsDraft ? "Create Plan" : "Start Agent"}<\/span>/g;
  
  # Fix the title attribute
  s/title=\{!isValidBranch \? "Please select a valid branch" : createAsDraft \? "Create plan \(Cmd\+Enter\)" : "Create agent \(Cmd\+Enter\)"\}/title={!isValidBranch ? "Please select a valid branch" : createAsDraft ? "Create plan (Cmd+Enter)" : "Start agent (Cmd+Enter)"}/g;
' src/components/modals/NewSessionModal.tsx

# 3. Fix tutorial/onboarding terminology
echo "3. Fixing tutorial terminology..."
perl -pi -e '
  # Fix "plan agents" to "plans"
  s/"Which of my plan agents are most important to continue\?"/"Which of my plans are most important to continue?"/g;
  
  # Fix "refine your agent description"
  s/Use plans to refine your agent description, gather requirements/Use plans to gather requirements, design solutions/g;
  
  # Fix "Create sessions" to proper terminology
  s/Create sessions with/Start agents with/g;
  
  # Fix "reviewed sessions"
  s/"Find all reviewed sessions with the Schaltwerk MCP/"Find all reviewed agents with the Schaltwerk MCP/g;
' src/components/onboarding/steps.tsx

# 4. Fix other plan-related button texts
echo "4. Fixing other button texts..."
find src -type f \( -name "*.tsx" -o -name "*.ts" \) -exec perl -pi -e '
  # Fix any remaining "Run plan" or "Create agent" buttons
  s/>\s*Run Plan\s*</Start Plan</g;
  s/>\s*Create Agent\s*</Start Agent</g;
  s/>\s*Run Agent\s*</Start Agent</g;
' {} \;

# 5. Fix test files that mock these components
echo "5. Updating test mocks..."
find src -type f -name "*.test.tsx" -exec perl -pi -e '
  s/"main \(commander\)"/"commander"/g;
  s/>main \(commander\)</>commander</g;
' {} \;

echo "=== Terminology fix complete! ==="