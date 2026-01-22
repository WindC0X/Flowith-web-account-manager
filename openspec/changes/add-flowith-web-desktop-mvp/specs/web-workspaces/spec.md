## ADDED Requirements

### Requirement: Tabbed Flowith Web workspaces with per-account isolation
The system SHALL provide a tabbed workspace to open `https://flowith.io` for multiple accounts, where each tab uses an isolated browser session (partition) per account.

#### Scenario: Two accounts in parallel tabs
- **GIVEN** two accounts A and B exist
- **WHEN** the user opens a workspace tab for A and a workspace tab for B
- **THEN** switching between tabs preserves each tab’s independent login state
- **AND** A and B do not share cookies/localStorage/session data

### Requirement: Token-based login bootstrap for Flowith Web
When opening a workspace tab for an account, the system SHALL bootstrap the Flowith Web login state using the account’s `refresh_token` (without requiring password/OAuth in the UI).

#### Scenario: Open tab and become logged in
- **GIVEN** an account has a valid stored refresh_token
- **WHEN** the user opens the account’s Flowith Web tab
- **THEN** the page finishes loading in a logged-in state for that account

### Requirement: Workspace embedding does not break app layout
Embedding Flowith Web content SHALL NOT replace or corrupt the app UI; the web content SHALL be confined to the workspace viewport and resize correctly.

#### Scenario: Resize and sidebar collapse
- **GIVEN** the workspace is open with an active web tab
- **WHEN** the user resizes the window or collapses the sidebar
- **THEN** the web viewport resizes to match the workspace container bounds
- **AND** core app controls remain clickable and visible

### Requirement: Secure web embedding
The system SHALL embed Flowith Web with Electron security best practices (no Node.js integration, restricted navigation, external links opened in system browser).

#### Scenario: External link handling
- **WHEN** Flowith Web attempts to open a new window or navigate to an external origin
- **THEN** the app prevents in-app navigation to untrusted origins
- **AND** opens external links in the system default browser when appropriate

