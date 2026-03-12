import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, writeFile, rm, mkdir } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import {
  readFileTool,
  writeFileTool,
  listDirectoryTool,
  searchFilesTool,
  fileInfoTool,
  filesystemTools,
} from '../../src/tools/filesystem.js'

describe('Filesystem Tools', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'neura-test-'))
    // Create test files
    await writeFile(join(tempDir, 'hello.txt'), 'Hello, world!\nLine 2\nLine 3')
    await writeFile(join(tempDir, 'data.json'), '{"key": "value"}')
    await mkdir(join(tempDir, 'subdir'))
    await writeFile(join(tempDir, 'subdir', 'nested.txt'), 'Nested content')
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  it('should export all 5 filesystem tools', () => {
    expect(filesystemTools.length).toBe(5)
    const names = filesystemTools.map((t) => t.name)
    expect(names).toContain('read_file')
    expect(names).toContain('write_file')
    expect(names).toContain('list_directory')
    expect(names).toContain('search_files')
    expect(names).toContain('file_info')
  })

  describe('read_file', () => {
    it('should read a file', async () => {
      const result = await readFileTool.execute({ path: join(tempDir, 'hello.txt') })
      expect(result.success).toBe(true)
      expect(result.output).toBe('Hello, world!\nLine 2\nLine 3')
    })

    it('should read with maxLines', async () => {
      const result = await readFileTool.execute({ path: join(tempDir, 'hello.txt'), maxLines: 2 })
      expect(result.success).toBe(true)
      expect(result.output).toContain('Hello, world!')
      expect(result.output).toContain('Line 2')
      expect(result.output).toContain('1 more lines')
    })

    it('should fail for nonexistent file', async () => {
      const result = await readFileTool.execute({ path: join(tempDir, 'nope.txt') })
      expect(result.success).toBe(false)
      expect(result.error).toBeTruthy()
    })
  })

  describe('write_file', () => {
    it('should write a new file', async () => {
      const result = await writeFileTool.execute({
        path: join(tempDir, 'new.txt'),
        content: 'New content',
      })
      expect(result.success).toBe(true)

      const readResult = await readFileTool.execute({ path: join(tempDir, 'new.txt') })
      expect(readResult.output).toBe('New content')
    })

    it('should append to a file', async () => {
      await writeFileTool.execute({
        path: join(tempDir, 'hello.txt'),
        content: '\nAppended',
        append: true,
      })

      const result = await readFileTool.execute({ path: join(tempDir, 'hello.txt') })
      expect(result.output).toContain('Appended')
      expect(result.output).toContain('Hello, world!')
    })
  })

  describe('list_directory', () => {
    it('should list directory contents', async () => {
      const result = await listDirectoryTool.execute({ path: tempDir })
      expect(result.success).toBe(true)
      const items = result.output as Array<{ name: string; type: string }>
      expect(items.length).toBe(3) // subdir, data.json, hello.txt
      expect(items[0].type).toBe('directory') // directories first
      expect(items[0].name).toBe('subdir')
    })
  })

  describe('search_files', () => {
    it('should find files by pattern', async () => {
      const result = await searchFilesTool.execute({ path: tempDir, pattern: '.txt' })
      expect(result.success).toBe(true)
      const matches = result.output as Array<{ name: string }>
      // hello.txt and subdir/nested.txt match ".txt"; data.json doesn't
      expect(matches.length).toBeGreaterThanOrEqual(2)
    })

    it('should respect maxResults', async () => {
      const result = await searchFilesTool.execute({ path: tempDir, pattern: '.', maxResults: 1 })
      expect(result.success).toBe(true)
      const matches = result.output as Array<{ name: string }>
      expect(matches.length).toBe(1)
    })
  })

  describe('file_info', () => {
    it('should return file info', async () => {
      const result = await fileInfoTool.execute({ path: join(tempDir, 'hello.txt') })
      expect(result.success).toBe(true)
      const info = result.output as Record<string, unknown>
      expect(info.name).toBe('hello.txt')
      expect(info.type).toBe('file')
      expect(info.extension).toBe('.txt')
      expect(info.size).toBeGreaterThan(0)
      expect(info.sizeHuman).toBeTruthy()
    })

    it('should return directory info', async () => {
      const result = await fileInfoTool.execute({ path: join(tempDir, 'subdir') })
      expect(result.success).toBe(true)
      const info = result.output as Record<string, unknown>
      expect(info.type).toBe('directory')
    })
  })
})
