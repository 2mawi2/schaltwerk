# Schaltwerk Documentation

Documentation website built with [Mintlify](https://mintlify.com).

## Local Development

```bash
cd docs-site
npm install
npm run dev
```

Opens at `http://localhost:3000` with hot reload.

## Deployment

Docs are hosted on **Mintlify Cloud** (free for open source).

**Setup:**
1. Connect GitHub repo at [mintlify.com](https://mintlify.com)
2. Configure repository settings:
   - Repository: `2mawi2/schaltwerk`
   - Branch: `main`
   - Path: `docs-site`
3. Docs auto-deploy on push to `main`

**Live URL:** `schaltwerk.mintlify.app` (or custom domain)

## File Structure

```
docs-site/
├── mint.json              # Mintlify configuration
├── package.json           # Dependencies
├── introduction.mdx       # Homepage
├── installation.mdx       # Installation guide
├── core-concepts.mdx      # Core concepts
├── guides/                # User guides
│   ├── using-schaltwerk.mdx
│   ├── agent-setup.mdx
│   └── keyboard-shortcuts.mdx
└── mcp/                   # MCP integration
    ├── integration.mdx
    └── prompting.mdx
```

## Theme Configuration

The docs use the **Quill** theme with Schaltwerk's cyan color scheme (#22d3ee) to match the app design. Colors are configured in `mint.json`.
