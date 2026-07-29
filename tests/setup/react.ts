// [20260729_Test_RtlSetup] Setup file for React component integration tests.
// Registers @testing-library/jest-dom matchers (toBeInTheDocument, toBeVisible, etc.).
// Import this file at the top of any .tsx test that uses RTL, BEFORE rendering.
// Do NOT add to vitest.config.ts setupFiles globally — it requires jsdom and
// would break the 80+ node-environment unit tests.
import "@testing-library/jest-dom/vitest";
