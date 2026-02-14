import { describe, expect, it } from 'bun:test'
import Ajv from 'ajv'
let addFormats: ((ajv: Ajv) => void)
try {
  // Prefer installed package; fall back to no-op when unavailable (CI cache miss)
  addFormats = (await import('ajv-formats')).default
} catch {
  addFormats = () => {}
}
import { toolOutputSchemas } from '../src/schemas'

const ajv = new Ajv({ strict: true, allErrors: true, validateSchema: false })
addFormats(ajv)

const sampleStructuredOutputs: Record<string, any> = {
  schaltwerk_create: {
    type: 'session',
    status: 'created',
    session: {
      name: 'alpha',
      branch: 'schaltwerk/alpha',
      worktree_path: '/tmp/project/.schaltwerk/worktrees/alpha',
      parent_branch: 'main',
      agent_type: 'claude',
      ready_to_merge: false,
    },
  },
  schaltwerk_list: {
    sessions: [
      {
        name: 'alpha',
        display_name: 'Alpha',
        status: 'spec',
        session_state: 'Spec',
        ready_to_merge: false,
        created_at: '2024-05-01T00:00:00Z',
        last_activity: null,
        agent_type: 'claude',
        branch: 'schaltwerk/alpha',
        worktree_path: null,
        initial_prompt: 'Initial work',
        draft_content: '# Plan',
      },
    ],
  },
  schaltwerk_send_message: {
    session: 'alpha',
    status: 'sent',
    message: 'ping',
  },
  schaltwerk_cancel: {
    session: 'alpha',
    cancelled: true,
    force: false,
  },
  schaltwerk_get_setup_script: {
    setup_script: '#!/bin/bash\necho boot',
    has_setup_script: true,
  },
  schaltwerk_set_setup_script: {
    setup_script: '#!/bin/bash\necho updated',
    has_setup_script: true,
  },
  schaltwerk_spec_create: {
    type: 'spec',
    status: 'created',
    session: {
      name: 'alpha_spec',
      branch: 'schaltwerk/alpha_spec',
      parent_branch: 'main',
      content_length: 128,
    },
  },
  schaltwerk_draft_update: {
    session: 'alpha_spec',
    updated: true,
    append: false,
    content_length: 256,
    content_preview: '# Updated plan',
  },
  schaltwerk_current_spec_update: {
    status: 'updated',
    session: 'alpha_spec',
    updated: true,
    append: true,
    content_length: 42,
    content_preview: '# delta',
  },
  schaltwerk_spec_list: {
    specs: [
      {
        session_id: 'alpha_spec',
        display_name: 'Alpha Spec',
        content_length: 256,
        updated_at: '2024-05-01T12:00:00Z',
      },
    ],
  },
  schaltwerk_spec_read: {
    session_id: 'alpha_spec',
    display_name: 'Alpha Spec',
    content: '# Alpha',
    content_length: 7,
    updated_at: '2024-05-01T12:00:00Z',
  },
  schaltwerk_diff_summary: {
    scope: 'session',
    session_id: 'fiery_maxwell',
    branch_info: {
      current_branch: 'schaltwerk/fiery_maxwell',
      parent_branch: 'main',
      merge_base_short: 'abc1234',
      head_short: 'def5678',
    },
    has_spec: true,
    files: [{ path: 'src/app.ts', change_type: 'modified' }],
    paging: { next_cursor: null, total_files: 1, returned: 1 },
  },
  schaltwerk_diff_chunk: {
    file: { path: 'src/app.ts', change_type: 'modified' },
    branch_info: {
      current_branch: 'schaltwerk/fiery_maxwell',
      parent_branch: 'main',
      merge_base_short: 'abc1234',
      head_short: 'def5678',
    },
    stats: { additions: 10, deletions: 2 },
    is_binary: false,
    lines: [{ content: 'const a = 1;', line_type: 'added', new_line_number: 3 }],
    paging: { cursor: null, next_cursor: null, returned: 1 },
  },
  schaltwerk_session_spec: {
    session_id: 'fiery_maxwell',
    content: '# Spec',
    updated_at: '2024-05-01T12:34:56Z',
  },
  schaltwerk_draft_start: {
    session: 'alpha_spec',
    started: true,
    agent_type: 'claude',
    skip_permissions: false,
    base_branch: 'main',
  },
  schaltwerk_draft_list: {
    specs: [
      {
        name: 'alpha_spec',
        display_name: 'Alpha Spec',
        created_at: '2024-05-01T00:00:00Z',
        updated_at: '2024-05-02T00:00:00Z',
        base_branch: 'main',
        content_length: 5,
        content_preview: '# plan',
      },
    ],
  },
  schaltwerk_draft_delete: {
    session: 'alpha_spec',
    deleted: true,
  },
  schaltwerk_get_current_tasks: {
    tasks: [
      {
        name: 'alpha',
        display_name: 'Alpha',
        status: 'spec',
        session_state: 'Spec',
        branch: 'schaltwerk/alpha',
        ready_to_merge: false,
        agent_type: 'claude',
        initial_prompt: 'prompt',
        draft_content: 'content',
      },
    ],
  },
  schaltwerk_mark_session_reviewed: {
    session: 'alpha',
    reviewed: true,
  },
  schaltwerk_convert_to_spec: {
    session: 'alpha',
    converted: true,
  },
  schaltwerk_merge_session: {
    session: 'alpha',
    merged: true,
    mode: 'squash',
    parent_branch: 'main',
    session_branch: 'schaltwerk/alpha',
    commit: 'abc123',
    cancel_requested: false,
    cancel_queued: false,
    cancel_error: null,
  },
  schaltwerk_create_pr: {
    session: 'alpha',
    branch: 'schaltwerk/alpha',
    pr_url: 'https://example.com/pr/1',
    cancel_requested: false,
    cancel_queued: false,
    cancel_error: null,
  },
  schaltwerk_create_epic: {
    epic: {
      id: 'abc-123',
      name: 'auth-rewrite',
      color: '#FF5733',
    },
  },
  schaltwerk_list_epics: {
    epics: [
      {
        id: 'abc-123',
        name: 'auth-rewrite',
        color: '#FF5733',
      },
      {
        id: 'def-456',
        name: 'perf-improvements',
        color: null,
      },
    ],
  },
}

describe('MCP output schemas', () => {
  it('has schema coverage for every structured tool', () => {
    const schemaNames = Object.keys(toolOutputSchemas)
    const sampleNames = Object.keys(sampleStructuredOutputs)
    expect(schemaNames.sort()).toEqual(sampleNames.sort())
  })

  for (const [toolName, schema] of Object.entries(toolOutputSchemas)) {
    const sample = sampleStructuredOutputs[toolName]

    it(`accepts representative structured output for ${toolName}`, () => {
      const validate = ajv.compile(schema as any)
      const valid = validate(sample)
      expect({ valid, errors: validate.errors ?? [] }).toEqual({ valid: true, errors: [] })
    })
  }

  it('rejects an invalid diff chunk payload', () => {
    const schema = toolOutputSchemas.schaltwerk_diff_chunk as any
    const validate = ajv.compile(schema)
    const invalid = {
      stats: { additions: 1, deletions: 0 },
      is_binary: false,
      lines: [],
      paging: { cursor: null, next_cursor: null, returned: 0 },
    }

    expect(validate(invalid)).toBeFalse()
  })
})
