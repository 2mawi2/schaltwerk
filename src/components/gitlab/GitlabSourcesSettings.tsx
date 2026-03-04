import { useState } from 'react'
import { VscEdit, VscTrash, VscAdd, VscClose } from 'react-icons/vsc'
import type { GitlabSource } from '../../types/gitlabTypes'
import { useTranslation } from '../../common/i18n'
import { theme } from '../../common/theme'
import { logger } from '../../utils/logger'

interface GitlabSourcesSettingsProps {
  sources: GitlabSource[]
  onSave: (sources: GitlabSource[]) => Promise<void>
}

interface SourceFormData {
  label: string
  projectPath: string
  hostname: string
  issuesEnabled: boolean
  mrsEnabled: boolean
  pipelinesEnabled: boolean
}

const defaultFormData: SourceFormData = {
  label: '',
  projectPath: '',
  hostname: 'gitlab.com',
  issuesEnabled: true,
  mrsEnabled: true,
  pipelinesEnabled: false,
}

function FeatureBadge({ label, enabled }: { label: string; enabled: boolean }) {
  return (
    <span
      className="px-1.5 py-0.5 rounded text-caption"
      style={{
        backgroundColor: enabled ? 'var(--color-accent-green-bg)' : 'var(--color-bg-tertiary)',
        color: enabled ? 'var(--color-accent-green-light)' : 'var(--color-text-muted)',
        border: `1px solid ${enabled ? 'var(--color-accent-green-border)' : 'var(--color-border-subtle)'}`,
      }}
    >
      {label}
    </span>
  )
}

export function GitlabSourcesSettings({ sources, onSave }: GitlabSourcesSettingsProps) {
  const { t } = useTranslation()
  const [formVisible, setFormVisible] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [formData, setFormData] = useState<SourceFormData>(defaultFormData)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleAdd = () => {
    setEditingId(null)
    setFormData(defaultFormData)
    setFormVisible(true)
  }

  const handleEdit = (source: GitlabSource) => {
    setEditingId(source.id)
    setFormData({
      label: source.label,
      projectPath: source.projectPath,
      hostname: source.hostname,
      issuesEnabled: source.issuesEnabled,
      mrsEnabled: source.mrsEnabled,
      pipelinesEnabled: source.pipelinesEnabled,
    })
    setFormVisible(true)
  }

  const handleDelete = async (id: string) => {
    setSaving(true)
    setError(null)
    try {
      await onSave(sources.filter((s) => s.id !== id))
    } catch (err) {
      logger.error('[GitlabSourcesSettings] Failed to delete source', err)
      setError(t.gitlabSources.saveError)
    } finally {
      setSaving(false)
    }
  }

  const handleCancel = () => {
    setFormVisible(false)
    setEditingId(null)
    setFormData(defaultFormData)
  }

  const handleSubmit = async () => {
    if (!formData.label.trim() || !formData.projectPath.trim()) return

    setSaving(true)
    setError(null)
    try {
      const updated = editingId
        ? sources.map((s) =>
            s.id === editingId ? { ...s, ...formData } : s,
          )
        : [
            ...sources,
            {
              id: crypto.randomUUID(),
              ...formData,
            },
          ]
      await onSave(updated)
      setFormVisible(false)
      setEditingId(null)
      setFormData(defaultFormData)
    } catch (err) {
      logger.error('[GitlabSourcesSettings] Failed to save sources', err)
      setError(t.gitlabSources.saveError)
    } finally {
      setSaving(false)
    }
  }

  const isFormValid = formData.label.trim() !== '' && formData.projectPath.trim() !== ''

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3
          className="text-body font-medium"
          style={{ color: 'var(--color-text-primary)' }}
        >
          {t.gitlabSources.title}
        </h3>
        {!formVisible && (
          <button
            onClick={handleAdd}
            className="settings-btn px-2 py-1 rounded text-caption flex items-center gap-1"
          >
            <VscAdd className="text-caption" />
            {t.gitlabSources.addSource}
          </button>
        )}
      </div>

      {error && (
        <div
          className="flex items-center justify-between px-3 py-2 rounded-md"
          style={{
            fontSize: theme.fontSize.caption,
            color: 'var(--color-accent-red)',
            backgroundColor: 'var(--color-accent-red-bg)',
            border: '1px solid var(--color-accent-red-border)',
          }}
        >
          <span>{error}</span>
          <button
            type="button"
            onClick={() => setError(null)}
            style={{ color: 'var(--color-accent-red)', flexShrink: 0 }}
          >
            <VscClose className="w-3 h-3" />
          </button>
        </div>
      )}

      {sources.length === 0 && !formVisible && (
        <div
          className="text-body py-4 text-center"
          style={{ color: 'var(--color-text-muted)' }}
        >
          {t.gitlabSources.noSources}
        </div>
      )}

      {sources.map((source) => (
        <div
          key={source.id}
          className="p-3 rounded-lg border flex items-center justify-between gap-3"
          style={{
            borderColor: 'var(--color-border-subtle)',
            backgroundColor: 'var(--color-bg-elevated)',
          }}
        >
          <div className="flex-1 min-w-0 space-y-1">
            <div className="flex items-center gap-2">
              <span
                className="text-body font-medium truncate"
                style={{ color: 'var(--color-text-primary)' }}
              >
                {source.label}
              </span>
              <span
                className="text-caption font-mono truncate"
                style={{ color: 'var(--color-text-muted)' }}
              >
                {source.projectPath}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span
                className="text-caption"
                style={{ color: 'var(--color-text-muted)' }}
              >
                {source.hostname}
              </span>
              <div className="flex items-center gap-1">
                <FeatureBadge label={t.gitlabSources.issues} enabled={source.issuesEnabled} />
                <FeatureBadge label={t.gitlabSources.mergeRequests} enabled={source.mrsEnabled} />
                <FeatureBadge label={t.gitlabSources.pipelines} enabled={source.pipelinesEnabled} />
              </div>
            </div>
          </div>
          <div className="flex items-center gap-1 flex-shrink-0">
            <button
              onClick={() => handleEdit(source)}
              className="settings-btn p-1.5 rounded"
              title={t.gitlabSources.editSource}
            >
              <VscEdit className="text-body" />
            </button>
            <button
              onClick={() => { void handleDelete(source.id) }}
              disabled={saving}
              className="settings-btn-danger p-1.5 rounded disabled:opacity-50"
              title={t.gitlabSources.deleteSource}
            >
              <VscTrash className="text-body" />
            </button>
          </div>
        </div>
      ))}

      {formVisible && (
        <div
          className="p-4 rounded-lg border space-y-3"
          style={{
            borderColor: 'var(--color-border-subtle)',
            backgroundColor: 'var(--color-bg-elevated)',
          }}
        >
          <h4
            className="text-body font-medium"
            style={{ color: 'var(--color-text-primary)' }}
          >
            {editingId ? t.gitlabSources.editSourceTitle : t.gitlabSources.addSourceTitle}
          </h4>

          <div className="space-y-2">
            <label className="block">
              <span
                className="text-caption block mb-1"
                style={{ color: 'var(--color-text-secondary)' }}
              >
                {t.gitlabSources.labelField}
              </span>
              <input
                type="text"
                value={formData.label}
                onChange={(e) => setFormData({ ...formData, label: e.target.value })}
                placeholder={t.gitlabSources.labelPlaceholder}
                className="w-full px-2 py-1.5 rounded text-body"
                style={{
                  backgroundColor: 'var(--color-bg-primary)',
                  border: '1px solid var(--color-border-subtle)',
                  color: 'var(--color-text-primary)',
                }}
              />
            </label>

            <label className="block">
              <span
                className="text-caption block mb-1"
                style={{ color: 'var(--color-text-secondary)' }}
              >
                {t.gitlabSources.projectPathField}
              </span>
              <input
                type="text"
                value={formData.projectPath}
                onChange={(e) => setFormData({ ...formData, projectPath: e.target.value })}
                placeholder={t.gitlabSources.projectPathPlaceholder}
                className="w-full px-2 py-1.5 rounded text-body font-mono"
                style={{
                  backgroundColor: 'var(--color-bg-primary)',
                  border: '1px solid var(--color-border-subtle)',
                  color: 'var(--color-text-primary)',
                }}
              />
            </label>

            <label className="block">
              <span
                className="text-caption block mb-1"
                style={{ color: 'var(--color-text-secondary)' }}
              >
                {t.gitlabSources.hostnameField}
              </span>
              <input
                type="text"
                value={formData.hostname}
                onChange={(e) => setFormData({ ...formData, hostname: e.target.value })}
                placeholder={t.gitlabSources.hostnamePlaceholder}
                className="w-full px-2 py-1.5 rounded text-body"
                style={{
                  backgroundColor: 'var(--color-bg-primary)',
                  border: '1px solid var(--color-border-subtle)',
                  color: 'var(--color-text-primary)',
                }}
              />
            </label>
          </div>

          <div className="flex flex-wrap gap-4">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={formData.issuesEnabled}
                onChange={(e) => setFormData({ ...formData, issuesEnabled: e.target.checked })}
                className="w-4 h-4 rounded"
                style={{ accentColor: 'var(--color-accent-blue)' }}
              />
              <span
                className="text-caption"
                style={{ color: 'var(--color-text-secondary)' }}
              >
                {t.gitlabSources.issues}
              </span>
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={formData.mrsEnabled}
                onChange={(e) => setFormData({ ...formData, mrsEnabled: e.target.checked })}
                className="w-4 h-4 rounded"
                style={{ accentColor: 'var(--color-accent-blue)' }}
              />
              <span
                className="text-caption"
                style={{ color: 'var(--color-text-secondary)' }}
              >
                {t.gitlabSources.mergeRequests}
              </span>
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={formData.pipelinesEnabled}
                onChange={(e) => setFormData({ ...formData, pipelinesEnabled: e.target.checked })}
                className="w-4 h-4 rounded"
                style={{ accentColor: 'var(--color-accent-blue)' }}
              />
              <span
                className="text-caption"
                style={{ color: 'var(--color-text-secondary)' }}
              >
                {t.gitlabSources.pipelines}
              </span>
            </label>
          </div>

          <div className="flex items-center gap-2 pt-1">
            <button
              onClick={() => { void handleSubmit() }}
              disabled={!isFormValid || saving}
              className="settings-btn-success px-3 py-1.5 rounded text-caption font-medium disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {saving ? t.settings.common.saving : t.settings.common.save}
            </button>
            <button
              onClick={handleCancel}
              className="settings-btn px-3 py-1.5 rounded text-caption"
            >
              {t.settings.common.cancel}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
