import React from 'react'
import { BranchingDiagram, LifecycleDiagram } from './Diagrams'

export interface OnboardingStep {
    title: string
    content: React.ReactNode
    highlight?: string
    action?: 'highlight' | 'overlay'
}

export const ONBOARDING_STEPS: OnboardingStep[] = [
    {
        title: "Welcome to Schaltwerk!",
        content: (
            <div>
                <p className="mb-4">
                    Schaltwerk is a visual interface for managing AI-powered development agents. It helps you work with different AI agents to complete coding agents efficiently.
                </p>
                <p className="mb-4">
                    Each session runs in its own isolated environment (called a worktree), so you can work on multiple agents simultaneously without conflicts.
                </p>
                <p className="text-body text-slate-400">
                    This tutorial will show you the key features and how to get started.
                </p>
            </div>
        )
    },
    {
        title: "Layout and Navigation",
        content: (
            <div>
                <p className="mb-4">
                    Schaltwerk's interface is designed for efficient keyboard-driven workflow:
                </p>
                <ul className="list-disc pl-6 mb-4 space-y-2">
                    <li><strong>Left Sidebar:</strong> Agent list and project navigation</li>
                    <li><strong>Center Panel:</strong> AI Agent workspace (Claude, Cursor, Gemini, etc.)</li>
                    <li><strong>Bottom Terminals:</strong> Command-line access for development agents</li>
                    <li><strong>Right Panel:</strong> Diff viewer for changes or Agents/Specs overview</li>
                </ul>
                <div className="bg-blue-900/30 border border-blue-700/50 rounded p-3">
                    <div className="flex items-start gap-2">
                        <svg className="w-5 h-5 text-blue-400 mt-0.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                        </svg>
                        <div>
                            <p className="text-blue-200 text-body">
                                <strong>Keyboard-First:</strong> Schaltwerk is fully controllable via keyboard shortcuts for rapid context switching.
                            </p>
                            <p className="text-blue-300/80 text-body mt-1">
                                Use <kbd className="px-1 py-0.5 bg-slate-700 rounded text-caption">⌘↑/↓</kbd> to switch agents, <kbd className="px-1 py-0.5 bg-slate-700 rounded text-caption">⌘T</kbd> for AI agent, <kbd className="px-1 py-0.5 bg-slate-700 rounded text-caption">⌘/</kbd> for terminals.
                            </p>
                        </div>
                    </div>
                </div>
            </div>
        )
    },
    {
        title: "Open Your Worktree",
        content: (
            <div>
                <p className="mb-4">
                    When you're ready to work in your editor or terminal, use the <strong>Open</strong> button in the top bar.
                </p>
                <ol className="list-decimal list-inside space-y-2 mb-4 text-body text-slate-300">
                    <li>Select the session whose files you want to edit — specs, running agents, or the orchestrator.</li>
                    <li>Click <strong>Open</strong> to launch that session's worktree or the global project in your default tool.</li>
                </ol>
                <p className="text-body text-slate-400">
                    Need a different app? Use the arrow beside <strong>Open</strong> to choose Finder, Cursor, VS Code, or another configured tool.
                </p>
            </div>
        ),
        highlight: '[data-testid="topbar-open-button"]',
        action: 'highlight'
    },
    {
        title: "Creating Sessions",
        content: (
            <div>
                <p className="mb-4">
                    There are two types of sessions you can create:
                </p>
                <div className="space-y-3 mb-4">
                    <div className="bg-slate-800/50 border border-slate-700 rounded p-3">
                        <h4 className="text-blue-400 font-medium mb-2">Running Agents</h4>
                        <p className="text-body text-slate-300 mb-2">Start immediately with an AI agent working on your agent.</p>
                        <kbd className="px-2 py-1 bg-slate-700 rounded text-caption">⌘N</kbd>
                    </div>
                    <div className="bg-slate-800/50 border border-slate-700 rounded p-3">
                        <h4 className="text-amber-400 font-medium mb-2">Specs</h4>
                        <p className="text-body text-slate-300 mb-2">Create a workspace to spec your agent before starting the AI agent.</p>
                        <kbd className="px-2 py-1 bg-slate-700 rounded text-caption">⇧⌘N</kbd>
                    </div>
                </div>
                <p className="text-body text-slate-400">
                    Use specs to gather requirements, design solutions, or prepare context before the AI agent begins work.
                </p>
            </div>
        ),
        highlight: '[data-testid="sidebar"]',
        action: 'highlight'
    },
    {
        title: "Orchestrator Basics (MCP)",
        content: (
            <div>
                <p className="mb-4">
                    The <strong>Orchestrator</strong> is your repo’s control center. With MCP enabled, use natural language or one‑click actions to integrate sessions. Sessions are git branches + worktrees, so you can merge, PR, or rebase per your strategy.
                </p>
                <div className="bg-purple-900/30 border border-purple-700/50 rounded p-3 mb-4">
                    <div className="flex items-start gap-2">
                        <svg className="w-5 h-5 text-purple-400 mt-0.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                        </svg>
                        <div>
                            <p className="text-purple-200 text-body font-medium mb-1">What you can do</p>
                            <ul className="text-caption text-purple-300/80 space-y-1 list-disc list-inside">
                                <li>Configure an <strong>Action Button</strong> for one‑click routines.</li>
                                <li>Prompt the orchestrator manually in natural language.</li>
                                <li>Or manage branches directly — <code>schaltwerk/{'{'}session{'}'}</code> + <code>.schaltwerk/worktrees/{'{'}session{'}'}</code>.</li>
                            </ul>
                        </div>
                    </div>
                </div>

                <div className="grid grid-cols-1 gap-3">
                    <div className="bg-slate-800/50 border border-slate-700 rounded p-3 min-w-0">
                        <h4 className="text-blue-400 font-medium mb-2">Lifecycle at a Glance</h4>
                        <LifecycleDiagram />
                    </div>
                    <div className="bg-slate-800/50 border border-slate-700 rounded p-3 min-w-0">
                        <h4 className="text-emerald-400 font-medium mb-2">Branching Examples</h4>
                        <BranchingDiagram />
                    </div>
                </div>
            </div>
        ),
        highlight: '.font-medium.text-slate-100',
        action: 'highlight'
    },
    {
        title: "Orchestrator Actions (MCP)",
        content: (
            <div>
                <div className="bg-blue-900/30 border border-blue-700/50 rounded p-3 mb-4">
                    <p className="text-blue-200 text-body font-medium mb-2">Action Button Presets</p>
                    <ul className="text-caption text-blue-300/80 space-y-2 list-disc list-inside">
                        <li><strong>Merge Reviewed to Main:</strong> Find Reviewed → run <code>npm run test</code> (or <code>just test</code>) → squash‑merge into <code>main</code> → push → ask to cancel sessions.</li>
                        <li><strong>PR All Running to Feature:</strong> Push each <code>schaltwerk/{'{'}session{'}'}</code> → open PRs into your chosen <code>feature/x</code> → leave sessions running.</li>
                        <li><strong>Review Queue:</strong> List sessions + diffs → per session choose Merge, PR, or Skip.</li>
                    </ul>
                    <p className="text-caption text-blue-300/70 mt-2">Configure in Settings → Action Buttons. Trigger via F1–F6 or click in the terminal header.</p>
                </div>

                <div className="bg-amber-900/30 border border-amber-700/50 rounded p-3 mb-4">
                    <p className="text-amber-200 text-body font-medium mb-2">Manual Orchestrator Prompts</p>
                    <ul className="text-caption text-amber-300/80 space-y-1 list-disc list-inside">
                        <li>“Find all reviewed sessions, run tests, squash‑merge into main, then cancel each after success. Confirm per session.”</li>
                        <li>“For running sessions based on feature/payments, push to origin as schaltwerk/{'{'}session{'}'}, open PRs into feature/payments. Don’t cancel.”</li>
                        <li>“Group sessions by base branch and let me choose: merge reviewed now or create PRs for running.”</li>
                    </ul>
                </div>

                <div className="bg-slate-800/50 border border-slate-700 rounded p-3 mb-4">
                    <h4 className="text-slate-200 font-medium mb-1">DIY (No Orchestrator Needed)</h4>
                    <p className="text-body text-slate-300 mb-2">Use git directly — sessions are normal branches + worktrees.</p>
                    <ol className="text-caption text-slate-400 list-decimal list-inside space-y-1">
                        <li>Checkout target branch (<code>main</code> or <code>feature/x</code>).</li>
                        <li>Review <code>schaltwerk/{'{'}session{'}'}</code> → <code>git merge --squash</code> or open a PR.</li>
                        <li>After integration, cancel the session in Schaltwerk to remove its worktree.</li>
                    </ol>
                    <p className="text-caption text-slate-500 mt-2">Worktrees live in <code>.schaltwerk/worktrees/{'{'}session{'}'}</code>.</p>
                </div>

                <div className="bg-blue-900/30 border border-blue-700/50 rounded p-3">
                    <p className="text-blue-200 text-body"><strong>Tip:</strong> Start sessions off the branch you plan to integrate back into. Example: start from <code>feature/payments</code> → merge/PR back to <code>feature/payments</code>; or start from <code>main</code> → merge back to <code>main</code>.</p>
                </div>
            </div>
        )
    },
    {
        title: "MCP Integration (Optional)",
        content: (
            <div>
                <p className="mb-4">
                    <strong>Model Context Protocol (MCP)</strong> enables Claude Code to directly manage your Schaltwerk sessions through natural language commands.
                </p>
                <div className="bg-blue-900/30 border border-blue-700/50 rounded p-3 mb-4">
                    <div className="flex items-start gap-2">
                        <svg className="w-5 h-5 text-blue-400 mt-0.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                        </svg>
                        <div>
                            <p className="text-blue-200 text-body font-medium mb-2">
                                Opt-in Setup Required
                            </p>
                            <p className="text-blue-300/80 text-body mb-2">
                                To enable MCP integration:
                            </p>
                            <ul className="text-caption text-blue-300/70 space-y-1 list-disc list-inside">
                                <li>Go to Settings (<kbd className="px-1 py-0.5 bg-slate-700 rounded text-caption">⌘,</kbd>) → Agent Configuration → Claude</li>
                                <li>Enable "MCP Server Configuration"</li>
                                <li>Click "Configure MCP for This Project"</li>
                                <li>Restart Claude Code to activate</li>
                            </ul>
                        </div>
                    </div>
                </div>
                <div className="text-body text-slate-400">
                    <p className="mb-2">
                        <strong>What you get:</strong> Natural language session management, orchestrator workflow control, and seamless integration between Claude Code and Schaltwerk.
                    </p>
                    <p>
                        <strong>Note:</strong> This is completely optional - Schaltwerk works perfectly without MCP integration.
                    </p>
                </div>
            </div>
        )
    },
    {
        title: "Keyboard-Driven Session Management",
        content: (
            <div>
                <p className="mb-4">
                    Schaltwerk is designed for rapid context switching without mouse interaction:
                </p>
                <div className="space-y-3 mb-4">
                    <div className="text-body">
                        <strong className="text-slate-200">Session Navigation:</strong>
                        <ul className="list-disc pl-6 mt-1 space-y-1">
                            <li><kbd className="px-1 py-0.5 bg-slate-700 rounded text-caption">⌘1-9</kbd> Jump to specific agent by number</li>
                            <li><kbd className="px-1 py-0.5 bg-slate-700 rounded text-caption">⌘↑/↓</kbd> Cycle through sessions smoothly</li>
                            <li><kbd className="px-1 py-0.5 bg-slate-700 rounded text-caption">⌘1</kbd> Switch to Orchestrator</li>
                        </ul>
                    </div>
                    <div className="text-body">
                        <strong className="text-slate-200">Focus Control:</strong>
                        <ul className="list-disc pl-6 mt-1 space-y-1">
                            <li><kbd className="px-1 py-0.5 bg-slate-700 rounded text-caption">⌘T</kbd> Focus AI agent panel</li>
                            <li><kbd className="px-1 py-0.5 bg-slate-700 rounded text-caption">⌘/</kbd> Focus terminal</li>
                            <li><kbd className="px-1 py-0.5 bg-slate-700 rounded text-caption">⌘G</kbd> Open diff viewer for reviews</li>
                        </ul>
                    </div>
                    <div className="text-body">
                        <strong className="text-slate-200">Project Control:</strong>
                        <ul className="list-disc pl-6 mt-1 space-y-1">
                            <li><kbd className="px-1 py-0.5 bg-slate-700 rounded text-caption">⌘←</kbd> Switch to previous project</li>
                            <li><kbd className="px-1 py-0.5 bg-slate-700 rounded text-caption">⌘→</kbd> Switch to next project</li>
                        </ul>
                    </div>
                    <div className="text-body">
                        <strong className="text-slate-200">Session Actions:</strong>
                        <ul className="list-disc pl-6 mt-1 space-y-1">
                            <li><kbd className="px-1 py-0.5 bg-slate-700 rounded text-caption">⌘D</kbd> Cancel session</li>
                            <li><kbd className="px-1 py-0.5 bg-slate-700 rounded text-caption">⌘R</kbd> Mark ready for review</li>
                            <li><kbd className="px-1 py-0.5 bg-slate-700 rounded text-caption">⌘S</kbd> Convert session to spec</li>
                        </ul>
                    </div>
                </div>
                <p className="text-body text-slate-400">
                    The goal is minimal context switching - stay focused on your work while seamlessly managing multiple parallel agents.
                </p>
            </div>
        )
    },
    {
        title: "Action Buttons - Quick AI Commands",
        content: (
            <div>
                <p className="mb-4">
                    Action buttons provide instant access to common AI prompts. They appear in the terminal header for both orchestrator and session views.
                </p>
                <div className="bg-green-900/30 border border-green-700/50 rounded p-3 mb-4">
                    <div className="flex items-start gap-2">
                        <svg className="w-5 h-5 text-green-400 mt-0.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                        </svg>
                        <div>
                            <p className="text-green-200 text-body font-medium mb-2">
                                Streamline Your Workflow
                            </p>
                            <p className="text-green-300/80 text-body mb-2">
                                Default action buttons help you:
                            </p>
                            <ul className="text-caption text-green-300/70 space-y-1 list-disc list-inside">
                                <li><strong>Merge:</strong> Find and merge all reviewed agents to main branch</li>
                                <li><strong>PR:</strong> Create pull requests with comprehensive descriptions</li>
                                <li><strong>Test:</strong> Run tests and automatically fix failures</li>
                            </ul>
                        </div>
                    </div>
                </div>
                <div className="space-y-3 mb-4">
                    <div className="bg-slate-800/50 border border-slate-700 rounded p-3">
                        <h4 className="text-blue-400 font-medium mb-2">Customization</h4>
                        <p className="text-body text-slate-300 mb-2">
                            Configure up to 6 custom buttons in Settings → Action Buttons with prompts specific to your workflow:
                        </p>
                        <ul className="text-caption text-slate-400 space-y-1 list-disc list-inside mb-2">
                            <li>Define custom AI prompts for repetitive agents</li>
                            <li>Choose colors for visual organization</li>
                            <li>Use keyboard shortcuts F1-F6 for instant access</li>
                        </ul>
                        <div className="bg-slate-900/50 rounded p-2 mt-2">
                            <p className="text-caption text-slate-300 mb-1"><strong>Example custom prompts:</strong></p>
                            <ul className="text-caption text-slate-400 space-y-1 list-disc list-inside">
                                <li>"Find all reviewed agents with the Schaltwerk MCP, then squash and merge to main"</li>
                                <li>"Create a comprehensive PR description analyzing all changes and their impact"</li>
                                <li>"Run all tests, fix any failures, then prepare for deployment"</li>
                            </ul>
                        </div>
                    </div>
                </div>
                <div className="text-body text-slate-400">
                    <p className="mb-2">
                        <strong>Example uses:</strong> Code review prompts, refactoring commands, documentation generation, test writing, dependency updates
                    </p>
                    <p>
                        Access with <kbd className="px-1 py-0.5 bg-slate-700 rounded text-caption">F1-F6</kbd> • Configure in Settings (<kbd className="px-1 py-0.5 bg-slate-700 rounded text-caption">⌘,</kbd>)
                    </p>
                </div>
            </div>
        )
    },
    {
        title: "AI Agents",
        content: (
            <div>
                <p className="mb-4">
                    Schaltwerk supports multiple AI agents:
                </p>
                <div className="grid grid-cols-2 gap-3 mb-4">
                    <div className="bg-slate-800/50 border border-slate-700 rounded p-2">
                        <div className="text-blue-400 font-medium text-body">Claude</div>
                        <div className="text-caption text-slate-400">Anthropic's AI assistant</div>
                    </div>
                    <div className="bg-slate-800/50 border border-slate-700 rounded p-2">
                        <div className="text-purple-400 font-medium text-body">Cursor</div>
                        <div className="text-caption text-slate-400">AI code editor agent</div>
                    </div>
                    <div className="bg-slate-800/50 border border-slate-700 rounded p-2">
                        <div className="text-green-400 font-medium text-body">OpenCode</div>
                        <div className="text-caption text-slate-400">Open-source coding AI</div>
                    </div>
                    <div className="bg-slate-800/50 border border-slate-700 rounded p-2">
                        <div className="text-emerald-400 font-medium text-body">Gemini</div>
                        <div className="text-caption text-slate-400">Google's AI assistant</div>
                    </div>
                    <div className="bg-slate-800/50 border border-slate-700 rounded p-2">
                        <div className="text-orange-400 font-medium text-body">Codex</div>
                        <div className="text-caption text-slate-400">OpenAI Codex agent</div>
                    </div>
                </div>
                <div className="bg-red-900/30 border border-red-700/50 rounded p-3">
                    <div className="flex items-start gap-2">
                        <svg className="w-5 h-5 text-red-400 mt-0.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.99-.833-2.76 0L4.054 15.5c-.77.833.192 2.5 1.732 2.5z" />
                        </svg>
                        <div>
                            <p className="text-red-200 text-body">
                                <strong>Installation Required:</strong> Agents and shells must be installed on your system before you can use them.
                            </p>
                            <p className="text-red-300/80 text-body mt-1">
                                Uninstalled agents will appear grayed out in the agent selector. Unavailable shells will be grayed out in terminal settings. Check Settings → Agent Configuration for installation guides.
                            </p>
                        </div>
                    </div>
                </div>
            </div>
        )
    },
    {
        title: "Code Review & Agent Management",
        content: (
            <div>
                <p className="mb-4">
                    The right panel adapts to your workflow, showing agents during development and changes during review:
                </p>
                <div className="space-y-3 mb-4">
                    <div className="bg-slate-800/50 border border-slate-700 rounded p-3">
                        <h4 className="text-green-400 font-medium mb-2">Agents Tab - Your Testing Checklist</h4>
                        <p className="text-body text-slate-300 mb-2">
                            When running tests via terminal, the Agents tab keeps your test checklist visible as a reminder of what needs validation.
                        </p>
                        <p className="text-body text-slate-300">
                            Perfect for tracking progress during manual testing and verification.
                        </p>
                    </div>
                    <div className="bg-slate-800/50 border border-slate-700 rounded p-3">
                        <h4 className="text-blue-400 font-medium mb-2">Changes Tab - AI Code Review</h4>
                        <p className="text-body text-slate-300 mb-2">
                            Review AI-generated changes with the diff viewer (<kbd className="px-1 py-0.5 bg-slate-700 rounded text-caption">⌘G</kbd>).
                        </p>
                        <p className="text-body text-slate-300">
                            Add comments directly on code changes - when you finish the review, all comments and their corresponding files are automatically pasted into the AI session's chat for fixes.
                        </p>
                    </div>
                </div>
                <div className="bg-blue-900/30 border border-blue-700/50 rounded p-3">
                    <p className="text-blue-200 text-body">
                        <strong>Review workflow:</strong> Open diff → Add comments → Finish review → Comments sent to AI → AI addresses feedback
                    </p>
                </div>
            </div>
        ),
        highlight: 'section',
        action: 'highlight'
    },
    {
        title: "You're Ready!",
        content: (
            <div>
                <p className="mb-4">
                    You now know the basics of using Schaltwerk! Here's a quick recap:
                </p>
                <div className="bg-slate-800/50 border border-slate-700 rounded p-4 mb-4">
                    <div className="grid grid-cols-2 gap-4 text-body">
                        <div>
                            <h4 className="text-slate-200 font-medium mb-2">Getting Started</h4>
                            <ul className="space-y-1 text-slate-400">
                                <li>• Start agents with <kbd className="px-1 py-0.5 bg-slate-700 rounded text-caption">⌘N</kbd> or specs with <kbd className="px-1 py-0.5 bg-slate-700 rounded text-caption">⇧⌘N</kbd></li>
                                <li>• Switch agents instantly with <kbd className="px-1 py-0.5 bg-slate-700 rounded text-caption">⌘↑/↓</kbd></li>
                                <li>• Focus panels with <kbd className="px-1 py-0.5 bg-slate-700 rounded text-caption">⌘T</kbd> (agent) or <kbd className="px-1 py-0.5 bg-slate-700 rounded text-caption">⌘/</kbd> (terminal)</li>
                                <li>• Use action buttons <kbd className="px-1 py-0.5 bg-slate-700 rounded text-caption">F1-F6</kbd> for AI prompts</li>
                            </ul>
                        </div>
                        <div>
                            <h4 className="text-slate-200 font-medium mb-2">Advanced Workflow</h4>
                            <ul className="space-y-1 text-slate-400">
                                <li>• Review with <kbd className="px-1 py-0.5 bg-slate-700 rounded text-caption">⌘G</kbd> and add comments</li>
                                <li>• Use orchestrator for natural language control</li>
                                <li>• Manage parallel agents efficiently</li>
                                <li>• Customize action buttons for your workflow</li>
                            </ul>
                        </div>
                    </div>
                </div>
                <div className="bg-blue-900/30 border border-blue-700/50 rounded p-3">
                    <p className="text-blue-200 text-body">
                        <strong>Tip:</strong> Open Settings (<kbd className="px-1 py-0.5 bg-slate-700 rounded text-caption">⌘,</kbd>) to configure AI agents, keyboard shortcuts, and terminal preferences.
                    </p>
                </div>
            </div>
        )
    }
]
