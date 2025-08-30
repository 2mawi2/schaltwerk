#!/bin/bash

# Script to fix remaining test terminology issues

set -e

echo "Fixing remaining test issues..."

# Fix "Create spec" to "Create spec" in tests
echo "Fixing 'Create spec' to 'Create spec' in test expectations..."
find src -name "*.test.tsx" -o -name "*.test.ts" | xargs sed -i.bak 's/Create spec/Create spec/g'

# Fix other button text expectations in tests
echo "Fixing button text expectations..."
find src -name "*.test.tsx" -o -name "*.test.ts" | xargs sed -i.bak 's/Start spec/Start spec/g'

# Fix status badge text in tests (they might be checking for "Spec" badge)
echo "Fixing status badge expectations in tests..."
find src -name "*.test.tsx" -o -name "*.test.ts" | xargs sed -i.bak 's/Spec<\/span>/Spec<\/span>/g'

# Also check for other badge-related text
find src -name "*.test.tsx" -o -name "*.test.ts" | xargs sed -i.bak 's/>Spec</>Spec</g'

# Clean up backup files
echo "Cleaning up backup files..."
find src -name "*.bak" -delete

echo "Remaining test fixes complete!"

# Now let's also check what status badges are showing in the actual components
echo ""
echo "Checking SessionCard component for status badge issues..."
grep -n "Spec\|spec" src/components/shared/SessionCard.tsx || echo "No 'Spec' references found in SessionCard"