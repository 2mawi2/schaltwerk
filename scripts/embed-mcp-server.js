#!/usr/bin/env node
import { cp, mkdir, rm, stat } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

const projectRoot = process.cwd()
const sourceRoot = path.join(projectRoot, 'mcp-server')
const sources = [
  { from: path.join(sourceRoot, 'build'), to: path.join('mcp-server', 'build') },
  { from: path.join(sourceRoot, 'package.json'), to: path.join('mcp-server', 'package.json') },
  { from: path.join(sourceRoot, 'node_modules'), to: path.join('mcp-server', 'node_modules') }
]
const destinationRoot = path.join(projectRoot, 'src-tauri', 'resources')

async function ensurePathExists(target) {
  try {
    await stat(target)
  } catch {
    throw new Error(`Required MCP asset not found: ${target}. Build the MCP server first.`)
  }
}

async function main() {
  await Promise.all(sources.map((entry) => ensurePathExists(entry.from)))
  await rm(path.join(destinationRoot, 'mcp-server'), { recursive: true, force: true })
  await mkdir(path.join(destinationRoot, 'mcp-server'), { recursive: true })

  for (const { from, to } of sources) {
    const destination = path.join(destinationRoot, to)
    await mkdir(path.dirname(destination), { recursive: true })
    await cp(from, destination, { recursive: true })
  }

  process.stdout.write('Embedded MCP server assets into src-tauri/resources/mcp-server\n')
}

function handleFatalError(err) {
  const message = err instanceof Error ? err.message : String(err)
  process.stderr.write(`${message}\n`)
  process.exit(1)
}

main().catch(handleFatalError)
