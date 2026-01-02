#!/usr/bin/env node
/**
 * Codemod script to migrate theme.colors.* usages to CSS variables.
 *
 * Usage: node scripts/migrate-theme-colors.js [--dry-run]
 *
 * Transforms:
 *   theme.colors.text.primary → 'var(--color-text-primary)'
 *   theme.colors.background.secondary → 'var(--color-bg-secondary)'
 *   theme.colors.accent.blue.DEFAULT → 'var(--color-accent-blue)'
 *   theme.colors.accent.blue.light → 'var(--color-accent-blue-light)'
 */

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const DRY_RUN = process.argv.includes('--dry-run')

// Mapping from theme.colors paths to CSS variable names
const COLOR_MAPPINGS = {
  // Background
  'theme.colors.background.primary': 'var(--color-bg-primary)',
  'theme.colors.background.secondary': 'var(--color-bg-secondary)',
  'theme.colors.background.tertiary': 'var(--color-bg-tertiary)',
  'theme.colors.background.elevated': 'var(--color-bg-elevated)',
  'theme.colors.background.hover': 'var(--color-bg-hover)',
  'theme.colors.background.active': 'var(--color-bg-active)',

  // Text
  'theme.colors.text.primary': 'var(--color-text-primary)',
  'theme.colors.text.secondary': 'var(--color-text-secondary)',
  'theme.colors.text.tertiary': 'var(--color-text-tertiary)',
  'theme.colors.text.muted': 'var(--color-text-muted)',
  'theme.colors.text.inverse': 'var(--color-text-inverse)',

  // Border
  'theme.colors.border.default': 'var(--color-border-default)',
  'theme.colors.border.subtle': 'var(--color-border-subtle)',
  'theme.colors.border.strong': 'var(--color-border-strong)',
  'theme.colors.border.focus': 'var(--color-border-focus)',

  // Accent colors - Blue
  'theme.colors.accent.blue.DEFAULT': 'var(--color-accent-blue)',
  'theme.colors.accent.blue.light': 'var(--color-accent-blue-light)',
  'theme.colors.accent.blue.dark': 'var(--color-accent-blue-dark)',
  'theme.colors.accent.blue.bg': 'var(--color-accent-blue-bg)',
  'theme.colors.accent.blue.border': 'var(--color-accent-blue-border)',

  // Accent colors - Green
  'theme.colors.accent.green.DEFAULT': 'var(--color-accent-green)',
  'theme.colors.accent.green.light': 'var(--color-accent-green-light)',
  'theme.colors.accent.green.dark': 'var(--color-accent-green-dark)',
  'theme.colors.accent.green.bg': 'var(--color-accent-green-bg)',
  'theme.colors.accent.green.border': 'var(--color-accent-green-border)',

  // Accent colors - Amber
  'theme.colors.accent.amber.DEFAULT': 'var(--color-accent-amber)',
  'theme.colors.accent.amber.light': 'var(--color-accent-amber-light)',
  'theme.colors.accent.amber.dark': 'var(--color-accent-amber-dark)',
  'theme.colors.accent.amber.bg': 'var(--color-accent-amber-bg)',
  'theme.colors.accent.amber.border': 'var(--color-accent-amber-border)',

  // Accent colors - Red
  'theme.colors.accent.red.DEFAULT': 'var(--color-accent-red)',
  'theme.colors.accent.red.light': 'var(--color-accent-red-light)',
  'theme.colors.accent.red.dark': 'var(--color-accent-red-dark)',
  'theme.colors.accent.red.bg': 'var(--color-accent-red-bg)',
  'theme.colors.accent.red.border': 'var(--color-accent-red-border)',

  // Accent colors - Violet
  'theme.colors.accent.violet.DEFAULT': 'var(--color-accent-violet)',
  'theme.colors.accent.violet.light': 'var(--color-accent-violet-light)',
  'theme.colors.accent.violet.dark': 'var(--color-accent-violet-dark)',
  'theme.colors.accent.violet.bg': 'var(--color-accent-violet-bg)',
  'theme.colors.accent.violet.border': 'var(--color-accent-violet-border)',

  // Accent colors - Purple
  'theme.colors.accent.purple.DEFAULT': 'var(--color-accent-purple)',
  'theme.colors.accent.purple.light': 'var(--color-accent-purple-light)',
  'theme.colors.accent.purple.dark': 'var(--color-accent-purple-dark)',
  'theme.colors.accent.purple.bg': 'var(--color-accent-purple-bg)',
  'theme.colors.accent.purple.border': 'var(--color-accent-purple-border)',

  // Accent colors - Magenta
  'theme.colors.accent.magenta.DEFAULT': 'var(--color-accent-magenta)',
  'theme.colors.accent.magenta.light': 'var(--color-accent-magenta-light)',
  'theme.colors.accent.magenta.dark': 'var(--color-accent-magenta-dark)',
  'theme.colors.accent.magenta.bg': 'var(--color-accent-magenta-bg)',
  'theme.colors.accent.magenta.border': 'var(--color-accent-magenta-border)',

  // Accent colors - Yellow
  'theme.colors.accent.yellow.DEFAULT': 'var(--color-accent-yellow)',
  'theme.colors.accent.yellow.light': 'var(--color-accent-yellow-light)',
  'theme.colors.accent.yellow.dark': 'var(--color-accent-yellow-dark)',
  'theme.colors.accent.yellow.bg': 'var(--color-accent-yellow-bg)',
  'theme.colors.accent.yellow.border': 'var(--color-accent-yellow-border)',

  // Accent colors - Cyan
  'theme.colors.accent.cyan.DEFAULT': 'var(--color-accent-cyan)',
  'theme.colors.accent.cyan.light': 'var(--color-accent-cyan-light)',
  'theme.colors.accent.cyan.dark': 'var(--color-accent-cyan-dark)',
  'theme.colors.accent.cyan.bg': 'var(--color-accent-cyan-bg)',
  'theme.colors.accent.cyan.border': 'var(--color-accent-cyan-border)',

  // Accent colors - Copilot
  'theme.colors.accent.copilot.DEFAULT': 'var(--color-accent-copilot)',
  'theme.colors.accent.copilot.light': 'var(--color-accent-copilot-light)',
  'theme.colors.accent.copilot.dark': 'var(--color-accent-copilot-dark)',
  'theme.colors.accent.copilot.bg': 'var(--color-accent-copilot-bg)',
  'theme.colors.accent.copilot.border': 'var(--color-accent-copilot-border)',

  // Status
  'theme.colors.status.info': 'var(--color-status-info)',
  'theme.colors.status.success': 'var(--color-status-success)',
  'theme.colors.status.warning': 'var(--color-status-warning)',
  'theme.colors.status.error': 'var(--color-status-error)',

  // Diff
  'theme.colors.diff.addedBg': 'var(--color-diff-added-bg)',
  'theme.colors.diff.addedText': 'var(--color-diff-added-text)',
  'theme.colors.diff.removedBg': 'var(--color-diff-removed-bg)',
  'theme.colors.diff.removedText': 'var(--color-diff-removed-text)',
  'theme.colors.diff.modifiedBg': 'var(--color-diff-modified-bg)',
  'theme.colors.diff.modifiedText': 'var(--color-diff-modified-text)',

  // Scrollbar
  'theme.colors.scrollbar.track': 'var(--color-scrollbar-track)',
  'theme.colors.scrollbar.thumb': 'var(--color-scrollbar-thumb)',
  'theme.colors.scrollbar.thumbHover': 'var(--color-scrollbar-thumb-hover)',

  // Selection
  'theme.colors.selection.bg': 'var(--color-selection-bg)',

  // Overlay
  'theme.colors.overlay.backdrop': 'var(--color-overlay-backdrop)',
  'theme.colors.overlay.light': 'var(--color-overlay-light)',
  'theme.colors.overlay.dark': 'var(--color-overlay-dark)',
  'theme.colors.overlay.strong': 'var(--color-overlay-strong)',

  // Surface
  'theme.colors.surface.modal': 'var(--color-surface-modal)',

  // Editor
  'theme.colors.editor.background': 'var(--color-editor-background)',
  'theme.colors.editor.text': 'var(--color-editor-text)',
  'theme.colors.editor.caret': 'var(--color-editor-caret)',
  'theme.colors.editor.gutterText': 'var(--color-editor-gutter-text)',
  'theme.colors.editor.gutterActiveText': 'var(--color-editor-gutter-active-text)',
  'theme.colors.editor.activeLine': 'var(--color-editor-active-line)',
  'theme.colors.editor.inlineCodeBg': 'var(--color-editor-inline-code-bg)',
  'theme.colors.editor.codeBlockBg': 'var(--color-editor-code-block-bg)',
  'theme.colors.editor.blockquoteBorder': 'var(--color-editor-blockquote-border)',
  'theme.colors.editor.lineRule': 'var(--color-editor-line-rule)',
  'theme.colors.editor.strikethrough': 'var(--color-editor-strikethrough)',
  'theme.colors.editor.selection': 'var(--color-editor-selection)',
  'theme.colors.editor.focusedSelection': 'var(--color-editor-selection-focused)',
  'theme.colors.editor.selectionAlt': 'var(--color-editor-selection-alt)',

  // Syntax
  'theme.colors.syntax.default': 'var(--color-syntax-default)',
  'theme.colors.syntax.comment': 'var(--color-syntax-comment)',
  'theme.colors.syntax.variable': 'var(--color-syntax-variable)',
  'theme.colors.syntax.number': 'var(--color-syntax-number)',
  'theme.colors.syntax.type': 'var(--color-syntax-type)',
  'theme.colors.syntax.keyword': 'var(--color-syntax-keyword)',
  'theme.colors.syntax.string': 'var(--color-syntax-string)',
  'theme.colors.syntax.function': 'var(--color-syntax-function)',
  'theme.colors.syntax.operator': 'var(--color-syntax-operator)',
  'theme.colors.syntax.punctuation': 'var(--color-syntax-punctuation)',
  'theme.colors.syntax.tag': 'var(--color-syntax-tag)',
  'theme.colors.syntax.attribute': 'var(--color-syntax-attribute)',
  'theme.colors.syntax.selector': 'var(--color-syntax-selector)',
  'theme.colors.syntax.property': 'var(--color-syntax-property)',
  'theme.colors.syntax.bracket': 'var(--color-syntax-bracket)',
  'theme.colors.syntax.constant': 'var(--color-syntax-constant)',
  'theme.colors.syntax.decorator': 'var(--color-syntax-decorator)',
  'theme.colors.syntax.regex': 'var(--color-syntax-regex)',
  'theme.colors.syntax.escape': 'var(--color-syntax-escape)',
  'theme.colors.syntax.emphasis': 'var(--color-syntax-emphasis)',
  'theme.colors.syntax.highlight': 'var(--color-syntax-highlight)',

  // Tabs
  'theme.colors.tabs.inactive.bg': 'var(--color-tab-inactive-bg)',
  'theme.colors.tabs.inactive.text': 'var(--color-tab-inactive-text)',
  'theme.colors.tabs.inactive.hoverBg': 'var(--color-tab-inactive-hover-bg)',
  'theme.colors.tabs.inactive.hoverText': 'var(--color-tab-inactive-hover-text)',
  'theme.colors.tabs.active.bg': 'var(--color-tab-active-bg)',
  'theme.colors.tabs.active.text': 'var(--color-tab-active-text)',
  'theme.colors.tabs.active.indicator': 'var(--color-tab-active-indicator)',
  'theme.colors.tabs.close.bg': 'var(--color-tab-close-bg)',
  'theme.colors.tabs.close.hoverBg': 'var(--color-tab-close-hover-bg)',
  'theme.colors.tabs.close.color': 'var(--color-tab-close-color)',
  'theme.colors.tabs.close.hoverColor': 'var(--color-tab-close-hover-color)',
  'theme.colors.tabs.badge.bg': 'var(--color-tab-badge-bg)',
  'theme.colors.tabs.badge.text': 'var(--color-tab-badge-text)',
  'theme.colors.tabs.running.indicator': 'var(--color-tab-running-indicator)',
  'theme.colors.tabs.running.glow': 'var(--color-tab-running-glow)',
}

function getAllTsxFiles(dir, files = []) {
  const entries = fs.readdirSync(dir, { withFileTypes: true })

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules') {
      getAllTsxFiles(fullPath, files)
    } else if (entry.isFile() && (entry.name.endsWith('.tsx') || entry.name.endsWith('.ts'))) {
      files.push(fullPath)
    }
  }

  return files
}

function migrateFile(filePath) {
  let content = fs.readFileSync(filePath, 'utf8')
  let originalContent = content
  let changeCount = 0

  // Sort mappings by length (longest first) to avoid partial replacements
  const sortedMappings = Object.entries(COLOR_MAPPINGS).sort((a, b) => b[0].length - a[0].length)

  for (const [themeColor, cssVar] of sortedMappings) {
    // Match theme.colors.* when used as a value (not just referenced)
    // This regex looks for the pattern in style contexts
    const regex = new RegExp(themeColor.replace(/\./g, '\\.'), 'g')
    const matches = content.match(regex)

    if (matches) {
      changeCount += matches.length
      content = content.replace(regex, `'${cssVar}'`)
    }
  }

  if (changeCount > 0 && content !== originalContent) {
    if (DRY_RUN) {
      console.log(`[DRY RUN] Would update ${filePath} (${changeCount} changes)`)
    } else {
      fs.writeFileSync(filePath, content, 'utf8')
      console.log(`Updated ${filePath} (${changeCount} changes)`)
    }
    return changeCount
  }

  return 0
}

function main() {
  const srcDir = path.resolve(__dirname, '..', 'src')

  console.log(DRY_RUN ? '=== DRY RUN MODE ===' : '=== MIGRATION MODE ===')
  console.log(`Scanning ${srcDir}...\n`)

  const files = getAllTsxFiles(srcDir)
  let totalChanges = 0
  let filesChanged = 0

  for (const file of files) {
    const changes = migrateFile(file)
    if (changes > 0) {
      totalChanges += changes
      filesChanged++
    }
  }

  console.log(`\n=== Summary ===`)
  console.log(`Files scanned: ${files.length}`)
  console.log(`Files ${DRY_RUN ? 'would be ' : ''}changed: ${filesChanged}`)
  console.log(`Total replacements: ${totalChanges}`)

  if (DRY_RUN) {
    console.log(`\nRun without --dry-run to apply changes.`)
  }
}

main()
