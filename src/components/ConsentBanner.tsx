import { theme } from '../common/theme';
import { useAnalyticsConsent } from '../hooks/useAnalyticsConsent';

export function ConsentBanner() {
  const { showBanner, isLoading, handleConsent } = useAnalyticsConsent();

  if (!showBanner) return null;

  return (
    <div
      className="fixed bottom-4 right-4 max-w-md p-4 rounded-lg shadow-lg"
      style={{
        backgroundColor: theme.colors.background.elevated,
        borderColor: theme.colors.border.subtle,
        borderWidth: 1,
        borderStyle: 'solid',
        zIndex: 9999,
      }}
    >
      <div className="mb-3">
        <h3
          style={{
            fontSize: theme.fontSize.bodyLarge,
            color: theme.colors.text.primary,
            fontWeight: 600,
            marginBottom: '0.5rem',
          }}
        >
          Help improve Schaltwerk
        </h3>
        <p
          style={{
            fontSize: theme.fontSize.body,
            color: theme.colors.text.secondary,
            lineHeight: 1.5,
            marginBottom: '0.75rem',
          }}
        >
          We'd like to collect anonymous usage metrics to understand how Schaltwerk is used and improve the app.
        </p>
        <div
          style={{
            fontSize: theme.fontSize.caption,
            color: theme.colors.text.tertiary,
            lineHeight: 1.4,
            padding: '0.5rem',
            backgroundColor: theme.colors.background.secondary,
            borderRadius: '0.25rem',
            marginBottom: '0.5rem',
          }}
        >
          <div style={{ marginBottom: '0.25rem', fontWeight: 500 }}>We only track:</div>
          <ul style={{ paddingLeft: '1rem', listStyle: 'disc' }}>
            <li>App version and session metrics (duration, file count)</li>
            <li>Feature usage (which features are used, not how)</li>
            <li>Agent types used (claude, cursor, etc.)</li>
          </ul>
        </div>
        <p
          style={{
            fontSize: theme.fontSize.caption,
            color: theme.colors.text.tertiary,
            fontStyle: 'italic',
          }}
        >
          No personal data, file paths, or code content is ever collected.
          You can change this in Settings at any time.
        </p>
      </div>
      
      <div className="flex gap-2 justify-end">
        <button
          onClick={() => handleConsent(false)}
          disabled={isLoading}
          className="px-4 py-2 rounded transition-colors"
          style={{
            backgroundColor: theme.colors.background.secondary,
            color: theme.colors.text.secondary,
            fontSize: theme.fontSize.button,
            opacity: isLoading ? 0.5 : 1,
            cursor: isLoading ? 'not-allowed' : 'pointer',
          }}
          onMouseEnter={(e) => {
            if (!isLoading) {
              e.currentTarget.style.backgroundColor = theme.colors.background.tertiary;
            }
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.backgroundColor = theme.colors.background.secondary;
          }}
        >
          No thanks
        </button>
        <button
          onClick={() => handleConsent(true)}
          disabled={isLoading}
          className="px-4 py-2 rounded transition-colors"
          style={{
            backgroundColor: theme.colors.accent.blue.DEFAULT,
            color: theme.colors.text.inverse,
            fontSize: theme.fontSize.button,
            opacity: isLoading ? 0.5 : 1,
            cursor: isLoading ? 'not-allowed' : 'pointer',
          }}
          onMouseEnter={(e) => {
            if (!isLoading) {
              e.currentTarget.style.backgroundColor = theme.colors.accent.blue.dark;
            }
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.backgroundColor = theme.colors.accent.blue.DEFAULT;
          }}
        >
          {isLoading ? 'Saving...' : 'Accept'}
        </button>
      </div>
    </div>
  );
}