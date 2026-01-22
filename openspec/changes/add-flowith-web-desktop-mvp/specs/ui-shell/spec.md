## ADDED Requirements

### Requirement: UI SHALL follow the provided Demo UI layout and interactions
The system SHALL implement the workspace UI following the structure and interaction patterns defined in `docs/ui-demo-flowith-web-account-manager.html` to minimize user relearning and reduce redesign churn.

#### Scenario: Workspace UI layout present
- **WHEN** the user opens the app
- **THEN** the UI shows the following regions:
  - Topbar (global actions and preferences)
  - Sidebar (account list + selection + batch actions)
  - Tabs workspace (tab strip + web viewport)
  - Inspector (account details panel)
  - Import/Export dialogs (token workflows)

#### Scenario: Sidebar collapse remains usable
- **GIVEN** the sidebar is collapsed
- **WHEN** the user tries to re-open the sidebar
- **THEN** an explicit control remains available to expand the sidebar

### Requirement: Workspace is the default primary screen
The system SHALL launch into the Workspace layout as the primary screen, and SHALL provide Import/Export/Settings as in-context dialogs/drawers without requiring page navigation.

#### Scenario: App start shows Workspace
- **WHEN** the user starts the app
- **THEN** the Workspace layout is visible by default
- **AND** the user can open Import/Export/Settings flows from within the Workspace UI

