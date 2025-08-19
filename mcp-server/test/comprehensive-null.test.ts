const formatListJson = (s: any) => ({
  name: s.name,
  display_name: s.display_name || s.name,
  status: s.status === 'draft' ? 'draft' : (s.ready_to_merge ? 'reviewed' : 'new'),
  state: s.session_state,
  created_at: s.created_at ? new Date(s.created_at).toISOString() : null,
  last_activity: s.last_activity ? new Date(s.last_activity).toISOString() : null,
  agent_type: s.original_agent_type || 'claude',
  branch: s.branch,
  worktree_path: s.worktree_path,
  initial_prompt: s.initial_prompt || null,
  draft_content: s.draft_content || null
})

const formatListText = (s: any) => {
  if (s.status === 'draft') {
    const created = s.created_at ? new Date(s.created_at).toLocaleDateString() : 'unknown'
    const contentLength = s.draft_content?.length || 0
    const name = s.display_name || s.name
    return `[DRAFT] ${name} - Created: ${created}, Content: ${contentLength} chars`
  } else {
    const reviewed = s.ready_to_merge ? '[REVIEWED]' : '[NEW]'
    const agent = s.original_agent_type || 'unknown'
    const modified = s.last_activity ? new Date(s.last_activity).toLocaleString() : 'never'
    const name = s.display_name || s.name
    return `${reviewed} ${name} - Agent: ${agent}, Modified: ${modified}`
  }
}

const formatDraftJson = (d: any) => ({
  name: d.name,
  display_name: d.display_name || d.name,
  created_at: d.created_at ? new Date(d.created_at).toISOString() : null,
  updated_at: d.updated_at ? new Date(d.updated_at).toISOString() : null,
  base_branch: d.parent_branch,
  content_length: d.draft_content?.length || 0,
  content_preview: d.draft_content?.substring(0, 200) || ''
})

const formatDraftText = (d: any) => {
  const name = d.display_name || d.name
  const created = d.created_at ? new Date(d.created_at).toLocaleDateString() : 'unknown'
  const updated = d.updated_at ? new Date(d.updated_at).toLocaleDateString() : 'unknown'
  const contentLength = d.draft_content?.length || 0
  const preview = d.draft_content?.substring(0, 50)?.replace(/\n/g, ' ') || '(empty)'
  
  return `${name}:
  - Created: ${created}, Updated: ${updated}
  - Content: ${contentLength} chars
  - Preview: ${preview}${contentLength > 50 ? '...' : ''}`
}

const formatTask = (t: any) => ({
  name: t.name,
  display_name: t.display_name || t.name,
  status: t.status,
  session_state: t.session_state,
  created_at: t.created_at ? new Date(t.created_at).toISOString() : null,
  last_activity: t.last_activity ? new Date(t.last_activity).toISOString() : null,
  initial_prompt: t.initial_prompt || null,
  draft_content: t.draft_content || null,
  ready_to_merge: t.ready_to_merge || false,
  branch: t.branch,
  worktree_path: t.worktree_path
})

const safeISOString = (value: any) => {
  if (value === null || value === undefined || typeof value !== 'number' || !isFinite(value)) {
    return null
  }
  try {
    const date = new Date(value)
    if (isNaN(date.getTime())) {
      return null
    }
    return date.toISOString()
  } catch {
    return null
  }
}

const validateSessionFormatting = (session: any) => {
  expect(() => formatListJson(session)).not.toThrow()
  expect(() => formatListText(session)).not.toThrow()
  
  const json = formatListJson(session)
  const text = formatListText(session)
  
  if (!session.created_at) {
    if (session.status === 'draft') {
      expect(text).toContain('Created: unknown')
    }
    expect(json.created_at).toBeNull()
  }
  
  if (!session.last_activity) {
    if (session.status !== 'draft') {
      expect(text).toContain('Modified: never')
    }
    expect(json.last_activity).toBeNull()
  }
}

const validateDraftFormatting = (draft: any) => {
  expect(() => formatDraftJson(draft)).not.toThrow()
  expect(() => formatDraftText(draft)).not.toThrow()
  
  const json = formatDraftJson(draft)
  const text = formatDraftText(draft)
  
  if (!draft.created_at) {
    expect(text).toContain('Created: unknown')
    expect(json.created_at).toBeNull()
  }
  
  if (!draft.updated_at) {
    expect(text).toContain('Updated: unknown')
    expect(json.updated_at).toBeNull()
  }
}

const validateTaskFormatting = (task: any) => {
  expect(() => formatTask(task)).not.toThrow()
  
  const result = formatTask(task)
  
  if (!task.created_at) {
    expect(result.created_at).toBeNull()
  } else if (task.created_at === 0) {
    expect(result.created_at).toBe('1970-01-01T00:00:00.000Z')
  }
  
  if (!task.last_activity) {
    expect(result.last_activity).toBeNull()
  } else if (task.last_activity === 0) {
    expect(result.last_activity).toBe('1970-01-01T00:00:00.000Z')
  }
}

const validateEdgeCase = (edgeCase: { value: any; expected: any }) => {
  const { value, expected } = edgeCase
  const result = safeISOString(value)
  
  if (typeof expected === 'string') {
    expect(result).toBe(expected)
  } else if (expected === null) {
    expect(result).toBeNull()
  } else {
    expect(result).toEqual(expected)
  }
}

describe('Comprehensive MCP Null Handling', () => {
  describe('All date fields across all commands', () => {
    it('should handle null/undefined dates in schaltwerk_list', () => {
      const testSessions = [
        { name: 'test1', status: 'active', created_at: null, last_activity: null },
        { name: 'test2', status: 'active', created_at: undefined, last_activity: undefined },
        { name: 'test3', status: 'draft', created_at: null, last_activity: null },
        { name: 'test4', status: 'draft', created_at: undefined, last_activity: undefined },
        { name: 'test5', status: 'active', created_at: Date.now(), last_activity: Date.now() },
      ]

      testSessions.forEach(validateSessionFormatting)
    })

    it('should handle null/undefined dates in schaltwerk_draft_list', () => {
      const testDrafts = [
        { name: 'draft1', created_at: null, updated_at: null },
        { name: 'draft2', created_at: undefined, updated_at: undefined },
        { name: 'draft3', created_at: Date.now(), updated_at: null },
        { name: 'draft4', created_at: null, updated_at: Date.now() },
        { name: 'draft5', created_at: Date.now(), updated_at: Date.now() },
      ]

      testDrafts.forEach(validateDraftFormatting)
    })

    it('should handle null/undefined dates in schaltwerk_get_current_tasks', () => {
      const testTasks = [
        { name: 'task1', status: 'active', created_at: null, last_activity: null },
        { name: 'task2', status: 'draft', created_at: undefined, last_activity: undefined },
        { name: 'task3', status: 'active', created_at: 0, last_activity: 0 },
        { name: 'task4', status: 'draft', created_at: Date.now(), last_activity: null },
        { name: 'task5', status: 'active', created_at: Date.now(), last_activity: Date.now() },
      ]

      testTasks.forEach(validateTaskFormatting)
    })

    it('should handle edge cases with malformed data', () => {
      const edgeCases = [
        { value: null, expected: null },
        { value: undefined, expected: null },
        { value: 0, expected: '1970-01-01T00:00:00.000Z' },
        { value: '', expected: null },
        { value: 'invalid', expected: null },
        { value: NaN, expected: null },
        { value: Infinity, expected: null },
        { value: -Infinity, expected: null },
        { value: {}, expected: null },
        { value: [], expected: null },
        { value: Date.now(), expected: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/) }
      ]

      edgeCases.forEach(validateEdgeCase)
    })
  })
})