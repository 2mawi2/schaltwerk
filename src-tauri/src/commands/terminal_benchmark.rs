use std::time::{Duration, Instant};
use serde::Serialize;
use crate::get_terminal_manager;
use log::{info, warn};

#[derive(Debug, Clone, Serialize)]
pub struct BenchmarkResult {
    pub operation: String,
    pub iterations: usize,
    pub total_duration_ms: u128,
    pub avg_duration_ms: f64,
    pub min_duration_ms: u128,
    pub max_duration_ms: u128,
    pub success_rate: f64,
    pub successful_iterations: usize,
}

#[derive(Debug, Serialize)]
pub struct DetailedBenchmarkMetrics {
    pub terminal_creation: BenchmarkResult,
    pub session_terminal_creation: BenchmarkResult,
    pub orchestrator_terminal_creation: BenchmarkResult,
    pub concurrent_creation: BenchmarkResult,
}

impl BenchmarkResult {
    pub fn new(operation: String, iterations: usize, durations: Vec<Duration>, successful: usize) -> Self {
        let total_duration_ms = durations.iter().map(|d| d.as_millis()).sum();
        let avg_duration_ms = if successful > 0 {
            total_duration_ms as f64 / successful as f64
        } else {
            0.0
        };
        let min_duration_ms = durations.iter().map(|d| d.as_millis()).min().unwrap_or(0);
        let max_duration_ms = durations.iter().map(|d| d.as_millis()).max().unwrap_or(0);
        let success_rate = (successful as f64 / iterations as f64) * 100.0;

        Self {
            operation,
            iterations,
            total_duration_ms,
            avg_duration_ms,
            min_duration_ms,
            max_duration_ms,
            success_rate,
            successful_iterations: successful,
        }
    }

    #[allow(dead_code)]
    pub fn display(&self) {
        println!("╭─────────────────────────────────────────────╮");
        println!("│ Operation: {:32} │", self.operation);
        println!("├─────────────────────────────────────────────┤");
        println!("│ Iterations: {:31} │", self.iterations);
        println!("│ Successful: {:31} │", self.successful_iterations);
        println!("│ Success rate: {:>28.1}% │", self.success_rate);
        println!("│ Total time: {:>29.1}ms │", self.total_duration_ms);
        println!("│ Average:    {:>29.1}ms │", self.avg_duration_ms);
        println!("│ Min:        {:>29}ms │", self.min_duration_ms);
        println!("│ Max:        {:>29}ms │", self.max_duration_ms);
        println!("╰─────────────────────────────────────────────╯");
    }
}

pub struct TerminalPerformanceBenchmark;

impl TerminalPerformanceBenchmark {
    pub async fn run_comprehensive_benchmark() -> Result<DetailedBenchmarkMetrics, String> {
        info!("🚀 Starting comprehensive terminal performance benchmark");
        
        // Warm up
        Self::warmup().await?;
        
        // Run individual benchmarks
        let terminal_creation = Self::benchmark_basic_terminal_creation(10).await?;
        let session_creation = Self::benchmark_session_terminal_creation(10).await?;
        let orchestrator_creation = Self::benchmark_orchestrator_terminal_creation(10).await?;
        let concurrent_creation = Self::benchmark_concurrent_creation(5, 3).await?;

        Ok(DetailedBenchmarkMetrics {
            terminal_creation,
            session_terminal_creation: session_creation,
            orchestrator_terminal_creation: orchestrator_creation,
            concurrent_creation,
        })
    }

    async fn warmup() -> Result<(), String> {
        info!("Warming up terminal system...");
        let manager = get_terminal_manager().await?;
        
        let warmup_id = "warmup-terminal".to_string();
        let _ = manager.create_terminal(warmup_id.clone(), "/tmp".to_string()).await;
        tokio::time::sleep(Duration::from_millis(100)).await;
        let _ = manager.close_terminal(warmup_id).await;
        
        info!("Warmup completed");
        Ok(())
    }

    async fn benchmark_basic_terminal_creation(iterations: usize) -> Result<BenchmarkResult, String> {
        info!("Benchmarking basic terminal creation ({iterations} iterations)");
        
        let manager = get_terminal_manager().await?;
        let mut durations = Vec::new();
        let mut successful = 0;

        for i in 0..iterations {
            let terminal_id = format!("bench-basic-{i}-{}", uuid::Uuid::new_v4());
            
            let start = Instant::now();
            match manager.create_terminal(terminal_id.clone(), "/tmp".to_string()).await {
                Ok(_) => {
                    let duration = start.elapsed();
                    durations.push(duration);
                    successful += 1;
                    
                    // Clean up
                    let _ = manager.close_terminal(terminal_id).await;
                }
                Err(e) => {
                    warn!("Terminal creation failed for {terminal_id}: {e}");
                    // Still record the time for failed attempts
                    durations.push(start.elapsed());
                }
            }
            
            // Small delay between iterations to avoid resource contention
            tokio::time::sleep(Duration::from_millis(50)).await;
        }

        Ok(BenchmarkResult::new(
            "Basic Terminal Creation".to_string(),
            iterations,
            durations,
            successful,
        ))
    }

    async fn benchmark_session_terminal_creation(iterations: usize) -> Result<BenchmarkResult, String> {
        info!("Benchmarking session terminal creation ({iterations} iterations)");
        
        let manager = get_terminal_manager().await?;
        let mut durations = Vec::new();
        let mut successful = 0;

        for i in 0..iterations {
            let terminal_id = format!("session-bench-{i}-top");
            
            let start = Instant::now();
            match manager.create_terminal(terminal_id.clone(), "/tmp".to_string()).await {
                Ok(_) => {
                    let duration = start.elapsed();
                    durations.push(duration);
                    successful += 1;
                    
                    // Clean up
                    let _ = manager.close_terminal(terminal_id).await;
                }
                Err(e) => {
                    warn!("Session terminal creation failed for {terminal_id}: {e}");
                    durations.push(start.elapsed());
                }
            }
            
            tokio::time::sleep(Duration::from_millis(50)).await;
        }

        Ok(BenchmarkResult::new(
            "Session Terminal Creation".to_string(),
            iterations,
            durations,
            successful,
        ))
    }

    async fn benchmark_orchestrator_terminal_creation(iterations: usize) -> Result<BenchmarkResult, String> {
        info!("Benchmarking orchestrator terminal creation ({iterations} iterations)");
        
        let manager = get_terminal_manager().await?;
        let mut durations = Vec::new();
        let mut successful = 0;

        for _i in 0..iterations {
            let terminal_id = format!("orchestrator-{}-top", uuid::Uuid::new_v4());
            
            let start = Instant::now();
            match manager.create_terminal(terminal_id.clone(), "/tmp".to_string()).await {
                Ok(_) => {
                    let duration = start.elapsed();
                    durations.push(duration);
                    successful += 1;
                    
                    // Clean up
                    let _ = manager.close_terminal(terminal_id).await;
                }
                Err(e) => {
                    warn!("Orchestrator terminal creation failed for {terminal_id}: {e}");
                    durations.push(start.elapsed());
                }
            }
            
            tokio::time::sleep(Duration::from_millis(50)).await;
        }

        Ok(BenchmarkResult::new(
            "Orchestrator Terminal Creation".to_string(),
            iterations,
            durations,
            successful,
        ))
    }

    async fn benchmark_concurrent_creation(iterations: usize, concurrent_count: usize) -> Result<BenchmarkResult, String> {
        info!("Benchmarking concurrent terminal creation ({iterations} iterations, {concurrent_count} concurrent)");
        
        let mut durations = Vec::new();
        let mut successful = 0;

        for i in 0..iterations {
            let start = Instant::now();
            let mut batch_successful = 0;
            let mut terminal_ids = Vec::new();

            // Create terminals sequentially for now (until TerminalManager is Clone)
            for j in 0..concurrent_count {
                let terminal_id = format!("concurrent-{i}-{j}-{}", uuid::Uuid::new_v4());
                terminal_ids.push(terminal_id.clone());
                
                let manager = get_terminal_manager().await?;
                match manager.create_terminal(terminal_id.clone(), "/tmp".to_string()).await {
                    Ok(_) => batch_successful += 1,
                    Err(e) => warn!("Concurrent terminal creation failed for {terminal_id}: {e}"),
                }
            }

            let duration = start.elapsed();
            durations.push(duration);
            
            if batch_successful == concurrent_count {
                successful += 1;
            }

            // Clean up all terminals
            let manager = get_terminal_manager().await?;
            for terminal_id in terminal_ids {
                let _ = manager.close_terminal(terminal_id).await;
            }
            
            tokio::time::sleep(Duration::from_millis(100)).await;
        }

        Ok(BenchmarkResult::new(
            format!("Concurrent Creation ({concurrent_count})"),
            iterations,
            durations,
            successful,
        ))
    }
}

// Tauri command to run benchmarks from frontend
#[tauri::command]
pub async fn run_terminal_performance_benchmark() -> Result<DetailedBenchmarkMetrics, String> {
    TerminalPerformanceBenchmark::run_comprehensive_benchmark().await
}

#[tauri::command]
pub async fn run_quick_terminal_benchmark() -> Result<BenchmarkResult, String> {
    TerminalPerformanceBenchmark::benchmark_basic_terminal_creation(5).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::terminal::local::LocalPtyAdapter;
    use crate::terminal::{TerminalBackend, CreateParams};
    use std::time::{Duration, Instant};
    use log::info;

    async fn run_baseline_benchmark() -> Result<(), Box<dyn std::error::Error>> {
        println!("\n🚀 BASELINE TERMINAL PERFORMANCE BENCHMARK");
        println!("==========================================");

        let adapter = LocalPtyAdapter::new();
        let iterations = 5;
        let mut durations = Vec::new();
        let mut successful = 0;

        println!("Running {iterations} iterations of terminal creation...");

        for i in 0..iterations {
            let terminal_id = format!("baseline-bench-{i}-{}", uuid::Uuid::new_v4());
            
            let start = Instant::now();
            let result = adapter.create_with_size(
                CreateParams {
                    id: terminal_id.clone(),
                    cwd: "/tmp".to_string(),
                    app: None,
                },
                80,
                24
            ).await;

            let duration = start.elapsed();
            durations.push(duration);

            match result {
                Ok(_) => {
                    successful += 1;
                    println!("  ✅ Iteration {}: {}ms", i + 1, duration.as_millis());
                    
                    // Clean up
                    let _ = adapter.close(&terminal_id).await;
                }
                Err(e) => {
                    println!("  ❌ Iteration {}: {}ms (FAILED: {e})", i + 1, duration.as_millis());
                }
            }
            
            // Small delay between iterations
            tokio::time::sleep(Duration::from_millis(100)).await;
        }

        // Calculate statistics
        let total_ms: u128 = durations.iter().map(|d| d.as_millis()).sum();
        let avg_ms = if successful > 0 {
            total_ms as f64 / successful as f64
        } else {
            0.0
        };
        let min_ms = durations.iter().map(|d| d.as_millis()).min().unwrap_or(0);
        let max_ms = durations.iter().map(|d| d.as_millis()).max().unwrap_or(0);
        let success_rate = (successful as f64 / iterations as f64) * 100.0;

        // Display results
        println!("\n📊 BASELINE RESULTS:");
        println!("────────────────────");
        println!("  Iterations: {iterations}");
        println!("  Successful: {successful}");
        println!("  Success Rate: {:.1}%", success_rate);
        println!("  Average Time: {:.1}ms", avg_ms);
        println!("  Min Time: {min_ms}ms");
        println!("  Max Time: {max_ms}ms");
        println!("  Total Time: {total_ms}ms");

        // Performance analysis
        println!("\n🔍 ANALYSIS:");
        if avg_ms > 500.0 {
            println!("  ⚠️  SLOW: Average time > 500ms - significant optimization needed");
        } else if avg_ms > 200.0 {
            println!("  ⚡ MODERATE: Average time > 200ms - optimization recommended");
        } else {
            println!("  ✅ GOOD: Average time < 200ms - acceptable performance");
        }

        if success_rate < 100.0 {
            println!("  ❌ RELIABILITY: {:.1}% success rate - investigate failures", success_rate);
        }

        let variability = if min_ms > 0 { max_ms as f64 / min_ms as f64 } else { 1.0 };
        if variability > 3.0 {
            println!("  📊 VARIABILITY: High variance ({}x) - inconsistent performance", variability as u32);
        }

        println!("\nBaseline measurement complete! 📝");

        Ok(())
    }

    #[tokio::test]
    async fn test_baseline_terminal_performance() {
        let _ = env_logger::builder().is_test(true).try_init();
        info!("Starting baseline terminal performance test");
        
        match run_baseline_benchmark().await {
            Ok(_) => {
                info!("Baseline benchmark completed successfully");
            }
            Err(e) => {
                eprintln!("Baseline benchmark failed: {e}");
                panic!("Baseline benchmark failed: {e}");
            }
        }
    }
}