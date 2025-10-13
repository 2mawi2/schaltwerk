#!/usr/bin/env node
/* eslint-env node */

const { console } = globalThis

import { spawnSync } from 'node:child_process'
import { env, exit, argv } from 'node:process'

const args = argv.slice(2)
if (args.length === 0) {
  console.error('Usage: node scripts/package-manager.mjs <action> [args…]')
  exit(1)
}

const action = args.shift()

const dashIndex = args.indexOf('--')
const primaryArgs = dashIndex === -1 ? args : args.slice(0, dashIndex)
const passthroughArgs = dashIndex === -1 ? [] : args.slice(dashIndex + 1)

function commandExists(command) {
  const result = spawnSync(command, ['--version'], { stdio: 'ignore' })
  return result.status === 0
}

function detectPackageManager() {
  const override = env.SCHALTWERK_PM?.trim()?.toLowerCase()
  if (override) {
    if (override === 'bun' || override === 'npm') return override
    console.error(`Unsupported package manager override: ${override}`)
    exit(1)
  }

  const ua = env.npm_config_user_agent || ''
  if (ua.startsWith('bun/')) return 'bun'
  if (ua.startsWith('npm/')) return 'npm'

  if (commandExists('bun')) return 'bun'
  if (commandExists('npm')) return 'npm'

  console.error('Neither bun nor npm found in PATH')
  exit(1)
}

const packageManager = detectPackageManager()

function toInstallCommand(flags) {
  const normalized = [...flags].filter(flag => flag !== '--frozen-lockfile')
  const hasFrozen = flags.includes('--frozen-lockfile')
  const hasProduction = normalized.includes('--production')
  const hasOmitDev = normalized.includes('--omit=dev')

  const filtered = normalized.filter(flag => flag !== '--production' && flag !== '--omit=dev')

  if (packageManager === 'bun') {
    const bunArgs = ['install', ...filtered]
    if (hasProduction || hasOmitDev) bunArgs.push('--production')
    if (hasFrozen) bunArgs.push('--frozen-lockfile')
    return { command: 'bun', commandArgs: bunArgs }
  }

  const npmArgs = [hasFrozen ? 'ci' : 'install', ...filtered]
  if (hasProduction || hasOmitDev) npmArgs.push('--omit=dev')
  return { command: 'npm', commandArgs: npmArgs }
}

function toRunCommand(flags, rest) {
  if (flags.length === 0) {
    console.error('Missing script name for run action')
    exit(1)
  }

  const [script, ...scriptArgs] = flags

  if (packageManager === 'bun') {
    return { command: 'bun', commandArgs: ['run', script, ...scriptArgs, ...rest] }
  }

  const commandArgs = ['run', script, ...scriptArgs]
  if (rest.length > 0) {
    commandArgs.push('--', ...rest)
  }
  return { command: 'npm', commandArgs }
}

function toExecCommand(flags, rest) {
  if (flags.length === 0) {
    console.error('Missing executable for exec action')
    exit(1)
  }

  if (packageManager === 'bun') {
    return { command: 'bunx', commandArgs: [...flags, ...rest] }
  }

  return { command: 'npx', commandArgs: [...flags, ...rest] }
}

function toCacheCleanCommand(flags) {
  if (packageManager === 'bun') {
    return { command: 'bun', commandArgs: ['pm', 'cache', 'rm', ...flags] }
  }
  return { command: 'npm', commandArgs: ['cache', 'clean', '--force', ...flags] }
}

let resolved

switch (action) {
  case 'install':
    resolved = toInstallCommand(primaryArgs)
    break
  case 'run':
    resolved = toRunCommand(primaryArgs, passthroughArgs)
    break
  case 'exec':
    resolved = toExecCommand(primaryArgs, passthroughArgs)
    break
  case 'cache-clean':
    resolved = toCacheCleanCommand(primaryArgs)
    break
  default:
    console.error(`Unknown action: ${action}`)
    exit(1)
}

const { command, commandArgs } = resolved
const result = spawnSync(command, commandArgs, { stdio: 'inherit', env })

if (result.error) {
  console.error(result.error.message)
  exit(1)
}

exit(result.status ?? 0)
