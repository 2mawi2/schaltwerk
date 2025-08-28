use std::time::{Duration, Instant};
use std::path::PathBuf;
use anyhow::Result;
use crate::schaltwerk_core::{
    database::Database,
    SessionManager,
    git,
};

pub struct BenchmarkResult {
    pub operation: String,
    pub duration: Duration,
    pub iterations: usize,
    pub avg_duration: Duration,
    pub min_duration: Duration,
    pub max_duration: Duration,
}

impl BenchmarkResult {
    fn format_duration(d: &Duration) -> String {
        if d.as_secs() > 0 {
            format!("{:.2}s", d.as_secs_f64())
        } else {
            format!("{:.2}ms", d.as_millis() as f64)
        }
    }

    pub fn display(&self) {
        println!("╭─────────────────────────────────────────────╮");
        println!("│ Operation: {:32} │", self.operation);
        println!("├─────────────────────────────────────────────┤");
        println!("│ Iterations: {:31} │", self.iterations);
        println!("│ Total time: {:31} │", Self::format_duration(&self.duration));
        println!("│ Average:    {:31} │", Self::format_duration(&self.avg_duration));
        println!("│ Min:        {:31} │", Self::format_duration(&self.min_duration));
        println!("│ Max:        {:31} │", Self::format_duration(&self.max_duration));
        println!("╰─────────────────────────────────────────────╯");
    }
}

pub struct SessionBenchmark {
    manager: SessionManager,
    repo_path: PathBuf,
    db: Database,
}

impl SessionBenchmark {
    pub fn new(db: Database, repo_path: PathBuf) -> Self {
        let manager = SessionManager::new(db.clone(), repo_path.clone());
        Self { manager, repo_path, db }
    }

    fn measure_operation<F>(&self, name: &str, iterations: usize, mut op: F) -> Result<BenchmarkResult>
    where
        F: FnMut() -> Result<()>,
    {
        let mut durations = Vec::new();
        let total_start = Instant::now();

        for i in 0..iterations {
            log::debug!("Benchmark {}: iteration {}/{}", name, i + 1, iterations);
            let start = Instant::now();
            op()?;
            let duration = start.elapsed();
            durations.push(duration);
        }

        let total_duration = total_start.elapsed();
        let avg_duration = total_duration / iterations as u32;
        let min_duration = *durations.iter().min().unwrap();
        let max_duration = *durations.iter().max().unwrap();

        Ok(BenchmarkResult {
            operation: name.to_string(),
            duration: total_duration,
            iterations,
            avg_duration,
            min_duration,
            max_duration,
        })
    }

    pub fn benchmark_cancel_session(&self, iterations: usize) -> Result<BenchmarkResult> {
        self.measure_operation("Cancel Session", iterations, || {
            // Create a session to cancel
            let session_name = format!("bench-cancel-{}", uuid::Uuid::new_v4());
            self.manager.create_session_with_auto_flag(&session_name, None, None, false)?;
            
            // Add some changes to make it more realistic
            let session = self.manager.get_session(&session_name)?;
            if let Ok(path) = std::fs::canonicalize(&session.worktree_path) {
                let test_file = path.join("benchmark.txt");
                std::fs::write(&test_file, "benchmark content")?;
                // Stage the file (simulate git add)
                std::process::Command::new("git")
                    .arg("add")
                    .arg(&test_file)
                    .current_dir(&path)
                    .output()?;
            }

            // Measure cancel operation
            self.manager.cancel_session(&session_name)?;
            Ok(())
        })
    }

    pub fn benchmark_cancel_with_profile(&self) -> Result<()> {
        println!("\n🔍 Profiling session cancellation...\n");
        
        // Create sessions with different sizes to profile
        let test_cases = vec![
            ("Small (10 files)", 10, 5),
            ("Medium (100 files)", 100, 50),
            ("Large (500 files)", 500, 250),
        ];
        
        for (description, file_count, staged_count) in test_cases {
            println!("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
            println!("📁 Test case: {}", description);
            println!("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
            
            let session_name = format!("profile-cancel-{}", uuid::Uuid::new_v4());
            self.manager.create_session_with_auto_flag(&session_name, None, None, false)?;
            
            let session = self.manager.get_session(&session_name)?;
            if let Ok(path) = std::fs::canonicalize(&session.worktree_path) {
                // Create many files to simulate a heavy session
                for i in 0..file_count {
                    let file_path = path.join(format!("file_{}.txt", i));
                    std::fs::write(&file_path, format!("content {}", i))?;
                }
                
                // Stage some of them
                for i in 0..staged_count {
                    let file_path = path.join(format!("file_{}.txt", i));
                    // Stage the file (simulate git add)
                    std::process::Command::new("git")
                        .arg("add")
                        .arg(&file_path)
                        .current_dir(&path)
                        .output()?;
                }
            }

            println!("📊 Starting profiled cancellation...");
            let start = Instant::now();
            
            // Profile individual steps
            let step1 = Instant::now();
            let session = self.manager.get_session(&session_name)?;
            let step1_duration = step1.elapsed();
            
            let step2 = Instant::now();
            let has_uncommitted = if session.worktree_path.exists() {
                git::has_uncommitted_changes(&session.worktree_path).unwrap_or(false)
            } else {
                false
            };
            let step2_duration = step2.elapsed();
            
            let step3 = Instant::now();
            if session.worktree_path.exists() {
                // Profile git worktree removal in more detail
                let step3a = Instant::now();
                let output = std::process::Command::new("git")
                    .arg("worktree")
                    .arg("remove")
                    .arg("-f")
                    .arg(&session.worktree_path)
                    .current_dir(&self.repo_path)
                    .output();
                let step3a_duration = step3a.elapsed();
                
                if let Err(e) = output {
                    return Err(anyhow::anyhow!("Failed to remove worktree: {}", e));
                }
                
                println!("    • Git worktree remove command: {:?}", step3a_duration);
            }
            let step3_duration = step3.elapsed();
            
            let step4 = Instant::now();
            if git::branch_exists(&self.repo_path, &session.branch)? {
                // Profile branch archiving in more detail  
                let step4a = Instant::now();
                let archive_name = format!("archive/{}-{}", session.name, chrono::Utc::now().format("%Y%m%d-%H%M%S"));
                
                // Create archive tag
                let _ = std::process::Command::new("git")
                    .args(["tag", "-f", &archive_name, &session.branch])
                    .current_dir(&self.repo_path)
                    .output();
                let step4a_duration = step4a.elapsed();
                
                // Delete branch
                let step4b = Instant::now();
                let _ = std::process::Command::new("git")
                    .args(["branch", "-D", &session.branch])
                    .current_dir(&self.repo_path)
                    .output();
                let step4b_duration = step4b.elapsed();
                
                println!("    • Create archive tag: {:?}", step4a_duration);
                println!("    • Delete branch: {:?}", step4b_duration);
            }
            let step4_duration = step4.elapsed();
            
            let step5 = Instant::now();
            // Update status via manager (internal method not accessible)
            // For now just measure the cancel_session which includes this
            // self.manager.db_manager.update_session_status(&session.id, SessionStatus::Cancelled)?;
            let step5_duration = step5.elapsed();
            
            let total_duration = start.elapsed();
            
            // Display results
            println!("\n📊 Performance Breakdown:");
            println!("  ├─ Get session from DB:      {:>8.2}ms ({:>4.1}%)", 
                step1_duration.as_millis(), (step1_duration.as_secs_f64() / total_duration.as_secs_f64()) * 100.0);
            println!("  ├─ Check uncommitted:        {:>8.2}ms ({:>4.1}%) [has_changes: {}]", 
                step2_duration.as_millis(), (step2_duration.as_secs_f64() / total_duration.as_secs_f64()) * 100.0, has_uncommitted);
            println!("  ├─ Remove worktree:          {:>8.2}ms ({:>4.1}%)", 
                step3_duration.as_millis(), (step3_duration.as_secs_f64() / total_duration.as_secs_f64()) * 100.0);
            println!("  ├─ Archive branch:           {:>8.2}ms ({:>4.1}%)", 
                step4_duration.as_millis(), (step4_duration.as_secs_f64() / total_duration.as_secs_f64()) * 100.0);
            println!("  └─ Update DB status:         {:>8.2}ms ({:>4.1}%)", 
                step5_duration.as_millis(), (step5_duration.as_secs_f64() / total_duration.as_secs_f64()) * 100.0);
            println!("\n📈 Total cancellation time:    {:>8.2}ms", total_duration.as_millis());
        }
        
        Ok(())
    }

    pub fn benchmark_start_session(&self, iterations: usize) -> Result<BenchmarkResult> {
        self.measure_operation("Start Draft Session", iterations, || {
            let session_name = format!("bench-start-{}", uuid::Uuid::new_v4());
            
            // Create draft session
            self.manager.create_draft_session(&session_name, "Benchmark test")?;
            
            // Start it
            self.manager.start_draft_session(&session_name, None)?;
            
            // Clean up
            self.manager.cancel_session(&session_name)?;
            Ok(())
        })
    }

    pub fn benchmark_mark_ready_session(&self, iterations: usize) -> Result<BenchmarkResult> {
        self.measure_operation("Mark Session Ready", iterations, || {
            let session_name = format!("bench-ready-{}", uuid::Uuid::new_v4());
            
            // Create and setup session
            self.manager.create_session_with_auto_flag(&session_name, None, None, false)?;
            
            let session = self.manager.get_session(&session_name)?;
            if let Ok(path) = std::fs::canonicalize(&session.worktree_path) {
                // Add changes
                for i in 0..5 {
                    let file_path = path.join(format!("ready_{}.txt", i));
                    std::fs::write(&file_path, format!("ready content {}", i))?;
                    // Stage the file (simulate git add)
                    std::process::Command::new("git")
                        .arg("add")
                        .arg(&file_path)
                        .current_dir(&path)
                        .output()?;
                }
                // Commit the changes
                std::process::Command::new("git")
                    .arg("commit")
                    .arg("-m")
                    .arg("Benchmark commit")
                    .current_dir(&path)
                    .output()?;
            }
            
            // Mark as ready
            self.manager.mark_session_ready(&session_name, false)?;
            
            // Clean up
            self.manager.cancel_session(&session_name)?;
            Ok(())
        })
    }

    pub fn run_all_benchmarks(&self) -> Result<()> {
        println!("\n🚀 Running Session Operation Benchmarks\n");
        println!("═══════════════════════════════════════════════");
        
        // Quick warm-up
        let _ = self.manager.create_session_with_auto_flag("warmup", None, None, false);
        let _ = self.manager.cancel_session("warmup");
        
        // Run benchmarks with fewer iterations for testing
        let cancel_result = self.benchmark_cancel_session(5)?;
        cancel_result.display();
        
        let start_result = self.benchmark_start_session(5)?;
        start_result.display();
        
        let ready_result = self.benchmark_mark_ready_session(5)?;
        ready_result.display();
        
        // Run detailed profiling
        self.benchmark_cancel_with_profile()?;
        
        // Compare sync vs async cancel performance
        println!("\n🏁 Performance Comparison: Sync vs Async Cancel");
        println!("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
        self.compare_cancel_performance()?;
        
        println!("\n✅ All benchmarks completed!");
        Ok(())
    }
    
    pub fn compare_cancel_performance(&self) -> Result<()> {
        use tokio::runtime::Runtime;
        
        let file_counts = vec![10, 100, 500];
        
        for file_count in file_counts {
            println!("\n📊 Testing with {} files:", file_count);
            
            // Test sync version
            let session_name_sync = format!("sync-test-{}", uuid::Uuid::new_v4());
            self.manager.create_session_with_auto_flag(&session_name_sync, None, None, false)?;
            
            let session = self.manager.get_session(&session_name_sync)?;
            if let Ok(path) = std::fs::canonicalize(&session.worktree_path) {
                for i in 0..file_count {
                    let file_path = path.join(format!("file_{}.txt", i));
                    std::fs::write(&file_path, format!("content {}", i))?;
                }
            }
            
            let sync_start = Instant::now();
            self.manager.cancel_session(&session_name_sync)?;
            let sync_duration = sync_start.elapsed();
            
            // Test async version
            let session_name_async = format!("async-test-{}", uuid::Uuid::new_v4());
            self.manager.create_session_with_auto_flag(&session_name_async, None, None, false)?;
            
            let session = self.manager.get_session(&session_name_async)?;
            if let Ok(path) = std::fs::canonicalize(&session.worktree_path) {
                for i in 0..file_count {
                    let file_path = path.join(format!("file_{}.txt", i));
                    std::fs::write(&file_path, format!("content {}", i))?;
                }
            }
            
            let rt = Runtime::new()?;
            
            // Create a new manager for async test to avoid cloning issues
            let async_manager = SessionManager::new(
                self.db.clone(), 
                self.repo_path.clone()
            );
            
            let async_start = Instant::now();
            rt.block_on(async move {
                async_manager.fast_cancel_session(&session_name_async).await
            })?;
            let async_duration = async_start.elapsed();
            
            // Calculate improvement
            let improvement = ((sync_duration.as_millis() as f64 - async_duration.as_millis() as f64) 
                / sync_duration.as_millis() as f64) * 100.0;
            
            println!("  Sync cancel:  {:>6}ms", sync_duration.as_millis());
            println!("  Async cancel: {:>6}ms", async_duration.as_millis());
            println!("  Improvement:  {:>5.1}% faster", improvement);
        }
        
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn setup_test_env() -> Result<(TempDir, PathBuf, Database)> {
        let temp_dir = TempDir::new()?;
        let repo_path = temp_dir.path().to_path_buf();
        
        // Initialize git repo
        std::process::Command::new("git")
            .arg("init")
            .current_dir(&repo_path)
            .output()?;
        
        // Create initial commit
        let readme = repo_path.join("README.md");
        std::fs::write(&readme, "# Test Repo")?;
        std::process::Command::new("git")
            .arg("add")
            .arg(&readme)
            .current_dir(&repo_path)
            .output()?;
        std::process::Command::new("git")
            .arg("commit")
            .arg("-m")
            .arg("Initial commit")
            .current_dir(&repo_path)
            .output()?;
        
        let db_path = repo_path.join(".schaltwerk.db");
        let db = Database::new(Some(db_path))?;
        
        Ok((temp_dir, repo_path, db))
    }

    #[test]
    fn test_benchmark_cancel() -> Result<()> {
        let (_temp_dir, repo_path, db) = setup_test_env()?;
        let benchmark = SessionBenchmark::new(db, repo_path);
        
        let result = benchmark.benchmark_cancel_session(1)?;
        assert_eq!(result.iterations, 1);
        assert!(result.duration.as_millis() > 0);
        
        Ok(())
    }

    #[test]
    fn test_benchmark_suite() -> Result<()> {
        let (_temp_dir, repo_path, db) = setup_test_env()?;
        let benchmark = SessionBenchmark::new(db, repo_path);
        
        benchmark.run_all_benchmarks()?;
        Ok(())
    }
}