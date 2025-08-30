#!/bin/bash

# Script to fix all remaining test terminology issues from Specs→Specs renaming

set -e

echo "Fixing test terminology issues..."

# Fix test-spec to test-spec in data-testid expectations
echo "Fixing test-spec to test-spec in test files..."
find src -name "*.test.tsx" -o -name "*.test.ts" | xargs sed -i.bak 's/test-spec/test-spec/g'

# Fix session-card-test-spec to session-card-test-spec  
echo "Fixing session-card-test-spec to session-card-test-spec..."
find src -name "*.test.tsx" -o -name "*.test.ts" | xargs sed -i.bak 's/session-card-test-spec/session-card-test-spec/g'

# Fix run-draft-test-spec to run-draft-test-spec
echo "Fixing run-draft-test-spec to run-draft-test-spec..."
find src -name "*.test.tsx" -o -name "*.test.ts" | xargs sed -i.bak 's/run-draft-test-spec/run-draft-test-spec/g'

# Fix any remaining "Spec" to "Spec" in test descriptions and expectations
echo "Fixing remaining Spec/Spec inconsistencies..."
find src -name "*.test.tsx" -o -name "*.test.ts" | xargs sed -i.bak 's/"Spec"/"Spec"/g'
find src -name "*.test.tsx" -o -name "*.test.ts" | xargs sed -i.bak "s/'Spec'/'Spec'/g"

# Fix event types in tests
echo "Fixing event types..."
find src -name "*.test.tsx" -o -name "*.test.ts" | xargs sed -i.bak 's/start-agent-from-spec/start-agent-from-spec/g'

# Clean up backup files
echo "Cleaning up backup files..."
find src -name "*.bak" -delete

echo "Test terminology fixes complete!"
echo "Run 'npm run test' to verify fixes."