export enum AnalyticsEventName {
  APP_STARTED = 'app_started',
  SESSION_CREATED = 'session_created',
  SESSION_COMPLETED = 'session_completed',
  SESSION_CANCELLED = 'session_cancelled',
  SPEC_CREATED = 'spec_created',
  SPEC_CONVERTED_TO_SESSION = 'spec_converted_to_session',
  SESSION_CONVERTED_TO_SPEC = 'session_converted_to_spec',
  FEATURE_USED = 'feature_used',
}

export interface AnalyticsEvents {
  [AnalyticsEventName.APP_STARTED]: {
    version: string;
    environment: 'production' | 'development';
    build_source: 'homebrew' | 'local' | 'unknown';
  };
  [AnalyticsEventName.SESSION_CREATED]: {
    agent_type: string;
    from_spec: boolean;
  };
  [AnalyticsEventName.SESSION_COMPLETED]: {
    duration_minutes: number;
    files_changed: number;
  };
  [AnalyticsEventName.SESSION_CANCELLED]: {
    duration_minutes: number;
  };
  [AnalyticsEventName.SPEC_CREATED]: {
    from_mcp: boolean;
  };
  [AnalyticsEventName.SPEC_CONVERTED_TO_SESSION]: {
    spec_age_minutes: number;
  };
  [AnalyticsEventName.SESSION_CONVERTED_TO_SPEC]: {
    session_age_minutes: number;
  };
  [AnalyticsEventName.FEATURE_USED]: {
    feature: string;
  };
}