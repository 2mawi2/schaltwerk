import { constants } from 'node:fs'
import {
  access,
  copyFile,
  mkdir,
  open,
  readdir,
  rm,
  stat,
} from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const buffersEqual = async (sourcePath, destinationPath, size) => {
  const sourceHandle = await open(sourcePath, 'r')
  const destinationHandle = await open(destinationPath, 'r')
  const chunkSize = Math.min(64 * 1024, Math.max(size, 1))
  const sourceBuffer = Buffer.allocUnsafe(chunkSize)
  const destinationBuffer = Buffer.allocUnsafe(chunkSize)

  try {
    let offset = 0
    while (offset < size) {
      const length = Math.min(chunkSize, size - offset)
      const [sourceRead, destinationRead] = await Promise.all([
        sourceHandle.read(sourceBuffer, 0, length, offset),
        destinationHandle.read(destinationBuffer, 0, length, offset),
      ])

      if (
        sourceRead.bytesRead !== destinationRead.bytesRead ||
        !sourceBuffer.subarray(0, length).equals(destinationBuffer.subarray(0, length))
      ) {
        return false
      }
      offset += length
    }
    return true
  } finally {
    await Promise.all([sourceHandle.close(), destinationHandle.close()])
  }
}

const filesMatch = async (sourcePath, destinationPath, sourceStats) => {
  try {
    const destinationStats = await stat(destinationPath)
    return (
      destinationStats.isFile() &&
      destinationStats.size === sourceStats.size &&
      await buffersEqual(sourcePath, destinationPath, sourceStats.size)
    )
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return false
    }
    throw error
  }
}

const syncDirectory = async (sourceDirectory, destinationDirectory) => {
  await mkdir(destinationDirectory, { recursive: true })
  const [sourceEntries, destinationEntries] = await Promise.all([
    readdir(sourceDirectory, { withFileTypes: true }),
    readdir(destinationDirectory, { withFileTypes: true }),
  ])
  const sourceNames = new Set(sourceEntries.map(entry => entry.name))

  await Promise.all(destinationEntries
    .filter(entry => !sourceNames.has(entry.name))
    .map(entry => rm(path.join(destinationDirectory, entry.name), { recursive: true })))

  await Promise.all(sourceEntries.map(async entry => {
    const sourcePath = path.join(sourceDirectory, entry.name)
    const destinationPath = path.join(destinationDirectory, entry.name)

    if (entry.isDirectory()) {
      const destinationStats = await stat(destinationPath).catch(error => {
        if (error?.code === 'ENOENT') return null
        throw error
      })
      if (destinationStats && !destinationStats.isDirectory()) {
        await rm(destinationPath, { recursive: true })
      }
      await syncDirectory(sourcePath, destinationPath)
      return
    }

    if (!entry.isFile()) {
      throw new Error(`Unsupported build output entry: ${sourcePath}`)
    }

    const sourceStats = await stat(sourcePath)
    const destinationStats = await stat(destinationPath).catch(error => {
      if (error?.code === 'ENOENT') return null
      throw error
    })
    if (destinationStats && !destinationStats.isFile()) {
      await rm(destinationPath, { recursive: true })
    }
    if (!await filesMatch(sourcePath, destinationPath, sourceStats)) {
      await copyFile(sourcePath, destinationPath)
    }
  }))
}

export const syncBuildOutput = async (sourceArgument, destinationArgument) => {
  if (!sourceArgument || !destinationArgument) {
    throw new Error('Source and destination directories are required')
  }

  const sourceRoot = path.resolve(sourceArgument)
  const destinationRoot = path.resolve(destinationArgument)
  const filesystemRoot = path.parse(destinationRoot).root

  if (sourceRoot === destinationRoot || destinationRoot === filesystemRoot) {
    throw new Error('Source and destination must be distinct, non-root directories')
  }

  await access(sourceRoot, constants.R_OK)
  await mkdir(destinationRoot, { recursive: true })
  await syncDirectory(sourceRoot, destinationRoot)
}

const isCommandLine =
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (isCommandLine) {
  const [, , sourceArgument, destinationArgument] = process.argv
  if (!sourceArgument || !destinationArgument) {
    throw new Error('Usage: sync-build-output.js <source-directory> <destination-directory>')
  }
  await syncBuildOutput(sourceArgument, destinationArgument)
}
