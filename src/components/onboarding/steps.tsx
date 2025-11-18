import React from 'react'
import { AgentBinaryStatus } from './AgentBinaryStatus'

export interface OnboardingStep {
    title: string
    content: React.ReactNode | ((props: {
        projectPath: string | null
    }) => React.ReactNode)
    highlight?: string
    action?: 'highlight' | 'overlay'
}

export const ONBOARDING_STEPS: OnboardingStep[] = [
    {
        title: 'Welcome to the Workflow',
        content: (
            <div>
                <p className="mb-4 text-slate-300">
                    This tutorial walks through the basics: write a spec, start a session, watch the agent work, check the results, then finish with a merge or pull request.
                </p>
                <ul className="list-disc list-inside space-y-2 text-slate-400">
                    <li>Specs describe the work before any files change.</li>
                    <li>Sessions work on their own branches so your main branch stays clean.</li>
                    <li>You always review and test before merging or opening a PR.</li>
                </ul>
            </div>
        )
    },
    {
        title: 'Check your agent CLIs',
        content: (
            <div>
                <p className="mb-4 text-slate-300">
                    Schaltwerk scans for agent command-line tools on your system. If any are missing, install them or set a custom path in Settings → Agent Configuration.
                </p>
                <AgentBinaryStatus />
            </div>
        ),
    },
    {
        title: 'Start in the Orchestrator',
        content: (
            <div>
                <p className="mb-3 text-slate-300">
                    The orchestrator sits on your main branch and holds every spec. Start here to get set up.
                </p>
                <ul className="list-disc list-inside space-y-1 text-slate-400">
                    <li>Select the orchestrator or press <kbd className="px-1 py-0.5 bg-slate-700 rounded text-caption">⌘1</kbd>.</li>
                    <li>Use the top terminal to explore the repo or jot ideas.</li>
                    <li>Anything you do here stays on the main branch.</li>
                </ul>
            </div>
        ),
        highlight: '[data-onboarding="orchestrator-entry"]',
        action: 'highlight'
    },
    {
        title: 'Open the Worktree Externally',
        content: (
            <div>
                <p className="mb-3 text-slate-300">
                    Need to use your own editor or terminal? The Open button in the top bar does exactly that.
                </p>
                <ul className="list-disc list-inside space-y-1 text-slate-400">
                    <li>Select a session and click <strong>Open</strong> to launch that worktree in your editor or terminal.</li>
                    <li>Select the orchestrator and you’ll open the main branch instead.</li>
                    <li>Use the arrow next to the button to pick a different app (VS Code, Finder, iTerm, and so on).</li>
                </ul>
            </div>
        ),
        highlight: '[data-onboarding="open-worktree-button"]',
        action: 'highlight'
    },
    {
        title: 'Draft a Spec Plan',
        content: (
            <div>
                <p className="mb-3 text-slate-300">
                    A spec spells out what you want before the agent starts typing.
                </p>
                <ul className="list-disc list-inside space-y-1 text-slate-400">
                    <li>Click <strong>Create Spec</strong> or press <kbd className="px-1 py-0.5 bg-slate-700 rounded text-caption">⌘⇧N</kbd>.</li>
                    <li>Write the goal, key notes, and what “done” looks like.</li>
                    <li>You can reopen the spec in the right panel at any time.</li>
                </ul>
            </div>
        ),
        highlight: '[data-onboarding="create-spec-button"]',
        action: 'highlight'
    },
    {
        title: 'Review the Spec Sidebar',
        content: (
            <div>
                <p className="mb-3 text-slate-300">
                    The Specs tab keeps your plans close while you work.
                </p>
                <ul className="list-disc list-inside space-y-1 text-slate-400">
                    <li>Open the Specs tab to reread a plan or start it as a session.</li>
                    <li>Convert a spec to a session once you’re ready to build.</li>
                    <li>Come back later to note follow-up tasks or decisions.</li>
                </ul>
            </div>
        ),
        highlight: '[data-onboarding="specs-workspace-tab"]',
        action: 'highlight'
    },
    {
        title: 'Launch from the Right Branch',
        content: (
            <div>
                <p className="mb-3 text-slate-300">
                    Sessions branch off whatever base branch you choose, so pick the one that matches your task.
                </p>
                <ul className="list-disc list-inside space-y-1 text-slate-400">
                    <li>Open the <strong>Start Agent</strong> dialog (<kbd className="px-1 py-0.5 bg-slate-700 rounded text-caption">⌘N</kbd>).</li>
                    <li>Choose <strong>main</strong> for new work, or pick an existing feature branch.</li>
                    <li>Each session gets its own worktree and branch so nothing collides.</li>
                </ul>
            </div>
        ),
        highlight: '[data-onboarding="start-agent-button"]',
        action: 'highlight'
    },
    {
        title: 'Watch the Agent Work',
        content: (
            <div>
                <p className="mb-3 text-slate-300">
                    The top terminal shows the agent’s terminal. Watch what it reads, edits, and runs.
                </p>
                <ul className="list-disc list-inside space-y-1 text-slate-400">
                    <li>Press <kbd className="px-1 py-0.5 bg-slate-700 rounded text-caption">⌘T</kbd> to focus the agent terminal.</li>
                    <li>Type instructions if you need the agent to adjust course.</li>
                    <li>The header shows which session you’re viewing.</li>
                </ul>
            </div>
        ),
        highlight: '[data-onboarding="agent-terminal"]',
        action: 'highlight'
    },
    {
        title: 'Test Your Changes',
        content: (
            <div>
                <p className="mb-3 text-slate-300">
                    The bottom terminal is your shell inside the same worktree as the agent.
                </p>
                <ul className="list-disc list-inside space-y-1 text-slate-400">
                    <li>Use <kbd className="px-1 py-0.5 bg-slate-700 rounded text-caption">⌘/</kbd> to focus the shell.</li>
                    <li>Run <code>bun run test</code> (or your project’s scripts) before marking reviewed.</li>
                    <li>Edit files or stage changes here — it’s the same worktree the agent uses.</li>
                    <li>Add extra tabs if you need multiple shell sessions.</li>
                </ul>
            </div>
        ),
        highlight: '[data-onboarding="user-terminal"]',
        action: 'highlight'
    },
    {
        title: 'Review Diffs and Comment',
        content: (
            <div>
                <p className="mb-3 text-slate-300">
                    The diff viewer shows every change and lets you write GitHub-style review comments to hand back to the agent.
                </p>
                <ul className="list-disc list-inside space-y-1 text-slate-400">
                    <li>Press <kbd className="px-1 py-0.5 bg-slate-700 rounded text-caption">⌘G</kbd> to open the diff viewer.</li>
                    <li>Draft inline comments just like GitHub and paste them into the agent terminal for follow-up fixes.</li>
                    <li>Search with <kbd className="px-1 py-0.5 bg-slate-700 rounded text-caption">⌘F</kbd> to jump through large changes.</li>
                </ul>
            </div>
        ),
        highlight: '[data-testid="diff-panel"]',
        action: 'highlight'
    },
    {
        title: 'Manage Sessions and Specs',
        content: (
            <div>
                <p className="mb-3 text-slate-300">
                    The sidebar filters keep specs, running sessions, and reviewed work easy to find.
                </p>
                <ul className="list-disc list-inside space-y-1 text-slate-400">
                    <li>Use the filter pills for <strong>Specs</strong>, <strong>Running</strong>, and <strong>Reviewed</strong>.</li>
                    <li>Cycle filters with <kbd className="px-1 py-0.5 bg-slate-700 rounded text-caption">⌘←</kbd> and <kbd className="px-1 py-0.5 bg-slate-700 rounded text-caption">⌘→</kbd>.</li>
                    <li>Move through the session list with <kbd className="px-1 py-0.5 bg-slate-700 rounded text-caption">⌘↑</kbd>/<kbd className="px-1 py-0.5 bg-slate-700 rounded text-caption">⌘↓</kbd> or jump straight to a slot with <kbd className="px-1 py-0.5 bg-slate-700 rounded text-caption">⌘2…⌘8</kbd>.</li>
                    <li>Specs stay available even after you convert them to sessions.</li>
                </ul>
            </div>
        ),
        highlight: '[data-onboarding="session-filter-row"]',
        action: 'highlight'
    },
    {
        title: 'Mark Sessions Reviewed',
        content: (
            <div>
                <p className="mb-3 text-slate-300">
                    Once the tests pass and the diff looks right, mark the session as reviewed.
                </p>
                <ul className="list-disc list-inside space-y-1 text-slate-400">
                    <li>Click the green check button or press <kbd className="px-1 py-0.5 bg-slate-700 rounded text-caption">⌘R</kbd>.</li>
                    <li>The session moves to the <strong>Reviewed</strong> filter and keeps its worktree so you can still make tweaks.</li>
                    <li>If the worktree is dirty you’ll see a warning before you merge.</li>
                </ul>
            </div>
        ),
        highlight: '[data-onboarding="session-actions"]',
        action: 'highlight'
    },
    {
        title: 'Merge or Open a PR',
        content: (
            <div>
                <p className="mb-3 text-slate-300">
                    Reviewed sessions have two finishes: merge locally or open a pull request.
                </p>
                <ul className="list-disc list-inside space-y-1 text-slate-400">
                    <li><strong>Merge:</strong> Apply the branch back to trunk immediately (<kbd className="px-1 py-0.5 bg-slate-700 rounded text-caption">⌘⇧M</kbd>).</li>
                    <li><strong>Pull Request:</strong> Push and open a PR in one step (<kbd className="px-1 py-0.5 bg-slate-700 rounded text-caption">⌘⇧P</kbd>).</li>
                    <li>Keep the session until you cancel it in case you need to rerun tests or adjust prompts.</li>
                </ul>
            </div>
        ),
        highlight: '[data-onboarding="session-actions"]',
        action: 'highlight'
    }
]
