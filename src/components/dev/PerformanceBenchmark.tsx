import React, { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { theme } from '../../common/theme';
import { logger } from '../../utils/logger'

interface BenchmarkResult {
    operation: string;
    iterations: number;
    total_duration_ms: number;
    avg_duration_ms: number;
    min_duration_ms: number;
    max_duration_ms: number;
    success_rate: number;
    successful_iterations: number;
}

interface DetailedBenchmarkMetrics {
    terminal_creation: BenchmarkResult;
    session_terminal_creation: BenchmarkResult;
    orchestrator_terminal_creation: BenchmarkResult;
    concurrent_creation: BenchmarkResult;
}

export const PerformanceBenchmark: React.FC = () => {
    const [isRunning, setIsRunning] = useState(false);
    const [results, setResults] = useState<DetailedBenchmarkMetrics | null>(null);
    const [quickResult, setQuickResult] = useState<BenchmarkResult | null>(null);

    const runFullBenchmark = async () => {
        setIsRunning(true);
        try {
            logger.info('🚀 Starting comprehensive terminal performance benchmark...');
            const benchmarkResults = await invoke<DetailedBenchmarkMetrics>('run_terminal_performance_benchmark');
            setResults(benchmarkResults);
            logger.info('✅ Benchmark completed:', benchmarkResults);
        } catch (error) {
            logger.error('❌ Benchmark failed:', error);
        } finally {
            setIsRunning(false);
        }
    };

    const runQuickBenchmark = async () => {
        setIsRunning(true);
        try {
            logger.info('⚡ Starting quick terminal benchmark...');
            const quickBenchmark = await invoke<BenchmarkResult>('run_quick_terminal_benchmark');
            setQuickResult(quickBenchmark);
            logger.info('✅ Quick benchmark completed:', quickBenchmark);
        } catch (error) {
            logger.error('❌ Quick benchmark failed:', error);
        } finally {
            setIsRunning(false);
        }
    };

    const formatDuration = (ms: number): string => {
        if (ms > 1000) {
            return `${(ms / 1000).toFixed(2)}s`;
        }
        return `${ms.toFixed(1)}ms`;
    };

    const BenchmarkResultCard: React.FC<{ result: BenchmarkResult }> = ({ result }) => (
        <div className="border rounded-lg p-4 space-y-2" style={{
            backgroundColor: theme.colors.background.elevated,
            borderColor: theme.colors.border.default
        }}>
            <h3 className="font-semibold" style={{ color: theme.colors.text.primary }}>
                {result.operation}
            </h3>
            <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                    <span style={{ color: theme.colors.text.secondary }}>Iterations:</span>
                    <span className="ml-2" style={{ color: theme.colors.text.primary }}>
                        {result.iterations}
                    </span>
                </div>
                <div>
                    <span style={{ color: theme.colors.text.secondary }}>Success Rate:</span>
                    <span className={`ml-2 ${result.success_rate < 100 ? 'text-red-400' : ''}`} 
                          style={{ color: result.success_rate < 100 ? theme.colors.accent.red.light : theme.colors.accent.green.light }}>
                        {result.success_rate.toFixed(1)}%
                    </span>
                </div>
                <div>
                    <span style={{ color: theme.colors.text.secondary }}>Average Time:</span>
                    <span className="ml-2 font-mono" style={{ color: theme.colors.text.primary }}>
                        {formatDuration(result.avg_duration_ms)}
                    </span>
                </div>
                <div>
                    <span style={{ color: theme.colors.text.secondary }}>Total Time:</span>
                    <span className="ml-2 font-mono" style={{ color: theme.colors.text.primary }}>
                        {formatDuration(result.total_duration_ms)}
                    </span>
                </div>
                <div>
                    <span style={{ color: theme.colors.text.secondary }}>Min/Max:</span>
                    <span className="ml-2 font-mono" style={{ color: theme.colors.text.primary }}>
                        {formatDuration(result.min_duration_ms)} / {formatDuration(result.max_duration_ms)}
                    </span>
                </div>
            </div>
        </div>
    );

    return (
        <div className="p-6 space-y-6">
            <div>
                <h2 className="text-xl font-bold mb-4" style={{ color: theme.colors.text.primary }}>
                    Terminal Performance Benchmark
                </h2>
                <p style={{ color: theme.colors.text.secondary }}>
                    Measure terminal creation performance to identify optimization opportunities.
                </p>
            </div>

            <div className="flex gap-4">
                <button
                    onClick={runQuickBenchmark}
                    disabled={isRunning}
                    className="px-4 py-2 rounded font-medium disabled:opacity-50"
                    style={{
                        backgroundColor: theme.colors.accent.blue.DEFAULT,
                        color: theme.colors.text.primary
                    }}
                >
                    {isRunning ? 'Running...' : 'Quick Benchmark (5 iterations)'}
                </button>
                
                <button
                    onClick={runFullBenchmark}
                    disabled={isRunning}
                    className="px-4 py-2 rounded font-medium disabled:opacity-50"
                    style={{
                        backgroundColor: theme.colors.accent.green.DEFAULT,
                        color: theme.colors.text.primary
                    }}
                >
                    {isRunning ? 'Running...' : 'Full Benchmark (40+ iterations)'}
                </button>
            </div>

            {isRunning && (
                <div className="flex items-center gap-3 p-4 rounded-lg" style={{
                    backgroundColor: theme.colors.background.elevated,
                    borderColor: theme.colors.border.default
                }}>
                    <div className="animate-spin rounded-full h-6 w-6 border-b-2" style={{
                        borderColor: theme.colors.accent.blue.DEFAULT
                    }}></div>
                    <span style={{ color: theme.colors.text.secondary }}>
                        Running benchmark... This may take a few minutes.
                    </span>
                </div>
            )}

            {quickResult && (
                <div>
                    <h3 className="text-lg font-semibold mb-3" style={{ color: theme.colors.text.primary }}>
                        Quick Benchmark Results
                    </h3>
                    <BenchmarkResultCard result={quickResult} />
                </div>
            )}

            {results && (
                <div className="space-y-4">
                    <h3 className="text-lg font-semibold" style={{ color: theme.colors.text.primary }}>
                        Comprehensive Benchmark Results
                    </h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <BenchmarkResultCard result={results.terminal_creation} />
                        <BenchmarkResultCard result={results.session_terminal_creation} />
                        <BenchmarkResultCard result={results.orchestrator_terminal_creation} />
                        <BenchmarkResultCard result={results.concurrent_creation} />
                    </div>

                    {/* Performance Analysis */}
                    <div className="p-4 rounded-lg space-y-3" style={{
                        backgroundColor: theme.colors.background.secondary,
                        borderColor: theme.colors.border.subtle
                    }}>
                        <h4 className="font-semibold" style={{ color: theme.colors.text.primary }}>
                            Performance Analysis
                        </h4>
                        
                        {results.terminal_creation.avg_duration_ms > 500 && (
                            <div className="flex items-start gap-2">
                                <span className="text-yellow-400">⚠️</span>
                                <div>
                                    <p style={{ color: theme.colors.accent.yellow.light }}>
                                        Slow terminal creation detected ({formatDuration(results.terminal_creation.avg_duration_ms)} avg)
                                    </p>
                                    <p style={{ color: theme.colors.text.secondary }}>
                                        Consider implementing terminal pooling or lazy initialization optimizations.
                                    </p>
                                </div>
                            </div>
                        )}

                        {results.terminal_creation.success_rate < 100 && (
                            <div className="flex items-start gap-2">
                                <span className="text-red-400">❌</span>
                                <div>
                                    <p style={{ color: theme.colors.accent.red.light }}>
                                        Terminal creation failures detected ({results.terminal_creation.success_rate.toFixed(1)}% success rate)
                                    </p>
                                    <p style={{ color: theme.colors.text.secondary }}>
                                        Check logs for resource contention or system limits.
                                    </p>
                                </div>
                            </div>
                        )}

                        {results.terminal_creation.avg_duration_ms <= 300 && results.terminal_creation.success_rate >= 100 && (
                            <div className="flex items-start gap-2">
                                <span className="text-green-400">✅</span>
                                <p style={{ color: theme.colors.accent.green.light }}>
                                    Good terminal creation performance ({formatDuration(results.terminal_creation.avg_duration_ms)} avg)
                                </p>
                            </div>
                        )}

                        {/* Performance Variance Analysis */}
                        {(results.terminal_creation.max_duration_ms / Math.max(results.terminal_creation.min_duration_ms, 1)) > 3 && (
                            <div className="flex items-start gap-2">
                                <span className="text-orange-400">📊</span>
                                <div>
                                    <p style={{ color: theme.colors.accent.amber.light }}>
                                        High performance variability detected 
                                        ({formatDuration(results.terminal_creation.min_duration_ms)} - {formatDuration(results.terminal_creation.max_duration_ms)})
                                    </p>
                                    <p style={{ color: theme.colors.text.secondary }}>
                                        Performance inconsistency may indicate resource contention or system load issues.
                                    </p>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
};