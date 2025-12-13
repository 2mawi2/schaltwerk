const draft2020 = 'https://json-schema.org/draft/2020-12/schema'

const isoDateTime = { type: 'string', format: 'date-time' } as const
const nullableIsoDateTime = { anyOf: [isoDateTime, { type: 'null' }] } as const
const nullableString = { type: ['string', 'null'] } as const
const nullableBoolean = { type: ['boolean', 'null'] } as const
const nullableNumber = { type: ['number', 'null'] } as const

const sessionSummarySchema = {
  type: 'object',
  properties: {
    name: { type: 'string' },
    display_name: { type: 'string' },
    status: { enum: ['spec', 'reviewed', 'new'] },
    session_state: nullableString,
    ready_to_merge: { type: 'boolean' },
    created_at: nullableIsoDateTime,
    last_activity: nullableIsoDateTime,
    agent_type: nullableString,
    branch: nullableString,
    worktree_path: nullableString,
    initial_prompt: nullableString,
    draft_content: nullableString,
  },
  required: ['name', 'status', 'ready_to_merge'],
  additionalProperties: false,
} as const

const taskSchema = {
  type: 'object',
  properties: {
    name: { type: 'string' },
    display_name: { type: 'string' },
    status: { type: 'string' },
    session_state: nullableString,
    created_at: nullableIsoDateTime,
    last_activity: nullableIsoDateTime,
    branch: nullableString,
    worktree_path: nullableString,
    ready_to_merge: nullableBoolean,
    agent_type: nullableString,
    skip_permissions: nullableBoolean,
    initial_prompt: nullableString,
    draft_content: nullableString,
  },
  required: ['name'],
  additionalProperties: false,
} as const

const specSummarySchema = {
  type: 'object',
  properties: {
    session_id: { type: 'string' },
    display_name: { type: 'string' },
    content_length: { type: 'number' },
    updated_at: isoDateTime,
  },
  required: ['session_id', 'content_length', 'updated_at'],
  additionalProperties: false,
} as const

const specDocumentSchema = {
  type: 'object',
  properties: {
    session_id: { type: 'string' },
    display_name: { type: 'string' },
    content: { type: 'string' },
    content_length: { type: 'number' },
    updated_at: isoDateTime,
  },
  required: ['session_id', 'content', 'content_length', 'updated_at'],
  additionalProperties: false,
} as const

const diffBranchInfoSchema = {
  type: 'object',
  properties: {
    current_branch: { type: 'string' },
    parent_branch: { type: 'string' },
    merge_base_short: { type: 'string' },
    head_short: { type: 'string' },
  },
  required: ['current_branch', 'parent_branch', 'merge_base_short', 'head_short'],
  additionalProperties: false,
} as const

const diffFileSchema = {
  type: 'object',
  properties: {
    path: { type: 'string' },
    change_type: { type: 'string' },
  },
  required: ['path', 'change_type'],
  additionalProperties: false,
} as const

const diffLineSchema = {
  type: 'object',
  properties: {
    content: { type: 'string' },
    line_type: { type: 'string' },
    old_line_number: { type: 'number' },
    new_line_number: { type: 'number' },
    is_collapsible: { type: 'boolean' },
    collapsed_count: { type: 'number' },
  },
  required: ['content', 'line_type'],
  additionalProperties: false,
} as const

export const toolOutputSchemas = {
  schaltwerk_create: {
    $schema: draft2020,
    type: 'object',
    properties: {
      type: { enum: ['session', 'spec'] },
      status: { const: 'created' },
      session: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          branch: { type: 'string' },
          worktree_path: nullableString,
          parent_branch: nullableString,
          agent_type: nullableString,
          ready_to_merge: nullableBoolean,
          content_length: nullableNumber,
        },
        required: ['name', 'branch'],
        additionalProperties: true,
      },
    },
    required: ['type', 'status', 'session'],
    additionalProperties: false,
  },

  schaltwerk_list: {
    $schema: draft2020,
    type: 'object',
    properties: {
      sessions: {
        type: 'array',
        items: sessionSummarySchema,
      },
    },
    required: ['sessions'],
    additionalProperties: false,
  },

  schaltwerk_send_message: {
    $schema: draft2020,
    type: 'object',
    properties: {
      session: { type: 'string' },
      status: { const: 'sent' },
      message: { type: 'string' },
    },
    required: ['session', 'status', 'message'],
    additionalProperties: false,
  },

  schaltwerk_cancel: {
    $schema: draft2020,
    type: 'object',
    properties: {
      session: { type: 'string' },
      cancelled: { type: 'boolean' },
      force: { type: 'boolean' },
    },
    required: ['session', 'cancelled'],
    additionalProperties: false,
  },

  schaltwerk_spec_create: {
    $schema: draft2020,
    type: 'object',
    properties: {
      type: { const: 'spec' },
      status: { const: 'created' },
      session: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          branch: { type: 'string' },
          parent_branch: nullableString,
          worktree_path: nullableString,
          content_length: nullableNumber,
        },
        required: ['name', 'branch'],
        additionalProperties: true,
      },
    },
    required: ['type', 'status', 'session'],
    additionalProperties: false,
  },

  schaltwerk_draft_update: {
    $schema: draft2020,
    type: 'object',
    properties: {
      session: { type: 'string' },
      updated: { type: 'boolean' },
      append: { type: 'boolean' },
      content_length: nullableNumber,
      content_preview: nullableString,
    },
    required: ['session', 'updated', 'append'],
    additionalProperties: false,
  },

  schaltwerk_current_spec_update: {
    $schema: draft2020,
    type: 'object',
    properties: {
      status: { type: 'string' },
      session: { type: 'string' },
      updated: { type: 'boolean' },
      append: { type: 'boolean' },
      content_length: nullableNumber,
      content_preview: nullableString,
    },
    additionalProperties: true,
  },

  schaltwerk_get_setup_script: {
    $schema: draft2020,
    type: 'object',
    properties: {
      setup_script: { type: 'string' },
      has_setup_script: { type: 'boolean' },
    },
    required: ['setup_script', 'has_setup_script'],
    additionalProperties: false,
  },

  schaltwerk_set_setup_script: {
    $schema: draft2020,
    type: 'object',
    properties: {
      setup_script: { type: 'string' },
      has_setup_script: { type: 'boolean' },
    },
    required: ['setup_script', 'has_setup_script'],
    additionalProperties: false,
  },

  schaltwerk_spec_list: {
    $schema: draft2020,
    type: 'object',
    properties: {
      specs: {
        type: 'array',
        items: specSummarySchema,
      },
    },
    required: ['specs'],
    additionalProperties: false,
  },

  schaltwerk_spec_read: {
    $schema: draft2020,
    ...specDocumentSchema,
  },

  schaltwerk_diff_summary: {
    $schema: draft2020,
    type: 'object',
    properties: {
      scope: { type: 'string' },
      session_id: nullableString,
      branch_info: diffBranchInfoSchema,
      has_spec: { type: 'boolean' },
      files: {
        type: 'array',
        items: diffFileSchema,
      },
      paging: {
        type: 'object',
        properties: {
          next_cursor: nullableString,
          total_files: { type: 'number' },
          returned: { type: 'number' },
        },
        required: ['next_cursor', 'total_files', 'returned'],
        additionalProperties: false,
      },
    },
    required: ['scope', 'branch_info', 'files', 'paging', 'has_spec'],
    additionalProperties: false,
  },

  schaltwerk_diff_chunk: {
    $schema: draft2020,
    type: 'object',
    properties: {
      file: diffFileSchema,
      branch_info: diffBranchInfoSchema,
      stats: {
        type: 'object',
        properties: {
          additions: { type: 'number' },
          deletions: { type: 'number' },
        },
        required: ['additions', 'deletions'],
        additionalProperties: false,
      },
      is_binary: { type: 'boolean' },
      lines: {
        type: 'array',
        items: diffLineSchema,
      },
      paging: {
        type: 'object',
        properties: {
          cursor: nullableString,
          next_cursor: nullableString,
          returned: { type: 'number' },
        },
        required: ['cursor', 'next_cursor', 'returned'],
        additionalProperties: false,
      },
    },
    required: ['file', 'branch_info', 'stats', 'is_binary', 'lines', 'paging'],
    additionalProperties: false,
  },

  schaltwerk_session_spec: {
    $schema: draft2020,
    type: 'object',
    properties: {
      session_id: { type: 'string' },
      content: { type: 'string' },
      updated_at: isoDateTime,
    },
    required: ['session_id', 'content', 'updated_at'],
    additionalProperties: false,
  },

  schaltwerk_draft_start: {
    $schema: draft2020,
    type: 'object',
    properties: {
      session: { type: 'string' },
      started: { type: 'boolean' },
      agent_type: nullableString,
      skip_permissions: { type: 'boolean' },
      base_branch: nullableString,
    },
    required: ['session', 'started'],
    additionalProperties: false,
  },

  schaltwerk_draft_list: {
    $schema: draft2020,
    type: 'object',
    properties: {
      specs: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            display_name: { type: 'string' },
            created_at: nullableIsoDateTime,
            updated_at: nullableIsoDateTime,
            base_branch: nullableString,
            content_length: { type: 'number' },
            content_preview: { type: 'string' },
          },
          required: ['name', 'content_length', 'content_preview'],
          additionalProperties: false,
        },
      },
    },
    required: ['specs'],
    additionalProperties: false,
  },

  schaltwerk_draft_delete: {
    $schema: draft2020,
    type: 'object',
    properties: {
      session: { type: 'string' },
      deleted: { type: 'boolean' },
    },
    required: ['session', 'deleted'],
    additionalProperties: false,
  },

  schaltwerk_get_current_tasks: {
    $schema: draft2020,
    type: 'object',
    properties: {
      tasks: {
        type: 'array',
        items: taskSchema,
      },
    },
    required: ['tasks'],
    additionalProperties: false,
  },

  schaltwerk_mark_session_reviewed: {
    $schema: draft2020,
    type: 'object',
    properties: {
      session: { type: 'string' },
      reviewed: { type: 'boolean' },
    },
    required: ['session', 'reviewed'],
    additionalProperties: false,
  },

  schaltwerk_convert_to_spec: {
    $schema: draft2020,
    type: 'object',
    properties: {
      session: { type: 'string' },
      converted: { type: 'boolean' },
    },
    required: ['session', 'converted'],
    additionalProperties: false,
  },

  schaltwerk_merge_session: {
    $schema: draft2020,
    type: 'object',
    properties: {
      session: { type: 'string' },
      merged: { type: 'boolean' },
      mode: { enum: ['squash', 'reapply'] },
      parent_branch: { type: 'string' },
      session_branch: { type: 'string' },
      commit: { type: 'string' },
      cancel_requested: { type: 'boolean' },
      cancel_queued: { type: 'boolean' },
      cancel_error: nullableString,
    },
    required: [
      'session',
      'merged',
      'mode',
      'parent_branch',
      'session_branch',
      'commit',
      'cancel_requested',
      'cancel_queued',
    ],
    additionalProperties: false,
  },

  schaltwerk_create_pr: {
    $schema: draft2020,
    type: 'object',
    properties: {
      session: { type: 'string' },
      branch: { type: 'string' },
      pr_url: nullableString,
      cancel_requested: { type: 'boolean' },
      cancel_queued: { type: 'boolean' },
      cancel_error: nullableString,
      modal_triggered: { type: 'boolean' },
    },
    required: ['session', 'branch', 'cancel_requested', 'cancel_queued'],
    additionalProperties: false,
  },
} as const

export type ToolOutputName = keyof typeof toolOutputSchemas
