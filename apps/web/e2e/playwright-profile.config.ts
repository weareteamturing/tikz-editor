/**
 * Playwright config for profiling tests.
 * Uses a production build (no React dev overhead) for accurate CPU profiles.
 *
 * Run:
 *   npx playwright test -c e2e/playwright-profile.config.ts e2e/profile-drag.spec.ts
 */
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  timeout: 120_000,
  expect: {
    timeout: 10_000
  },
  fullyParallel: false,
  retries: 0,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:4174",
    trace: "off"
  },
  webServer: {
    command: "npm run build && npx vite preview --host 127.0.0.1 --port 4174",
    cwd: "..",
    url: "http://127.0.0.1:4174",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] }
    }
  ]
});
