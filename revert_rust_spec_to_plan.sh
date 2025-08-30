#!/bin/bash

# Script to revert Rust code from spec terminology back to spec

set -e

echo "Reverting Rust code from spec back to spec..."

# Update FilterMode enum
echo "Updating FilterMode enum..."
sed -i '' 's/FilterMode::Spec/FilterMode::Spec/g' src-tauri/src/schaltwerk_core/session_utils.rs
sed -i '' 's/SessionState::Spec/SessionState::Spec/g' src-tauri/src/schaltwerk_core/session_utils.rs

# Update SessionStatus and SessionState enums
echo "Updating SessionStatus and SessionState enums..."
sed -i '' 's/SessionStatus::Spec/SessionStatus::Spec/g' src-tauri/src/schaltwerk_core/session_core.rs
sed -i '' 's/SessionState::Spec/SessionState::Spec/g' src-tauri/src/schaltwerk_core/session_core.rs
sed -i '' 's/SessionStatusType::Spec/SessionStatusType::Spec/g' src-tauri/src/schaltwerk_core/session_core.rs

# Update function names
echo "Updating function names..."
sed -i '' 's/convert_session_to_spec/convert_session_to_spec/g' src-tauri/src/schaltwerk_core/session_core.rs
sed -i '' 's/start_spec_session_with_config/start_draft_session_with_config/g' src-tauri/src/schaltwerk_core/session_core.rs
sed -i '' 's/create_spec_session/create_draft_session/g' src-tauri/src/schaltwerk_core/session_core.rs
sed -i '' 's/start_spec_session/start_draft_session/g' src-tauri/src/schaltwerk_core/session_core.rs
sed -i '' 's/update_spec_content/update_spec_content/g' src-tauri/src/schaltwerk_core/session_core.rs
sed -i '' 's/append_spec_content/append_spec_content/g' src-tauri/src/schaltwerk_core/session_core.rs

# Update log messages and comments
echo "Updating log messages and comments..."
sed -i '' 's/Converting session.*from running to spec/Converting session '\''{name}'\'' from running to spec/g' src-tauri/src/schaltwerk_core/session_core.rs
sed -i '' 's/to spec with uncommitted changes/to spec with uncommitted changes/g' src-tauri/src/schaltwerk_core/session_core.rs
sed -i '' 's/when converting to spec/when converting to spec/g' src-tauri/src/schaltwerk_core/session_core.rs
sed -i '' 's/Cannot mark spec session/Cannot mark spec session/g' src-tauri/src/schaltwerk_core/session_core.rs
sed -i '' 's/Start the spec first/Start the spec first/g' src-tauri/src/schaltwerk_core/session_core.rs
sed -i '' 's/Session.*is already a spec/Session '\''{session_name}'\'' is already a spec/g' src-tauri/src/schaltwerk_core/session_core.rs
sed -i '' 's/Creating spec session/Creating spec session/g' src-tauri/src/schaltwerk_core/session_core.rs
sed -i '' 's/Starting spec session/Starting spec session/g' src-tauri/src/schaltwerk_core/session_core.rs
sed -i '' 's/Session.*is not in spec state/Session '\''{session_name}'\'' is not in spec state/g' src-tauri/src/schaltwerk_core/session_core.rs
sed -i '' 's/Copying spec content to initial_prompt/Copying spec content to initial_prompt/g' src-tauri/src/schaltwerk_core/session_core.rs
sed -i '' 's/to ensure spec content is used/to ensure spec content is used/g' src-tauri/src/schaltwerk_core/session_core.rs
sed -i '' 's/No spec_content found/No spec_content found/g' src-tauri/src/schaltwerk_core/session_core.rs
sed -i '' 's/Updating spec content for session/Updating spec content for session/g' src-tauri/src/schaltwerk_core/session_core.rs
sed -i '' 's/only Spec sessions can have their content updated/only Spec sessions can have their content updated/g' src-tauri/src/schaltwerk_core/session_core.rs
sed -i '' 's/Successfully updated spec content/Successfully updated spec content/g' src-tauri/src/schaltwerk_core/session_core.rs
sed -i '' 's/Appending spec content for session/Appending spec content for session/g' src-tauri/src/schaltwerk_core/session_core.rs
sed -i '' 's/only Spec sessions can have content appended/only Spec sessions can have content appended/g' src-tauri/src/schaltwerk_core/session_core.rs
sed -i '' 's/Successfully appended spec content/Successfully appended spec content/g' src-tauri/src/schaltwerk_core/session_core.rs

# Update database field names
echo "Updating database field names..."
sed -i '' 's/spec_content/spec_content/g' src-tauri/src/schaltwerk_core/db_sessions.rs

# Update test files
echo "Updating test files..."
sed -i '' 's/create_spec_session/create_draft_session/g' src-tauri/src/schaltwerk_core/spec_fixed_test.rs
sed -i '' 's/start_spec_session/start_draft_session/g' src-tauri/src/schaltwerk_core/spec_fixed_test.rs
sed -i '' 's/SessionStatus::Spec/SessionStatus::Spec/g' src-tauri/src/schaltwerk_core/spec_fixed_test.rs
sed -i '' 's/SessionState::Spec/SessionState::Spec/g' src-tauri/src/schaltwerk_core/spec_fixed_test.rs
sed -i '' 's/Spec sessions should have SessionStatus::Spec/Spec sessions should have SessionStatus::Spec/g' src-tauri/src/schaltwerk_core/spec_fixed_test.rs
sed -i '' 's/Spec sessions should have SessionState::Spec/Spec sessions should have SessionState::Spec/g' src-tauri/src/schaltwerk_core/spec_fixed_test.rs
sed -i '' 's/Create a spec session/Create a spec session/g' src-tauri/src/schaltwerk_core/spec_fixed_test.rs
sed -i '' 's/Should have exactly 1 spec session/Should have exactly 1 spec session/g' src-tauri/src/schaltwerk_core/spec_fixed_test.rs
sed -i '' 's/UI can filter exactly 1 spec/UI can filter exactly 1 spec/g' src-tauri/src/schaltwerk_core/spec_fixed_test.rs
sed -i '' 's/Spec session should not appear/Spec session should not appear/g' src-tauri/src/schaltwerk_core/spec_fixed_test.rs
sed -i '' 's/Spec session should appear/Spec session should appear/g' src-tauri/src/schaltwerk_core/spec_fixed_test.rs
sed -i '' 's/Create a spec/Create a spec/g' src-tauri/src/schaltwerk_core/spec_fixed_test.rs
sed -i '' 's/Started spec should have Active status/Started spec should have Active status/g' src-tauri/src/schaltwerk_core/spec_fixed_test.rs
sed -i '' 's/Started spec should have Running state/Started spec should have Running state/g' src-tauri/src/schaltwerk_core/spec_fixed_test.rs

# Update test data
echo "Updating test data..."
sed -i '' 's/"test-spec"/"test-spec"/g' src-tauri/src/schaltwerk_core/spec_fixed_test.rs
sed -i '' 's/"ui-spec"/"ui-spec"/g' src-tauri/src/schaltwerk_core/spec_fixed_test.rs
sed -i '' 's/"transition-spec"/"transition-spec"/g' src-tauri/src/schaltwerk_core/spec_fixed_test.rs

# Update session_core_test.rs
echo "Updating session_core_test.rs..."
sed -i '' 's/create_spec_session/create_draft_session/g' src-tauri/src/schaltwerk_core/session_core_test.rs
sed -i '' 's/start_spec_session/start_draft_session/g' src-tauri/src/schaltwerk_core/session_core_test.rs
sed -i '' 's/update_spec_content/update_spec_content/g' src-tauri/src/schaltwerk_core/session_core_test.rs
sed -i '' 's/append_spec_content/append_spec_content/g' src-tauri/src/schaltwerk_core/session_core_test.rs
sed -i '' 's/SessionStatus::Spec/SessionStatus::Spec/g' src-tauri/src/schaltwerk_core/session_core_test.rs
sed -i '' 's/SessionState::Spec/SessionState::Spec/g' src-tauri/src/schaltwerk_core/session_core_test.rs

# Update session_sorting.rs
echo "Updating session_sorting.rs..."
sed -i '' 's/SessionStatus::Spec/SessionStatus::Spec/g' src-tauri/src/schaltwerk_core/session_sorting.rs
sed -i '' 's/SessionState::Spec/SessionState::Spec/g' src-tauri/src/schaltwerk_core/session_sorting.rs

# Update types.rs
echo "Updating types.rs..."
sed -i '' 's/FilterMode::Spec/FilterMode::Spec/g' src-tauri/src/schaltwerk_core/types.rs
sed -i '' 's/SessionStatus::Spec/SessionStatus::Spec/g' src-tauri/src/schaltwerk_core/types.rs
sed -i '' 's/SessionState::Spec/SessionState::Spec/g' src-tauri/src/schaltwerk_core/types.rs

echo "Rust spec to spec reversion completed!"