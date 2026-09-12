import { defineConfig, devices } from '@playwright/test';

/**
 * 默认本地自起 `vite preview`；在 Docker 的 verify 服务中通过
 * E2E_BASE_URL 指向 web 服务（http://web:80）。
 */
const externalBaseURL = process.env.E2E_BASE_URL;
const baseURL = externalBaseURL ?? 'http://127.0.0.1:4173';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30_000,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL,
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  ...(externalBaseURL
    ? {}
    : {
        webServer: {
          command: 'npm run build && npm run preview -- --host 127.0.0.1 --port 4173 --strictPort',
          url: baseURL,
          timeout: 180_000,
          reuseExistingServer: !process.env.CI,
        },
      }),
});
