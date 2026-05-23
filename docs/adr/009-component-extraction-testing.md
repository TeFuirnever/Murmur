# ADR 009: Component extraction and frontend testing

## Status: Accepted

## Context

App.tsx was 949 lines with 5 inline sub-components, making it difficult to maintain and test. Frontend had zero test coverage — the plan identified this as HIGH severity risk for UI regression.

## Decision

1. Extract 5 components from App.tsx: SoundWaveIcon, LoadingIndicator, VoiceWaveIndicator, Tooltip, TextDisplay
2. Add @testing-library/react + happy-dom for DOM-based component testing
3. Write 43 component tests covering rendering, state transitions, and user interactions
4. Use `@vitest-environment happy-dom` directive per test file (no global config change)

## Consequences

- App.tsx reduced from 949 to 743 lines
- 503 total tests (43 new frontend tests)
- Component behavior is now verified independently
- Future UI changes have regression protection
- happy-dom only loads for component tests; backend tests stay in node environment
