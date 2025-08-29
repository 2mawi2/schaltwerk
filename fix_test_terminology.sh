#!/bin/bash

# Script to fix all remaining test terminology issues from Plans→Specs renaming

set -e

echo "Fixing test terminology issues..."

# Fix test-spec to test-plan in data-testid expectations
echo "Fixing test-spec to test-plan in test files..."
find src -name "*.test.tsx" -o -name "*.test.ts" | xargs sed -i.bak 's/test-spec/test-plan/g'

# Fix session-card-test-spec to session-card-test-plan  
echo "Fixing session-card-test-spec to session-card-test-plan..."
find src -name "*.test.tsx" -o -name "*.test.ts" | xargs sed -i.bak 's/session-card-test-spec/session-card-test-plan/g'

# Fix run-draft-test-spec to run-draft-test-plan
echo "Fixing run-draft-test-spec to run-draft-test-plan..."
find src -name "*.test.tsx" -o -name "*.test.ts" | xargs sed -i.bak 's/run-draft-test-spec/run-draft-test-plan/g'

# Fix any remaining "Plan" to "Spec" in test descriptions and expectations
echo "Fixing remaining Plan/Spec inconsistencies..."
find src -name "*.test.tsx" -o -name "*.test.ts" | xargs sed -i.bak 's/"Plan"/"Spec"/g'
find src -name "*.test.tsx" -o -name "*.test.ts" | xargs sed -i.bak "s/'Plan'/'Spec'/g"

# Fix event types in tests
echo "Fixing event types..."
find src -name "*.test.tsx" -o -name "*.test.ts" | xargs sed -i.bak 's/start-agent-from-plan/start-agent-from-spec/g'

# Clean up backup files
echo "Cleaning up backup files..."
find src -name "*.bak" -delete

echo "Test terminology fixes complete!"
echo "Run 'npm run test' to verify fixes."