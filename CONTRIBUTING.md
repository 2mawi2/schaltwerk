# Contributing to Schaltwerk

Thanks for your interest in helping build Schaltwerk! We appreciate contributions of all sizes—from filing issues and improving docs to landing features. The notes below explain how to get involved quickly while following the project’s quality bar.

## Ways to Contribute
- **Report bugs & share ideas**: Open an issue with clear reproduction steps or context. Feel free to propose enhancements or ask questions.
- **Help with existing work**: Check open issues labeled `help wanted` or `good first issue` and leave a comment before picking one up.
- **Improve the docs**: Our Mintlify docs power onboarding—PRs that clarify workflows, architecture, or troubleshooting are always welcome.

## Getting Started
1. Fork and clone the repository (macOS only).
2. Install dependencies with `npm install`.
3. Launch the desktop app locally with `npm run tauri:dev`.
4. Use the [docs](https://schaltwerk.mintlify.app) for architecture, session flow, and agent management details.

## Project Practices
Use the pointers below as a checklist—apply what fits your contribution so everything stays consistent.
- Create a branch for your change.
- Running `just test` before you push catches linting, Rust checks, tests, and build issues in one go.
- For UI updates, stick to the shared theme tokens (`theme.colors.*`, `theme.fontSize.*`) rather than hardcoded values.
- When touching backend/IPC code, use the enums in `src/common/tauriCommands.ts` and helpers in `src/common/eventSystem.ts` instead of string literals.
- Favor deterministic, event-driven patterns over timeouts or polling so behavior stays predictable.
- Log through the project logger with helpful context; avoid stray `console.log` statements.

## Submitting Changes
- Ensure `just test` passes locally and note any manual verification steps in your PR description.
- Reference related issues and explain the approach so reviewers understand the intent.
- Be ready to iterate based on feedback—small, well-scoped PRs get reviewed fastest.

## Need Help?
If you are unsure where to start, open a discussion or issue and tag the maintainers. We are happy to answer questions and help you move forward.

Welcome aboard, and thanks for helping Schaltwerk grow!
