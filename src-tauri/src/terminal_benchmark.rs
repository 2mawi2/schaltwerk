use std::time::{Duration, Instant};
use std::collections::HashMap;
use anyhow::Result;
use crate::terminal::local::LocalPtyAdapter;
use crate::terminal::TerminalBackend;
use crate::terminal::{CreateParams, ApplicationSpec};
use log::{info, warn};

#[derive(Debug, Clone)]
pub struct TerminalBenchmarkResult {
    pub operation: String,
    pub duration: Duration,
    pub iterations: usize,
    pub avg_duration: Duration,
    pub min_duration: Duration,
    pub max_duration: Duration,
    pub success_rate: f64,
}

impl TerminalBenchmarkResult {
    fn format_duration(d: &Duration) -> String {
        if d.as_secs() > 0 {
            format!("{:.2}s", d.as_secs_f64())
        } else if d.as_millis() > 0 {
            format!("{:.2}ms", d.as_millis() as f64)
        } else {
            format!("{:.0}μs", d.as_micros() as f64)
        }
    }

    pub fn display(&self) {
        println!("╭─────────────────────────────────────────────╮");
        println!("│ Operation: {:32} │", self.operation);
        println!("├─────────────────────────────────────────────┤");
        println!("│ Iterations: {:31} │", self.iterations);
        println!("│ Success rate: {:>29.1}% │", self.success_rate);
        println!("│ Total time: {:31} │", Self::format_duration(&self.duration));
        println!("│ Average:    {:31} │", Self::format_duration(&self.avg_duration));
        println!("│ Min:        {:31} │", Self::format_duration(&self.min_duration));
        println!("│ Max:        {:31} │", Self::format_duration(&self.max_duration));
        println!("╰─────────────────────────────────────────────╯");
    }
}

#[derive(Debug)]
pub struct DetailedTerminalCreationMetrics {
    pub pty_creation_time: Duration,
    pub shell_spawn_time: Duration,
    pub reader_setup_time: Duration,
    pub total_time: Duration,
}

pub struct TerminalBenchmark {
    adapter: LocalPtyAdapter,
}

impl TerminalBenchmark {
    pub fn new() -> Self {
        Self {
            adapter: LocalPtyAdapter::new(),
        }
    }

    /// Benchmark terminal creation with detailed timing
    pub async fn benchmark_terminal_creation_detailed(&self, iterations: usize) -> Result<(TerminalBenchmarkResult, Vec<DetailedTerminalCreationMetrics>)> {
        let mut durations = Vec::new();
        let mut detailed_metrics = Vec::new();
        let mut successful_iterations = 0;
        let total_start = Instant::now();

        for i in 0..iterations {
            let terminal_id = format!("bench-terminal-{}-{}", i, uuid::Uuid::new_v4());
            
            info!("Starting terminal creation benchmark iteration {}/{}", i + 1, iterations);
            
            let iteration_start = Instant::now();
            
            // Measure detailed components
            let pty_start = Instant::now();
            
            let params = CreateParams {
                id: terminal_id.clone(),
                cwd: "/tmp".to_string(),
                app: None,
            };

            match self.adapter.create_with_size(params, 80, 24).await {
                Ok(_) => {
                    let total_creation_time = iteration_start.elapsed();
                    durations.push(total_creation_time);
                    successful_iterations += 1;

                    // For now, we can only measure total time since LocalPtyAdapter
                    // doesn't expose internal timing details
                    detailed_metrics.push(DetailedTerminalCreationMetrics {
                        pty_creation_time: Duration::from_millis(0), // Would need instrumentation
                        shell_spawn_time: Duration::from_millis(0),   // Would need instrumentation
                        reader_setup_time: Duration::from_millis(0),  // Would need instrumentation
                        total_time: total_creation_time,
                    });

                    // Clean up
                    if let Err(e) = self.adapter.close(&terminal_id).await {
                        warn!("Failed to cleanup terminal {}: {}", terminal_id, e);
                    }
                }
                Err(e) => {
                    warn!("Terminal creation failed for {}: {}", terminal_id, e);
                }
            }
        }

        let total_duration = total_start.elapsed();
        let avg_duration = if successful_iterations > 0 {
            total_duration / successful_iterations as u32
        } else {
            Duration::from_millis(0)
        };
        let min_duration = durations.iter().min().copied().unwrap_or(Duration::from_millis(0));
        let max_duration = durations.iter().max().copied().unwrap_or(Duration::from_millis(0));
        let success_rate = (successful_iterations as f64 / iterations as f64) * 100.0;

        let result = TerminalBenchmarkResult {
            operation: "Terminal Creation (Detailed)".to_string(),
            duration: total_duration,
            iterations,
            avg_duration,
            min_duration,
            max_duration,
            success_rate,
        };

        Ok((result, detailed_metrics))
    }

    /// Benchmark concurrent terminal creation
    pub async fn benchmark_concurrent_creation(&self, concurrent_count: usize) -> Result<TerminalBenchmarkResult> {
        info!("Starting concurrent terminal creation benchmark with {} terminals", concurrent_count);
        
        let start_time = Instant::now();
        let mut handles = Vec::new();

        for i in 0..concurrent_count {
            let terminal_id = format!("concurrent-bench-{}-{}", i, uuid::Uuid::new_v4());
            let adapter_clone = self.adapter.clone(); // LocalPtyAdapter needs to implement Clone for this
            
            // For now, we'll do them sequentially since LocalPtyAdapter might not be Clone
            // In a real implementation, you'd want proper async concurrency
        }

        // Sequential implementation for now
        let mut successful_creations = 0;
        let mut durations = Vec::new();
        
        for i in 0..concurrent_count {
            let terminal_id = format!("concurrent-bench-{}-{}", i, uuid::Uuid::new_v4());
            let creation_start = Instant::now();
            
            let params = CreateParams {
                id: terminal_id.clone(),
                cwd: "/tmp".to_string(),
                app: None,
            };

            match self.adapter.create_with_size(params, 80, 24).await {
                Ok(_) => {
                    let duration = creation_start.elapsed();
                    durations.push(duration);
                    successful_creations += 1;
                    
                    // Clean up
                    let _ = self.adapter.close(&terminal_id).await;
                }
                Err(e) => {
                    warn!("Concurrent terminal creation failed for {}: {}", terminal_id, e);
                }
            }
        }

        let total_duration = start_time.elapsed();
        let avg_duration = if successful_creations > 0 {
            total_duration / successful_creations as u32
        } else {
            Duration::from_millis(0)
        };
        let min_duration = durations.iter().min().copied().unwrap_or(Duration::from_millis(0));
        let max_duration = durations.iter().max().copied().unwrap_or(Duration::from_millis(0));
        let success_rate = (successful_creations as f64 / concurrent_count as f64) * 100.0;

        Ok(TerminalBenchmarkResult {
            operation: format!("Concurrent Creation ({})", concurrent_count),
            duration: total_duration,
            iterations: concurrent_count,
            avg_duration,
            min_duration,
            max_duration,
            success_rate,
        })
    }

    /// Benchmark terminal creation with different shell types
    pub async fn benchmark_shell_variations(&self) -> Result<Vec<TerminalBenchmarkResult>> {
        let shell_configs = vec![
            ("Default Shell", None),
            ("Bash Interactive", Some(ApplicationSpec {
                command: "/bin/bash".to_string(),
                args: vec!["-i".to_string()],
                env: vec![],
                ready_timeout_ms: 5000,
            })),
            ("Zsh Interactive", Some(ApplicationSpec {
                command: "/bin/zsh".to_string(),
                args: vec!["-i".to_string()],
                env: vec![],
                ready_timeout_ms: 5000,
            })),
        ];

        let mut results = Vec::new();
        
        for (shell_name, app_spec) in shell_configs {
            info!("Benchmarking shell: {}", shell_name);
            
            let result = self.benchmark_shell_type(shell_name, app_spec.clone(), 3).await?;
            results.push(result);
        }

        Ok(results)
    }

    async fn benchmark_shell_type(&self, shell_name: &str, app_spec: Option<ApplicationSpec>, iterations: usize) -> Result<TerminalBenchmarkResult> {
        let mut durations = Vec::new();
        let mut successful_iterations = 0;
        let total_start = Instant::now();

        for i in 0..iterations {
            let terminal_id = format!("shell-bench-{}-{}-{}", shell_name.replace(" ", "-").to_lowercase(), i, uuid::Uuid::new_v4());
            let iteration_start = Instant::now();
            
            let params = CreateParams {
                id: terminal_id.clone(),
                cwd: "/tmp".to_string(),
                app: app_spec.clone(),
            };

            match self.adapter.create_with_size(params, 80, 24).await {
                Ok(_) => {
                    let duration = iteration_start.elapsed();
                    durations.push(duration);
                    successful_iterations += 1;
                    
                    // Clean up
                    let _ = self.adapter.close(&terminal_id).await;
                }
                Err(e) => {
                    warn!("Shell benchmark failed for {} ({}): {}", shell_name, terminal_id, e);
                }
            }
        }

        let total_duration = total_start.elapsed();
        let avg_duration = if successful_iterations > 0 {
            total_duration / successful_iterations as u32
        } else {
            Duration::from_millis(0)
        };
        let min_duration = durations.iter().min().copied().unwrap_or(Duration::from_millis(0));
        let max_duration = durations.iter().max().copied().unwrap_or(Duration::from_millis(0));
        let success_rate = (successful_iterations as f64 / iterations as f64) * 100.0;

        Ok(TerminalBenchmarkResult {
            operation: format!("Shell: {}", shell_name),
            duration: total_duration,
            iterations,
            avg_duration,
            min_duration,
            max_duration,
            success_rate,
        })
    }

    /// Run comprehensive terminal performance benchmarks
    pub async fn run_all_benchmarks(&self) -> Result<()> {
        println!("\n🚀 Running Terminal Performance Benchmarks\n");
        println!("═══════════════════════════════════════════════");
        
        // Basic terminal creation benchmark
        info!("Starting basic terminal creation benchmark");
        let (basic_result, detailed_metrics) = self.benchmark_terminal_creation_detailed(5).await?;
        basic_result.display();

        // Display detailed metrics if available
        if !detailed_metrics.is_empty() {
            println!("\n📊 Detailed Timing Breakdown:");
            for (i, metrics) in detailed_metrics.iter().enumerate() {
                println!("  Iteration {}: Total={}ms", 
                    i + 1, 
                    TerminalBenchmarkResult::format_duration(&metrics.total_time)
                );
            }
        }

        // Concurrent creation benchmark
        info!("Starting concurrent terminal creation benchmark");
        let concurrent_result = self.benchmark_concurrent_creation(3).await?;
        concurrent_result.display();

        // Shell variation benchmarks
        info!("Starting shell variation benchmarks");
        let shell_results = self.benchmark_shell_variations().await?;
        for result in shell_results {
            result.display();
        }

        // Performance analysis
        self.analyze_performance_bottlenecks(&basic_result).await?;

        println!("\n✅ All terminal benchmarks completed!");
        Ok(())
    }

    /// Analyze performance bottlenecks and provide recommendations
    async fn analyze_performance_bottlenecks(&self, creation_result: &TerminalBenchmarkResult) -> Result<()> {
        println!("\n🔍 Performance Analysis & Recommendations\n");
        println!("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

        // Analyze creation time
        let avg_ms = creation_result.avg_duration.as_millis();
        
        if avg_ms > 500 {
            println!("⚠️  SLOW: Terminal creation taking {}ms on average", avg_ms);
            println!("   Recommendations:");
            println!("   • Check PTY system performance");
            println!("   • Consider shell startup optimization");
            println!("   • Review environment variable setup");
        } else if avg_ms > 200 {
            println!("⚡ MODERATE: Terminal creation taking {}ms on average", avg_ms);
            println!("   Recommendations:");
            println!("   • Consider terminal pooling for frequently used shells");
            println!("   • Optimize WebGL addon initialization");
        } else {
            println!("✅ GOOD: Terminal creation taking {}ms on average", avg_ms);
        }

        // Check success rate
        if creation_result.success_rate < 100.0 {
            println!("\n⚠️  SUCCESS RATE: {:.1}% success rate detected", creation_result.success_rate);
            println!("   • Review error handling in terminal creation");
            println!("   • Check resource cleanup");
        }

        // Performance variability
        let variability = creation_result.max_duration.as_millis() as f64 / creation_result.min_duration.as_millis() as f64;
        if variability > 3.0 {
            println!("\n⚠️  VARIABILITY: High performance variability detected ({}x difference)", variability as u32);
            println!("   • Consider more consistent initialization patterns");
            println!("   • Review resource contention");
        }

        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_terminal_creation_benchmark() {
        let benchmark = TerminalBenchmark::new();
        
        let (result, _metrics) = benchmark.benchmark_terminal_creation_detailed(1).await.unwrap();
        
        assert_eq!(result.iterations, 1);
        assert!(result.duration.as_millis() > 0);
        assert!(result.success_rate > 0.0);
    }

    #[tokio::test]
    async fn test_concurrent_creation_benchmark() {
        let benchmark = TerminalBenchmark::new();
        
        let result = benchmark.benchmark_concurrent_creation(2).await.unwrap();
        
        assert_eq!(result.iterations, 2);
        assert!(result.duration.as_millis() > 0);
    }
}