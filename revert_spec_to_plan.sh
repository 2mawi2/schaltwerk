#!/bin/bash

# Script to revert all "spec" terminology back to "spec" to match consolidated main architecture

set -e

echo "Reverting spec terminology back to spec..."

# Fix directory structure - rename specs/ back to specs/
echo "Renaming specs/ directory back to specs/..."
if [ -d "src/components/specs" ]; then
    mv "src/components/specs" "src/components/specs"
    echo "Renamed src/components/specs -> src/components/specs"
fi

# Rename all spec component files back to spec
echo "Renaming spec component files back to spec..."
find src/components/specs -name "*Spec*" -type f | while read -r file; do
    new_name=$(echo "$file" | sed 's/Spec/Spec/g')
    mv "$file" "$new_name"
    echo "Renamed $file -> $new_name"
done

# Update all imports from specs/ to specs/
echo "Updating imports from specs/ to specs/..."
find src -name "*.ts" -o -name "*.tsx" | grep -v node_modules | xargs sed -i '' 's|from '\''../specs/|from '\''../specs/|g'
find src -name "*.ts" -o -name "*.tsx" | grep -v node_modules | xargs sed -i '' 's|from "./specs/|from "./specs/|g'

# Update component names from Spec* to Spec*
echo "Updating component names from Spec* to Spec*..."
find src -name "*.ts" -o -name "*.tsx" | grep -v node_modules | xargs sed -i '' 's/SpecPlaceholder/SpecPlaceholder/g'
find src -name "*.ts" -o -name "*.tsx" | grep -v node_modules | xargs sed -i '' 's/SpecContentView/SpecContentView/g'
find src -name "*.ts" -o -name "*.tsx" | grep -v node_modules | xargs sed -i '' 's/SpecListView/SpecListView/g'
find src -name "*.ts" -o -name "*.tsx" | grep -v node_modules | xargs sed -i '' 's/SpecInfoPanel/SpecInfoPanel/g'
find src -name "*.ts" -o -name "*.tsx" | grep -v node_modules | xargs sed -i '' 's/SpecMetadataPanel/SpecMetadataPanel/g'
find src -name "*.ts" -o -name "*.tsx" | grep -v node_modules | xargs sed -i '' 's/SpecModeLayout/SpecModeLayout/g'
find src -name "*.ts" -o -name "*.tsx" | grep -v node_modules | xargs sed -i '' 's/SpecEditor/SpecEditor/g'
find src -name "*.ts" -o -name "*.tsx" | grep -v node_modules | xargs sed -i '' 's/SpecAgentPanel/SpecAgentPanel/g'
find src -name "*.ts" -o -name "*.tsx" | grep -v node_modules | xargs sed -i '' 's/ConvertToSpecConfirmation/ConvertToSpecConfirmation/g'
find src -name "*.ts" -o -name "*.tsx" | grep -v node_modules | xargs sed -i '' 's/DeleteSpecConfirmation/DeleteSpecConfirmation/g'

# Update function names from createSpec back to createDraft
echo "Updating function names from createSpec back to createDraft..."
find src -name "*.ts" -o -name "*.tsx" | grep -v node_modules | xargs sed -i '' 's/createSpec/createDraft/g'
find src -name "*.ts" -o -name "*.tsx" | grep -v node_modules | xargs sed -i '' 's/create_spec_session/create_draft_session/g'
find src -name "*.ts" -o -name "*.tsx" | grep -v node_modules | xargs sed -i '' 's/start_spec_session/start_draft_session/g'
find src -name "*.ts" -o -name "*.tsx" | grep -v node_modules | xargs sed -i '' 's/schaltwerk_core_create_spec_session/schaltwerk_core_create_draft_session/g'
find src -name "*.ts" -o -name "*.tsx" | grep -v node_modules | xargs sed -i '' 's/schaltwerk_core_start_spec_session/schaltwerk_core_start_draft_session/g'

# Update variable names from isSpec back to isSpec
echo "Updating variable names from isSpec back to isSpec..."
find src -name "*.ts" -o -name "*.tsx" | grep -v node_modules | xargs sed -i '' 's/isSpec/isSpec/g'
find src -name "*.ts" -o -name "*.tsx" | grep -v node_modules | xargs sed -i '' 's/setIsSpec/setIsSpec/g'

# Update event names from schaltwerk:new-spec back to schaltwerk:new-spec
echo "Updating event names from schaltwerk:new-spec back to schaltwerk:new-spec..."
find src -name "*.ts" -o -name "*.tsx" | grep -v node_modules | xargs sed -i '' 's/schaltwerk:new-spec/schaltwerk:new-spec/g'
find src -name "*.ts" -o -name "*.tsx" | grep -v node_modules | xargs sed -i '' 's/schaltwerk:spec-created/schaltwerk:spec-created/g'
find src -name "*.ts" -o -name "*.tsx" | grep -v node_modules | xargs sed -i '' 's/schaltwerk:start-agent-from-spec/schaltwerk:start-agent-from-spec/g'
find src -name "*.ts" -o -name "*.tsx" | grep -v node_modules | xargs sed -i '' 's/schaltwerk:enter-spec-mode/schaltwerk:enter-spec-mode/g'

# Update status values from 'spec' back to 'spec'
echo "Updating status values from 'spec' back to 'spec'..."
find src -name "*.ts" -o -name "*.tsx" | grep -v node_modules | xargs sed -i '' 's/'\''spec'\''/'\''spec'\''/g'
find src -name "*.ts" -o -name "*.tsx" | grep -v node_modules | xargs sed -i '' 's/"spec"/"spec"/g'

# Update session state types
echo "Updating session state types..."
find src -name "*.ts" -o -name "*.tsx" | grep -v node_modules | xargs sed -i '' 's/'\''spec'\'' | '\''running'\'' | '\''reviewed'\''/'\''spec'\'' | '\''running'\'' | '\''reviewed'\''/g'

# Update UI text from "Spec" back to "Spec"
echo "Updating UI text from 'Spec' back to 'Spec'..."
find src -name "*.ts" -o -name "*.tsx" | grep -v node_modules | xargs sed -i '' 's/"Spec Mode"/"Spec Mode"/g'
find src -name "*.ts" -o -name "*.tsx" | grep -v node_modules | xargs sed -i '' "s/'Spec Mode'/'Spec Mode'/g"
find src -name "*.ts" -o -name "*.tsx" | grep -v node_modules | xargs sed -i '' 's/"Create spec"/"Create spec"/g'
find src -name "*.ts" -o -name "*.tsx" | grep -v node_modules | xargs sed -i '' "s/'Create spec'/'Create spec'/g"
find src -name "*.ts" -o -name "*.tsx" | grep -v node_modules | xargs sed -i '' 's/"Create new spec (⇧⌘N)"/"Create new spec (⇧⌘N)"/g'
find src -name "*.ts" -o -name "*.tsx" | grep -v node_modules | xargs sed -i '' 's/"Spec"/"Spec"/g'
find src -name "*.ts" -o -name "*.tsx" | grep -v node_modules | xargs sed -i '' "s/'Spec'/'Spec'/g"

# Update comments from spec to spec
echo "Updating comments from spec to spec..."
find src -name "*.ts" -o -name "*.tsx" | grep -v node_modules | xargs sed -i '' 's/spec session/spec session/g'
find src -name "*.ts" -o -name "*.tsx" | grep -v node_modules | xargs sed -i '' 's/spec sessions/spec sessions/g'
find src -name "*.ts" -o -name "*.tsx" | grep -v node_modules | xargs sed -i '' 's/spec state/spec state/g'
find src -name "*.ts" -o -name "*.tsx" | grep -v node_modules | xargs sed -i '' 's/spec status/spec status/g'
find src -name "*.ts" -o -name "*.tsx" | grep -v node_modules | xargs sed -i '' 's/spec mode/spec mode/g'
find src -name "*.ts" -o -name "*.tsx" | grep -v node_modules | xargs sed -i '' 's/spec content/spec content/g'
find src -name "*.ts" -o -name "*.tsx" | grep -v node_modules | xargs sed -i '' 's/draft session/spec session/g'
find src -name "*.ts" -o -name "*.tsx" | grep -v node_modules | xargs sed -i '' 's/draft sessions/spec sessions/g'
find src -name "*.ts" -o -name "*.tsx" | grep -v node_modules | xargs sed -i '' 's/For specs/For specs/g'
find src -name "*.ts" -o -name "*.tsx" | grep -v node_modules | xargs sed -i '' 's/for specs/for specs/g'
find src -name "*.ts" -o -name "*.tsx" | grep -v node_modules | xargs sed -i '' 's/Specs tab/Specs tab/g'
find src -name "*.ts" -o -name "*.tsx" | grep -v node_modules | xargs sed -i '' 's/Spec tab/Spec tab/g'
find src -name "*.ts" -o -name "*.tsx" | grep -v node_modules | xargs sed -i '' 's/Agent\/Specs tab/Agent\/Specs tab/g'
find src -name "*.ts" -o -name "*.tsx" | grep -v node_modules | xargs sed -i '' 's/New Spec shortcut/New Spec shortcut/g'
find src -name "*.ts" -o -name "*.tsx" | grep -v node_modules | xargs sed -i '' 's/spec mode/spec mode/g'
find src -name "*.ts" -o -name "*.tsx" | grep -v node_modules | xargs sed -i '' 's/Convert to spec/Convert to spec/g'
find src -name "*.ts" -o -name "*.tsx" | grep -v node_modules | xargs sed -i '' 's/If it'\''s a spec/If it'\''s a spec/g'
find src -name "*.ts" -o -name "*.tsx" | grep -v node_modules | xargs sed -i '' 's/Open Start agent modal prefilled from spec/Open Start agent modal prefilled from spec/g'
find src -name "*.ts" -o -name "*.tsx" | grep -v node_modules | xargs sed -i '' 's/Failed to open start modal from spec/Failed to open start modal from spec/g'
find src -name "*.ts" -o -name "*.tsx" | grep -v node_modules | xargs sed -i '' 's/Failed to delete spec/Failed to delete spec/g'
find src -name "*.ts" -o -name "*.tsx" | grep -v node_modules | xargs sed -i '' 's/MCP creates\/updates specs/MCP creates\/updates specs/g'
find src -name "*.ts" -o -name "*.tsx" | grep -v node_modules | xargs sed -i '' 's/requested session\/spec/requested session\/spec/g'

# Update test data from spec back to spec
echo "Updating test data from spec back to spec..."
find src -name "*.test.ts" -o -name "*.test.tsx" | grep -v node_modules | xargs sed -i '' "s/'test-spec'/'test-spec'/g"
find src -name "*.test.ts" -o -name "*.test.tsx" | grep -v node_modules | xargs sed -i '' "s/'spec-a'/'spec-a'/g"
find src -name "*.test.ts" -o -name "*.test.tsx" | grep -v node_modules | xargs sed -i '' "s/'spec-d'/'spec-d'/g"
find src -name "*.test.ts" -o -name "*.test.tsx" | grep -v node_modules | xargs sed -i '' "s/'new-spec'/'new-spec'/g"
find src -name "*.test.ts" -o -name "*.test.tsx" | grep -v node_modules | xargs sed -i '' "s/'Test Spec'/'Test Spec'/g"
find src -name "*.test.ts" -o -name "*.test.tsx" | grep -v node_modules | xargs sed -i '' "s/'feature\/test-spec'/'feature\/test-spec'/g"
find src -name "*.test.ts" -o -name "*.test.tsx" | grep -v node_modules | xargs sed -i '' "s/'\/path\/to\/spec'/'\/path\/to\/spec'/g"
find src -name "*.test.ts" -o -name "*.test.tsx" | grep -v node_modules | xargs sed -i '' "s/'session-test-spec-top'/'session-test-spec-top'/g"
find src -name "*.test.ts" -o -name "*.test.tsx" | grep -v node_modules | xargs sed -i '' "s/'session-test-spec-bottom'/'session-test-spec-bottom'/g"
find src -name "*.test.ts" -o -name "*.test.tsx" | grep -v node_modules | xargs sed -i '' "s/'# My Spec'/'# My Spec'/g"
find src -name "*.test.ts" -o -name "*.test.tsx" | grep -v node_modules | xargs sed -i '' "s/'# Spec Content'/'# Spec Content'/g"
find src -name "*.test.ts" -o -name "*.test.tsx" | grep -v node_modules | xargs sed -i '' "s/'This is the spec content'/'This is the spec content'/g"
find src -name "*.test.ts" -o -name "*.test.tsx" | grep -v node_modules | xargs sed -i '' "s/'This is the spec content.'/'This is the spec content.'/g"

# Update test descriptions
echo "Updating test descriptions..."
find src -name "*.test.ts" -o -name "*.test.tsx" | grep -v node_modules | xargs sed -i '' "s/from spec to active/from spec to active/g"
find src -name "*.test.ts" -o -name "*.test.tsx" | grep -v node_modules | xargs sed -i '' "s/from active to spec/from active to spec/g"
find src -name "*.test.ts" -o -name "*.test.tsx" | grep -v node_modules | xargs sed -i '' "s/create a new spec session/create a new spec session/g"
find src -name "*.test.ts" -o -name "*.test.tsx" | grep -v node_modules | xargs sed -i '' "s/# New Spec/# New Spec/g"
find src -name "*.test.ts" -o -name "*.test.tsx" | grep -v node_modules | xargs sed -i '' "s/specContent/specContent/g"
find src -name "*.test.ts" -o -name "*.test.tsx" | grep -v node_modules | xargs sed -i '' "s/state transitions from spec to running/state transitions from spec to running/g"
find src -name "*.test.ts" -o -name "*.test.tsx" | grep -v node_modules | xargs sed -i '' "s/state transitions from running to spec/state transitions from running to spec/g"

# Update variable names in SelectionContext
echo "Updating variable names in SelectionContext..."
find src -name "*.ts" -o -name "*.tsx" | grep -v node_modules | xargs sed -i '' "s/nowSpec/nowSpec/g"
find src -name "*.ts" -o -name "*.tsx" | grep -v node_modules | xargs sed -i '' "s/wasSpec/wasSpec/g"

echo "Spec to spec reversion completed!"