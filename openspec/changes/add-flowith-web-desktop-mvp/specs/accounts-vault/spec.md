## ADDED Requirements

### Requirement: Import refresh_token (one per line)
The system SHALL allow users to import Flowith accounts using `refresh_token` text input (one token per line), validate tokens by refreshing a Supabase session, and persist accounts without exposing tokens in UI or logs.

#### Scenario: Import success
- **GIVEN** the user pastes N lines of `refresh_token`
- **WHEN** the user triggers import
- **THEN** the system validates each token via Supabase refresh
- **AND** successfully imported accounts appear in the account list with masked token fingerprints only
- **AND** logs do not contain plaintext tokens

### Requirement: Export refresh_token for selected accounts
The system SHALL export plaintext `refresh_token` for user-selected accounts ONLY after explicit user action, and SHALL NOT automatically reveal or log plaintext tokens.

#### Scenario: Export selected tokens
- **GIVEN** the user selects 2 accounts
- **WHEN** the user clicks “Export”
- **THEN** the export output contains exactly 2 lines (one `refresh_token` per line)
- **AND** no unselected account token is exported

### Requirement: Account display name, tags, and filtering
The system SHALL support per-account `displayName` and `tags` for easier identification and filtering.

#### Scenario: Add tags and filter
- **GIVEN** an imported account exists
- **WHEN** the user adds tag `VIP` to the account
- **THEN** the account list shows the tag
- **AND** searching `VIP` filters the list to that account

### Requirement: Show subscription and credits
The system SHALL display per-account subscription and credits information and allow refreshing those values without exposing secrets.

#### Scenario: Credits refresh success
- **GIVEN** an account has a valid stored refresh_token
- **WHEN** the user triggers “Refresh credits”
- **THEN** the system fetches credits/subscription and updates the account panel
- **AND** errors are shown as redacted user-safe messages

### Requirement: No plaintext token persistence when encryption unavailable
If secure encryption is unavailable on the host OS, the system SHALL NOT persist plaintext refresh tokens to disk.

#### Scenario: Linux without safeStorage
- **GIVEN** `electron.safeStorage.isEncryptionAvailable()` is false
- **WHEN** the user imports accounts
- **THEN** accounts may be created but refresh tokens are not persisted
- **AND** the UI informs the user that tokens must be re-imported after restart

