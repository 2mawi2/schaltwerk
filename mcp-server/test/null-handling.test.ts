describe('MCP Server Null Handling', () => {
  describe('Date formatting with null values', () => {
    it('should surface native Date coercion behavior for nullish inputs', () => {
      expect(() => new Date(null as any).toISOString()).not.toThrow()
      expect(() => new Date(null as any).toLocaleString()).not.toThrow()
      expect(new Date(null as any).getTime()).toBe(0)

      expect(() => new Date(undefined as any).toISOString()).toThrow(RangeError)
      expect(() => new Date(undefined as any).toLocaleString()).not.toThrow()
      expect(new Date(undefined as any).toLocaleString()).toBe('Invalid Date')
      expect(Number.isFinite(new Date(undefined as any).getTime())).toBe(false)
    })

    it('should handle null dates in text formatting', () => {
      const formatUpdated = (updated_at: number | null | undefined) => {
        const updated = updated_at ? new Date(updated_at).toLocaleString() : 'unknown'
        return updated
      }

      expect(formatUpdated(Date.now())).not.toBe('unknown')
      expect(formatUpdated(null)).toBe('unknown')
      expect(formatUpdated(undefined)).toBe('unknown')
      expect(formatUpdated(0)).toBe('unknown')
    })

    it('should handle null dates in JSON formatting', () => {
      const formatDate = (value: number | null | undefined) => {
        return value ? new Date(value).toISOString() : null
      }

      expect(formatDate(Date.now())).not.toBeNull()
      expect(formatDate(null)).toBeNull()
      expect(formatDate(undefined)).toBeNull()
      expect(formatDate(0)).toBeNull()
    })

    it('simulates the actual MCP server formatting issue', () => {
      type Session = {
        name: string
        display_name?: string
        status: 'active' | 'spec'
        ready_to_merge: boolean
        original_agent_type?: string
        updated_at?: number
        created_at: number
        draft_content?: string
      }

      const formatSessionText = (s: Session) => {
        if (s.status === 'spec') {
          const created = new Date(s.created_at).toLocaleDateString()
          const contentLength = s.draft_content?.length || 0
          const name = s.display_name || s.name
          return `[PLAN] ${name} - Created: ${created}, Content: ${contentLength} chars`
        } else {
          const reviewed = s.ready_to_merge ? '[REVIEWED]' : '[NEW]'
          const agent = s.original_agent_type || 'unknown'
          const updated = s.updated_at ? new Date(s.updated_at).toLocaleString() : 'unknown'
          const name = s.display_name || s.name
          return `${reviewed} ${name} - Agent: ${agent}, Updated: ${updated}`
        }
      }

      const formatSessionJson = (s: Session) => ({
        name: s.name,
        display_name: s.display_name || s.name,
        status: s.status === 'spec' ? 'spec' : (s.ready_to_merge ? 'reviewed' : 'new'),
        created_at: new Date(s.created_at).toISOString(),
        updated_at: s.updated_at ? new Date(s.updated_at).toISOString() : null,
        agent_type: s.original_agent_type || 'claude'
      })

      const sessionWithActivity: Session = {
        name: 'test-with-activity',
        display_name: 'Test With Activity',
        status: 'active',
        ready_to_merge: false,
        original_agent_type: 'claude',
        updated_at: Date.now(),
        created_at: Date.now()
      }

      const sessionWithoutActivity: Session = {
        name: 'test-without-activity',
        display_name: 'Test Without Activity',
        status: 'active',
        ready_to_merge: false,
        original_agent_type: 'claude',
        updated_at: undefined,
        created_at: Date.now()
      }

      const sessionWithNullValues: Session = {
        name: 'test-null-values',
        status: 'active',
        ready_to_merge: false,
        created_at: Date.now()
      }

      expect(() => formatSessionText(sessionWithActivity)).not.toThrow()
      expect(() => formatSessionText(sessionWithoutActivity)).not.toThrow()
      expect(() => formatSessionText(sessionWithNullValues)).not.toThrow()

      expect(() => formatSessionJson(sessionWithActivity)).not.toThrow()
      expect(() => formatSessionJson(sessionWithoutActivity)).not.toThrow()
      expect(() => formatSessionJson(sessionWithNullValues)).not.toThrow()

      const text1 = formatSessionText(sessionWithActivity)
      expect(text1).toContain('Updated:')
      expect(text1).not.toContain('unknown')

      const text2 = formatSessionText(sessionWithoutActivity)
      expect(text2).toContain('Updated: unknown')

      const text3 = formatSessionText(sessionWithNullValues)
      expect(text3).toContain('Updated: unknown')
      expect(text3).toContain('Agent: unknown')

      const json1 = formatSessionJson(sessionWithActivity)
      expect(json1.updated_at).not.toBeNull()

      const json2 = formatSessionJson(sessionWithoutActivity)
      expect(json2.updated_at).toBeNull()

      const json3 = formatSessionJson(sessionWithNullValues)
      expect(json3.updated_at).toBeNull()
      expect(json3.agent_type).toBe('claude')
    })
  })
})
