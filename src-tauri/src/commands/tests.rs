// Test the reset orchestrator commands
// These are more like integration tests that verify the command structure and basic functionality

#[tokio::test]
async fn test_reset_commands_parse_correctly_when_no_project() {
    // Test that the commands fail gracefully when no project is set up
    // This verifies error handling without needing to mock the entire project setup
    
    let terminal_id = "test-orchestrator-no-project";
    
    let fresh_result = super::schaltwerk_core_start_fresh_orchestrator(terminal_id.to_string()).await;
    // Should fail with meaningful error about missing project
    assert!(fresh_result.is_err(), "Fresh start should fail without project");
    let fresh_error = fresh_result.unwrap_err();
    assert!(fresh_error.contains("No active project") || 
            fresh_error.contains("No project is currently open") ||
            fresh_error.contains("Failed to get para core"),
            "Fresh start error should mention project issue: {}", fresh_error);
    
    let reset_result = super::schaltwerk_core_reset_orchestrator(terminal_id.to_string()).await;
    // Should fail with meaningful error about missing project
    assert!(reset_result.is_err(), "Reset should fail without project");
    let reset_error = reset_result.unwrap_err();
    assert!(reset_error.contains("No active project") || 
            reset_error.contains("No project is currently open") ||
            reset_error.contains("Failed to get para core"),
            "Reset error should mention project issue: {}", reset_error);
}

#[tokio::test]
async fn test_reset_command_timing() {
    // Test that reset waits for cleanup (even when it fails due to no project)
    // The timing behavior should be consistent regardless of success/failure
    
    let terminal_id = "test-orchestrator-timing";
    
    let start_time = std::time::Instant::now();
    let _result = super::schaltwerk_core_reset_orchestrator(terminal_id.to_string()).await;
    let duration = start_time.elapsed();
    
    // Reset should complete in reasonable time (not hang indefinitely)
    assert!(duration <= std::time::Duration::from_secs(10), "Reset should not hang");
}

#[tokio::test]
async fn test_fresh_orchestrator_command_timing() {
    // Test that fresh orchestrator doesn't hang
    
    let terminal_id = "test-fresh-timing";
    
    let start_time = std::time::Instant::now();
    let _result = super::schaltwerk_core_start_fresh_orchestrator(terminal_id.to_string()).await;
    let duration = start_time.elapsed();
    
    // Should complete in reasonable time (not hang indefinitely)
    assert!(duration <= std::time::Duration::from_secs(10), "Fresh start should not hang");
}

#[tokio::test]
async fn test_command_functions_exist_and_callable() {
    // Simple smoke test to ensure the functions exist and can be called
    // This verifies the basic API contract
    
    let terminal_ids = vec![
        "test-orchestrator-1",
        "test-orchestrator-2", 
        "orchestrator-claude-top",
        "orchestrator-cursor-top",
    ];
    
    for terminal_id in terminal_ids {
        // These will fail due to no project, but they should not panic or crash
        let fresh_result = super::schaltwerk_core_start_fresh_orchestrator(terminal_id.to_string()).await;
        assert!(fresh_result.is_err(), "Fresh start should fail without project setup");
        
        let reset_result = super::schaltwerk_core_reset_orchestrator(terminal_id.to_string()).await;
        assert!(reset_result.is_err(), "Reset should fail without project setup");
        
        // Both should return String errors, not panic
        // (This verifies the function signatures and basic error handling)
        match fresh_result {
            Err(msg) => assert!(!msg.is_empty(), "Fresh start error message should not be empty"),
            Ok(_) => panic!("Fresh start should not succeed without project"),
        }
        
        match reset_result {
            Err(msg) => assert!(!msg.is_empty(), "Reset error message should not be empty"),
            Ok(_) => panic!("Reset should not succeed without project"),
        }
    }
}