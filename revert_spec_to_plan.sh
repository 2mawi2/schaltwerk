#!/bin/bash

# Script to revert all "spec" terminology back to "plan" to match consolidated main architecture

set -e

echo "Reverting spec terminology back to plan..."

# Fix directory structure - rename specs/ back to plans/
echo "Renaming specs/ directory back to plans/..."
if [ -d "src/components/specs" ]; then
    mv "src/components/specs" "src/components/plans"
    echo "Renamed src/components/specs -> src/components/plans"
fi

# Rename all spec component files back to plan
echo "Renaming spec component files back to plan..."
find src/components/plans -name "*Spec*" -type f | while read -r file; do
    new_name=$(echo "$file" | sed 's/Spec/Plan/g')
    mv "$file" "$new_name"
    echo "Renamed $file -> $new_name"
done

# Update all imports from specs/ to plans/
echo "Updating imports from specs/ to plans/..."
find src -name "*.ts" -o -name "*.tsx" | grep -v node_modules | xargs sed -i '' 's|from '\''../specs/|from '\''../plans/|g'
find src -name "*.ts" -o -name "*.tsx" | grep -v node_modules | xargs sed -i '' 's|from "./specs/|from "./plans/|g'

# Update component names from Spec* to Plan*
echo "Updating component names from Spec* to Plan*..."
find src -name "*.ts" -o -name "*.tsx" | grep -v node_modules | xargs sed -i '' 's/SpecPlaceholder/PlanPlaceholder/g'
find src -name "*.ts" -o -name "*.tsx" | grep -v node_modules | xargs sed -i '' 's/SpecContentView/PlanContentView/g'
find src -name "*.ts" -o -name "*.tsx" | grep -v node_modules | xargs sed -i '' 's/SpecListView/PlanListView/g'
find src -name "*.ts" -o -name "*.tsx" | grep -v node_modules | xargs sed -i '' 's/SpecInfoPanel/PlanInfoPanel/g'
find src -name "*.ts" -o -name "*.tsx" | grep -v node_modules | xargs sed -i '' 's/SpecMetadataPanel/PlanMetadataPanel/g'
find src -name "*.ts" -o -name "*.tsx" | grep -v node_modules | xargs sed -i '' 's/SpecModeLayout/PlanModeLayout/g'
find src -name "*.ts" -o -name "*.tsx" | grep -v node_modules | xargs sed -i '' 's/SpecEditor/PlanEditor/g'
find src -name "*.ts" -o -name "*.tsx" | grep -v node_modules | xargs sed -i '' 's/SpecAgentPanel/PlanAgentPanel/g'
find src -name "*.ts" -o -name "*.tsx" | grep -v node_modules | xargs sed -i '' 's/ConvertToSpecConfirmation/ConvertToPlanConfirmation/g'
find src -name "*.ts" -o -name "*.tsx" | grep -v node_modules | xargs sed -i '' 's/DeleteSpecConfirmation/DeletePlanConfirmation/g'

# Update function names from createSpec back to createDraft
echo "Updating function names from createSpec back to createDraft..."
find src -name "*.ts" -o -name "*.tsx" | grep -v node_modules | xargs sed -i '' 's/createSpec/createDraft/g'
find src -name "*.ts" -o -name "*.tsx" | grep -v node_modules | xargs sed -i '' 's/create_spec_session/create_draft_session/g'
find src -name "*.ts" -o -name "*.tsx" | grep -v node_modules | xargs sed -i '' 's/start_spec_session/start_draft_session/g'
find src -name "*.ts" -o -name "*.tsx" | grep -v node_modules | xargs sed -i '' 's/schaltwerk_core_create_spec_session/schaltwerk_core_create_draft_session/g'
find src -name "*.ts" -o -name "*.tsx" | grep -v node_modules | xargs sed -i '' 's/schaltwerk_core_start_spec_session/schaltwerk_core_start_draft_session/g'

# Update variable names from isSpec back to isPlan
echo "Updating variable names from isSpec back to isPlan..."
find src -name "*.ts" -o -name "*.tsx" | grep -v node_modules | xargs sed -i '' 's/isSpec/isPlan/g'
find src -name "*.ts" -o -name "*.tsx" | grep -v node_modules | xargs sed -i '' 's/setIsSpec/setIsPlan/g'

# Update event names from schaltwerk:new-spec back to schaltwerk:new-plan
echo "Updating event names from schaltwerk:new-spec back to schaltwerk:new-plan..."
find src -name "*.ts" -o -name "*.tsx" | grep -v node_modules | xargs sed -i '' 's/schaltwerk:new-spec/schaltwerk:new-plan/g'
find src -name "*.ts" -o -name "*.tsx" | grep -v node_modules | xargs sed -i '' 's/schaltwerk:spec-created/schaltwerk:plan-created/g'
find src -name "*.ts" -o -name "*.tsx" | grep -v node_modules | xargs sed -i '' 's/schaltwerk:start-agent-from-spec/schaltwerk:start-agent-from-plan/g'
find src -name "*.ts" -o -name "*.tsx" | grep -v node_modules | xargs sed -i '' 's/schaltwerk:enter-spec-mode/schaltwerk:enter-plan-mode/g'

# Update status values from 'spec' back to 'plan'
echo "Updating status values from 'spec' back to 'plan'..."
find src -name "*.ts" -o -name "*.tsx" | grep -v node_modules | xargs sed -i '' 's/'\''spec'\''/'\''plan'\''/g'
find src -name "*.ts" -o -name "*.tsx" | grep -v node_modules | xargs sed -i '' 's/"spec"/"plan"/g'

# Update session state types
echo "Updating session state types..."
find src -name "*.ts" -o -name "*.tsx" | grep -v node_modules | xargs sed -i '' 's/'\''spec'\'' | '\''running'\'' | '\''reviewed'\''/'\''plan'\'' | '\''running'\'' | '\''reviewed'\''/g'

# Update UI text from "Spec" back to "Plan"
echo "Updating UI text from 'Spec' back to 'Plan'..."
find src -name "*.ts" -o -name "*.tsx" | grep -v node_modules | xargs sed -i '' 's/"Spec Mode"/"Plan Mode"/g'
find src -name "*.ts" -o -name "*.tsx" | grep -v node_modules | xargs sed -i '' "s/'Spec Mode'/'Plan Mode'/g"
find src -name "*.ts" -o -name "*.tsx" | grep -v node_modules | xargs sed -i '' 's/"Create spec"/"Create plan"/g'
find src -name "*.ts" -o -name "*.tsx" | grep -v node_modules | xargs sed -i '' "s/'Create spec'/'Create plan'/g"
find src -name "*.ts" -o -name "*.tsx" | grep -v node_modules | xargs sed -i '' 's/"Create new spec (⇧⌘N)"/"Create new plan (⇧⌘N)"/g'
find src -name "*.ts" -o -name "*.tsx" | grep -v node_modules | xargs sed -i '' 's/"Spec"/"Plan"/g'
find src -name "*.ts" -o -name "*.tsx" | grep -v node_modules | xargs sed -i '' "s/'Spec'/'Plan'/g"

# Update comments from spec to plan
echo "Updating comments from spec to plan..."
find src -name "*.ts" -o -name "*.tsx" | grep -v node_modules | xargs sed -i '' 's/spec session/plan session/g'
find src -name "*.ts" -o -name "*.tsx" | grep -v node_modules | xargs sed -i '' 's/spec sessions/plan sessions/g'
find src -name "*.ts" -o -name "*.tsx" | grep -v node_modules | xargs sed -i '' 's/spec state/plan state/g'
find src -name "*.ts" -o -name "*.tsx" | grep -v node_modules | xargs sed -i '' 's/spec status/plan status/g'
find src -name "*.ts" -o -name "*.tsx" | grep -v node_modules | xargs sed -i '' 's/spec mode/plan mode/g'
find src -name "*.ts" -o -name "*.tsx" | grep -v node_modules | xargs sed -i '' 's/spec content/plan content/g'
find src -name "*.ts" -o -name "*.tsx" | grep -v node_modules | xargs sed -i '' 's/draft session/plan session/g'
find src -name "*.ts" -o -name "*.tsx" | grep -v node_modules | xargs sed -i '' 's/draft sessions/plan sessions/g'
find src -name "*.ts" -o -name "*.tsx" | grep -v node_modules | xargs sed -i '' 's/For specs/For plans/g'
find src -name "*.ts" -o -name "*.tsx" | grep -v node_modules | xargs sed -i '' 's/for specs/for plans/g'
find src -name "*.ts" -o -name "*.tsx" | grep -v node_modules | xargs sed -i '' 's/Specs tab/Plans tab/g'
find src -name "*.ts" -o -name "*.tsx" | grep -v node_modules | xargs sed -i '' 's/Spec tab/Plan tab/g'
find src -name "*.ts" -o -name "*.tsx" | grep -v node_modules | xargs sed -i '' 's/Agent\/Specs tab/Agent\/Plans tab/g'
find src -name "*.ts" -o -name "*.tsx" | grep -v node_modules | xargs sed -i '' 's/New Spec shortcut/New Plan shortcut/g'
find src -name "*.ts" -o -name "*.tsx" | grep -v node_modules | xargs sed -i '' 's/spec mode/plan mode/g'
find src -name "*.ts" -o -name "*.tsx" | grep -v node_modules | xargs sed -i '' 's/Convert to spec/Convert to plan/g'
find src -name "*.ts" -o -name "*.tsx" | grep -v node_modules | xargs sed -i '' 's/If it'\''s a spec/If it'\''s a plan/g'
find src -name "*.ts" -o -name "*.tsx" | grep -v node_modules | xargs sed -i '' 's/Open Start agent modal prefilled from spec/Open Start agent modal prefilled from plan/g'
find src -name "*.ts" -o -name "*.tsx" | grep -v node_modules | xargs sed -i '' 's/Failed to open start modal from spec/Failed to open start modal from plan/g'
find src -name "*.ts" -o -name "*.tsx" | grep -v node_modules | xargs sed -i '' 's/Failed to delete spec/Failed to delete plan/g'
find src -name "*.ts" -o -name "*.tsx" | grep -v node_modules | xargs sed -i '' 's/MCP creates\/updates specs/MCP creates\/updates plans/g'
find src -name "*.ts" -o -name "*.tsx" | grep -v node_modules | xargs sed -i '' 's/requested session\/spec/requested session\/plan/g'

# Update test data from spec back to plan
echo "Updating test data from spec back to plan..."
find src -name "*.test.ts" -o -name "*.test.tsx" | grep -v node_modules | xargs sed -i '' "s/'test-spec'/'test-plan'/g"
find src -name "*.test.ts" -o -name "*.test.tsx" | grep -v node_modules | xargs sed -i '' "s/'spec-a'/'plan-a'/g"
find src -name "*.test.ts" -o -name "*.test.tsx" | grep -v node_modules | xargs sed -i '' "s/'spec-d'/'spec-d'/g"
find src -name "*.test.ts" -o -name "*.test.tsx" | grep -v node_modules | xargs sed -i '' "s/'new-spec'/'new-plan'/g"
find src -name "*.test.ts" -o -name "*.test.tsx" | grep -v node_modules | xargs sed -i '' "s/'Test Spec'/'Test Plan'/g"
find src -name "*.test.ts" -o -name "*.test.tsx" | grep -v node_modules | xargs sed -i '' "s/'feature\/test-spec'/'feature\/test-plan'/g"
find src -name "*.test.ts" -o -name "*.test.tsx" | grep -v node_modules | xargs sed -i '' "s/'\/path\/to\/spec'/'\/path\/to\/plan'/g"
find src -name "*.test.ts" -o -name "*.test.tsx" | grep -v node_modules | xargs sed -i '' "s/'session-test-spec-top'/'session-test-plan-top'/g"
find src -name "*.test.ts" -o -name "*.test.tsx" | grep -v node_modules | xargs sed -i '' "s/'session-test-spec-bottom'/'session-test-plan-bottom'/g"
find src -name "*.test.ts" -o -name "*.test.tsx" | grep -v node_modules | xargs sed -i '' "s/'# My Spec'/'# My Plan'/g"
find src -name "*.test.ts" -o -name "*.test.tsx" | grep -v node_modules | xargs sed -i '' "s/'# Spec Content'/'# Plan Content'/g"
find src -name "*.test.ts" -o -name "*.test.tsx" | grep -v node_modules | xargs sed -i '' "s/'This is the spec content'/'This is the plan content'/g"
find src -name "*.test.ts" -o -name "*.test.tsx" | grep -v node_modules | xargs sed -i '' "s/'This is the spec content.'/'This is the plan content.'/g"

# Update test descriptions
echo "Updating test descriptions..."
find src -name "*.test.ts" -o -name "*.test.tsx" | grep -v node_modules | xargs sed -i '' "s/from spec to active/from plan to active/g"
find src -name "*.test.ts" -o -name "*.test.tsx" | grep -v node_modules | xargs sed -i '' "s/from active to spec/from active to plan/g"
find src -name "*.test.ts" -o -name "*.test.tsx" | grep -v node_modules | xargs sed -i '' "s/create a new spec session/create a new plan session/g"
find src -name "*.test.ts" -o -name "*.test.tsx" | grep -v node_modules | xargs sed -i '' "s/# New Spec/# New Plan/g"
find src -name "*.test.ts" -o -name "*.test.tsx" | grep -v node_modules | xargs sed -i '' "s/specContent/specContent/g"
find src -name "*.test.ts" -o -name "*.test.tsx" | grep -v node_modules | xargs sed -i '' "s/state transitions from spec to running/state transitions from plan to running/g"
find src -name "*.test.ts" -o -name "*.test.tsx" | grep -v node_modules | xargs sed -i '' "s/state transitions from running to spec/state transitions from running to plan/g"

# Update variable names in SelectionContext
echo "Updating variable names in SelectionContext..."
find src -name "*.ts" -o -name "*.tsx" | grep -v node_modules | xargs sed -i '' "s/nowSpec/nowPlan/g"
find src -name "*.ts" -o -name "*.tsx" | grep -v node_modules | xargs sed -i '' "s/wasSpec/wasPlan/g"

echo "Spec to plan reversion completed!"