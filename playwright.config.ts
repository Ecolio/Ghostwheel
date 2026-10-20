import { defineConfig } from '@playwright/test';
import { origin, port } from './tests/e2e/env';

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: '**/*.spec.ts',
  fullyParallel: false,
  workers: 1,
  timeout: 45_000,
  expect: { timeout: 8_000 },
  outputDir: '.local/browser-results',
  reporter: 'list',
  webServer: {
    command: 'node --import tsx server/index.ts',
    url: `${origin}/api/health`,
    reuseExistingServer: false,
    env: {
      PORT: String(port),
      CORNELIUS_DATABASE: ':memory:',
      CORNELIUS_ADMIN_PASSWORD: 'admin-browser-test-only-credentials-1234',
      CORNELIUS_LOGIN_RATE_LIMIT: '200',
      // Les parcours ne dépendent pas du dépôt cornelius-modules éventuellement cloné à côté.
      CORNELIUS_MODULES_DIR: '.local/e2e-sans-modules',
    },
  },
  use: {
    baseURL: origin,
    browserName: 'chromium',
    viewport: { width: 1440, height: 1000 },
    reducedMotion: 'reduce',
  },
});
