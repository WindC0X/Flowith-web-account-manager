## ADDED Requirements

### Requirement: Per-account proxy configuration
The system SHALL support per-account proxy mode selection (`system`, `custom`, `direct`) and apply the proxy configuration to the account’s isolated web session.

#### Scenario: Custom proxy applied to one account
- **GIVEN** account A has proxy mode `custom` with valid `proxyRules`
- **AND** account B uses proxy mode `system`
- **WHEN** the user opens tabs for A and B
- **THEN** A’s web session uses the custom proxy
- **AND** B’s web session uses system networking

### Requirement: Proxy safety validation
The system SHALL validate proxy inputs and SHALL NOT accept proxy URLs containing username/password credentials.

#### Scenario: Reject proxy with credentials
- **WHEN** the user enters a proxy URL containing `username:password@host`
- **THEN** the system rejects the input with a user-safe error message

### Requirement: Per-account User-Agent
The system SHALL allow users to set a per-account User-Agent (preset or custom) and apply it to the account’s web session.

#### Scenario: User-Agent change takes effect
- **GIVEN** an account tab is open
- **WHEN** the user changes the account’s User-Agent and reloads the tab
- **THEN** subsequent requests from that tab use the configured User-Agent

### Requirement: Connectivity testing
The system SHALL provide connectivity testing for key endpoints (Flowith Web + edge + supabase/worker when applicable) under the effective proxy configuration.

#### Scenario: Connectivity check report
- **WHEN** the user runs connectivity test for an account
- **THEN** the system returns a report with OK/FAIL and latency for each endpoint

