## ADDED Requirements

### Requirement: Theme (dark/light)
The system SHALL provide dark/light themes and persist the user’s selection across app restarts.

#### Scenario: Theme persistence
- **GIVEN** the user switches to light theme
- **WHEN** the app restarts
- **THEN** the UI loads in light theme

### Requirement: i18n (zh-CN/en)
The system SHALL provide Simplified Chinese and English UI language options and persist the selection.

#### Scenario: Language persistence
- **GIVEN** the user switches UI language to English
- **WHEN** the app restarts
- **THEN** the UI loads in English

### Requirement: Layout preferences persistence
The system SHALL persist layout preferences such as sidebar collapsed state and account list view mode.

#### Scenario: Sidebar collapsed state
- **GIVEN** the user collapses the sidebar
- **WHEN** the app restarts
- **THEN** the sidebar remains collapsed

