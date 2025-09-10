# Privacy Policy for Schaltwerk

**Last updated:** January 2025  
**Data Controller:** Schaltwerk Project  
**Contact:** [Add your contact email here]

## Overview

Schaltwerk collects minimal, anonymous usage analytics to help improve the application. We are committed to protecting your privacy and being transparent about our data practices.

## What We Collect

We collect **anonymous usage metrics only**. No personal information is ever collected or transmitted.

### Metrics Collected:

- **Application Events:**
  - App version when started
  - Session creation (agent type used, whether from spec)
  - Session completion (duration in minutes, number of files changed)
  - Session cancellation (duration in minutes only)
  - Spec creation (whether from MCP API or manual)
  - Spec/session conversions (age in minutes)
  - Feature usage (feature name only)
  - User feedback (feedback message text, app version)

### What We NEVER Collect:

- ❌ Personal information (names, emails, etc.)
- ❌ File contents or file paths
- ❌ Project names or repository URLs
- ❌ IP addresses (explicitly disabled with `ip: false`)
- ❌ Location/geo data (all geolocation stripped)
- ❌ Session IDs or tracking cookies
- ❌ Device identifiers or fingerprints
- ❌ Error messages or stack traces
- ❌ Any data from your coding sessions
- ❌ Git commit messages or history

## Legal Basis (GDPR)

**Consent** - We only collect analytics after you explicitly consent. You can opt-out at any time through the application settings.

## Data Processing

- **Analytics Processor:** PostHog
- **Data Location:** EU servers (GDPR compliant)
- **Data Retention:** 90 days
- **Data Transmission:** Encrypted (HTTPS)

### User Feedback
When you submit feedback through the app:
- Your feedback message is sent anonymously to PostHog
- No identifying information is attached to your feedback
- Feedback is used solely to improve the application
- You must have analytics enabled to submit feedback

## Your Rights

You have the right to:

1. **Opt-out anytime** - Toggle analytics off in Settings > Privacy
2. **No tracking by default** - Analytics are disabled until you consent
3. **Complete anonymity** - We cannot identify you from the data collected
4. **Data deletion** - Since data is anonymous and auto-deleted after 90 days, individual deletion requests are not applicable

## Data Security

- All data transmission uses HTTPS encryption
- Analytics data is stored on PostHog's EU servers with enterprise security
- No sensitive data is ever collected to begin with
- Local consent preferences are stored on your device only

## Children's Privacy

Schaltwerk does not knowingly collect any information from children under 13.

## Third-Party Services

We use PostHog for analytics processing. Their privacy policy can be found at: https://posthog.com/privacy

PostHog is configured to:
- Disable all automatic tracking
- Never create user profiles
- Not collect any personal information
- Store data in EU data centers

## Open Source Transparency

Schaltwerk is open source. You can verify our privacy practices by reviewing our code:
- Analytics implementation: `src/analytics/posthog.ts`
- Consent management: `src/components/ConsentBanner.tsx`
- Settings: `src/components/modals/SettingsModal.tsx`

## Changes to This Policy

We will update this policy as needed with new application versions. The "Last updated" date will always reflect the most recent changes.

## Contact

For privacy-related questions or concerns, please open an issue on our GitHub repository or contact: [Add contact method]

## Compliance

This privacy policy is designed to comply with:
- General Data Protection Regulation (GDPR)
- California Consumer Privacy Act (CCPA)
- Other applicable privacy laws

By using Schaltwerk, you acknowledge that you have read and understood this privacy policy.