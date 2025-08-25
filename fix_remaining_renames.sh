#!/bin/bash
set -e

echo "Fixing remaining isDraft -> isPlan references..."

# Fix all isDraft references to isPlan
find . -type f \( -name "*.ts" -o -name "*.tsx" \) \
  -not -path "./node_modules/*" \
  -not -path "./target/*" \
  -not -path "./.git/*" \
  -not -path "./dist/*" | \
  xargs perl -pi -e '
    s/\bisDraft\b/isPlan/g;
    s/\bsetIsDraft\b/setIsPlan/g;
    s/\bisDraftSession\b/isPlanSession/g;
    s/\bwasDraft\b/wasPlan/g;
    s/\bnowDraft\b/nowPlan/g;
  '

# Fix isOrchestrator -> isCommander (in case any were missed)
find . -type f \( -name "*.ts" -o -name "*.tsx" \) \
  -not -path "./node_modules/*" \
  -not -path "./target/*" \
  -not -path "./.git/*" \
  -not -path "./dist/*" | \
  xargs perl -pi -e '
    s/\bisOrchestrator\b/isCommander/g;
    s/\bisOrchestratorProp\b/isCommanderProp/g;
  '

# Fix any remaining convertToDraft references
find . -type f \( -name "*.ts" -o -name "*.tsx" \) \
  -not -path "./node_modules/*" \
  -not -path "./target/*" \
  -not -path "./.git/*" | \
  xargs perl -pi -e '
    s/\bconvertToDraftModal\b/convertToPlanModal/g;
    s/\bconvertToDraft\b/convertToPlan/g;
    s/\bonConvertToDraft\b/onConvertToPlan/g;
  '

# Fix any deleteDraft references that were missed
find . -type f \( -name "*.ts" -o -name "*.tsx" \) \
  -not -path "./node_modules/*" \
  -not -path "./target/*" \
  -not -path "./.git/*" | \
  xargs perl -pi -e '
    s/\bdeleteDraftModal\b/deletePlanModal/g;
    s/\bonDeleteDraft\b/onDeletePlan/g;
  '

# Fix DraftSession interface references
find . -type f \( -name "*.ts" -o -name "*.tsx" \) \
  -not -path "./node_modules/*" \
  -not -path "./target/*" \
  -not -path "./.git/*" | \
  xargs perl -pi -e '
    s/\bDraftSession\b/PlanSession/g;
  '

echo "Script complete!"