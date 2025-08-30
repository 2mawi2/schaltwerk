use std::time::{Duration, Instant};
use std::collections::HashMap;
use serde::Serialize;
use crate::{get_schaltwerk_core, SETTINGS_MANAGER};
use log::{info, warn};

#[derive(Debug, Clone, Serialize)]
pub struct AgentStartupBenchmarkResult {
    pub operation: String,
    pub duration_ms: u128,
    pub success: bool,
    pub details: HashMap<String, u128>, // Detailed timing breakdown
}

#[derive(Debug, Serialize)]
pub struct AgentStartupMetrics {
    pub total_duration_ms: u128,
    pub binary_resolution_ms: u128,
    pub core_lock_acquisition_ms: u128,
    pub command_building_ms: u128,
    pub command_parsing_ms: u128,
    pub permissions_check_ms: u128,
    pub terminal_spawn_ms: u128,
}

pub struct AgentStartupBenchmark;

impl AgentStartupBenchmark {
    /// Benchmark the complete agent startup process with detailed timing
    pub async fn benchmark_agent_startup() -> Result<AgentStartupBenchmarkResult, String> {
        info!("🚀 Starting detailed agent startup benchmark");
        
        let total_start = Instant::now();
        let mut details = HashMap::new();
        
        // Step 1: Binary path resolution
        let step1_start = Instant::now();
        let binary_paths = if let Some(settings_manager) = SETTINGS_MANAGER.get() {
            let settings = settings_manager.lock().await;
            let mut paths = HashMap::new();
            
            // This is what the current code does - resolve ALL agents
            for agent in ["claude", "cursor-agent", "codex", "opencode", "gemini"] {
                match settings.get_effective_binary_path(agent) {
                    Ok(path) => {
                        paths.insert(agent.to_string(), path);
                    }
                    Err(e) => {
                        warn!("Failed to resolve binary path for {}: {}", agent, e);
                    }
                }
            }
            paths
        } else {
            HashMap::new()
        };
        let binary_resolution_ms = step1_start.elapsed().as_millis();
        details.insert("binary_resolution".to_string(), binary_resolution_ms);
        
        // Step 2: Core lock acquisition
        let step2_start = Instant::now();
        let core_result = get_schaltwerk_core().await;
        let core_lock_ms = step2_start.elapsed().as_millis();
        details.insert("core_lock_acquisition".to_string(), core_lock_ms);
        
        let core = match core_result {
            Ok(c) => c,
            Err(e) => {
                return Ok(AgentStartupBenchmarkResult {
                    operation: "Agent Startup Benchmark".to_string(),
                    duration_ms: total_start.elapsed().as_millis(),
                    success: false,
                    details,
                });
            }
        };
        
        // Step 3: Command building (with manager lock)
        let step3_start = Instant::now();
        let result = {
            let core_guard = core.lock().await;
            let manager = core_guard.session_manager();
            
            // Simulate orchestrator command building
            manager.start_claude_in_orchestrator_with_binary(&binary_paths)
        };
        let command_building_ms = step3_start.elapsed().as_millis();
        details.insert("command_building".to_string(), command_building_ms);
        
        let command = match result {
            Ok(cmd) => cmd,
            Err(e) => {
                warn!("Command building failed: {}", e);
                return Ok(AgentStartupBenchmarkResult {
                    operation: "Agent Startup Benchmark".to_string(),
                    duration_ms: total_start.elapsed().as_millis(),
                    success: false,
                    details,
                });
            }
        };
        
        // Step 4: Command parsing
        let step4_start = Instant::now();
        let parse_result = Self::parse_agent_command_benchmark(&command);
        let command_parsing_ms = step4_start.elapsed().as_millis();
        details.insert("command_parsing".to_string(), command_parsing_ms);
        
        let (cwd, _agent_name, _agent_args) = match parse_result {
            Ok(parsed) => parsed,
            Err(e) => {
                warn!("Command parsing failed: {}", e);
                return Ok(AgentStartupBenchmarkResult {
                    operation: "Agent Startup Benchmark".to_string(),
                    duration_ms: total_start.elapsed().as_millis(),
                    success: false,
                    details,
                });
            }
        };
        
        // Step 5: Permissions check
        let step5_start = Instant::now();
        let _permissions_ok = match std::fs::read_dir(&cwd) {
            Ok(_) => true,
            Err(e) => {
                warn!("Permissions check failed for {}: {}", cwd, e);
                false
            }
        };
        let permissions_check_ms = step5_start.elapsed().as_millis();
        details.insert("permissions_check".to_string(), permissions_check_ms);
        
        // Step 6: Terminal spawn simulation (without actually spawning)
        let step6_start = Instant::now();
        // Simulate the terminal manager operations
        tokio::time::sleep(Duration::from_millis(1)).await; // Minimal simulation
        let terminal_spawn_ms = step6_start.elapsed().as_millis();
        details.insert("terminal_spawn_simulation".to_string(), terminal_spawn_ms);
        
        let total_duration = total_start.elapsed().as_millis();
        
        // Display detailed results
        println!("\n📊 AGENT STARTUP BENCHMARK RESULTS:");
        println!("═══════════════════════════════════════════");
        println!("Total Duration:      {}ms", total_duration);
        println!("├─ Binary Resolution: {}ms ({:.1}%)", binary_resolution_ms, (binary_resolution_ms as f64 / total_duration as f64) * 100.0);
        println!("├─ Core Lock:         {}ms ({:.1}%)", core_lock_ms, (core_lock_ms as f64 / total_duration as f64) * 100.0);
        println!("├─ Command Building:  {}ms ({:.1}%)", command_building_ms, (command_building_ms as f64 / total_duration as f64) * 100.0);
        println!("├─ Command Parsing:   {}ms ({:.1}%)", command_parsing_ms, (command_parsing_ms as f64 / total_duration as f64) * 100.0);
        println!("├─ Permissions Check: {}ms ({:.1}%)", permissions_check_ms, (permissions_check_ms as f64 / total_duration as f64) * 100.0);
        println!("└─ Terminal Spawn:    {}ms ({:.1}%)", terminal_spawn_ms, (terminal_spawn_ms as f64 / total_duration as f64) * 100.0);
        
        // Analysis
        println!("\n🔍 BOTTLENECK ANALYSIS:");
        let max_component = details.iter()
            .max_by_key(|(_, &duration)| duration)
            .map(|(name, &duration)| (name.as_str(), duration))
            .unwrap_or(("unknown", 0));
            
        if max_component.1 > 50 {
            println!("⚠️  SLOWEST: {} taking {}ms - significant optimization target", max_component.0, max_component.1);
        } else if max_component.1 > 10 {
            println!("⚡ MODERATE: {} taking {}ms - potential optimization", max_component.0, max_component.1);
        } else {
            println!("✅ GOOD: All components under 10ms - well optimized");
        }
        
        if binary_resolution_ms > command_building_ms * 2 {
            println!("💡 RECOMMENDATION: Binary resolution is much slower than command building - consider caching");
        }
        
        if permissions_check_ms > 20 {
            println!("💡 RECOMMENDATION: Permissions check is slow - consider skipping or caching");
        }
        
        Ok(AgentStartupBenchmarkResult {
            operation: "Agent Startup Benchmark".to_string(),
            duration_ms: total_duration,
            success: true,
            details,
        })
    }
    
    /// Simplified command parsing for benchmarking
    fn parse_agent_command_benchmark(command: &str) -> Result<(String, String, Vec<String>), String> {
        // Simple parsing simulation - this matches the real parse_agent_command logic
        let parts: Vec<&str> = command.split_whitespace().collect();
        if parts.is_empty() {
            return Err("Empty command".to_string());
        }
        
        // Extract working directory (usually after --cwd or similar)
        let cwd = parts.iter()
            .position(|&p| p == "--cwd" || p.contains("cwd"))
            .and_then(|i| parts.get(i + 1))
            .unwrap_or("/tmp")
            .to_string();
            
        let agent_name = parts[0].to_string();
        let agent_args = parts[1..].iter().map(|s| s.to_string()).collect();
        
        Ok((cwd, agent_name, agent_args))
    }
    
    /// Benchmark only binary resolution
    pub async fn benchmark_binary_resolution_only() -> Result<AgentStartupBenchmarkResult, String> {
        let start = Instant::now();
        let mut details = HashMap::new();
        
        if let Some(settings_manager) = SETTINGS_MANAGER.get() {
            let settings = settings_manager.lock().await;
            let mut paths = HashMap::new();
            
            for agent in ["claude", "cursor-agent", "codex", "opencode", "gemini"] {
                let agent_start = Instant::now();
                match settings.get_effective_binary_path(agent) {
                    Ok(path) => {
                        paths.insert(agent.to_string(), path);
                    }
                    Err(e) => {
                        warn!("Failed to resolve binary path for {}: {}", agent, e);
                    }
                }
                details.insert(agent.to_string(), agent_start.elapsed().as_millis());
            }
        }
        
        let total_duration = start.elapsed().as_millis();
        
        Ok(AgentStartupBenchmarkResult {
            operation: "Binary Resolution Only".to_string(),
            duration_ms: total_duration,
            success: true,
            details,
        })
    }
}

// Tauri commands
#[tauri::command]
pub async fn run_agent_startup_benchmark() -> Result<AgentStartupBenchmarkResult, String> {
    AgentStartupBenchmark::benchmark_agent_startup().await
}

#[tauri::command]
pub async fn run_binary_resolution_benchmark() -> Result<AgentStartupBenchmarkResult, String> {
    AgentStartupBenchmark::benchmark_binary_resolution_only().await
}