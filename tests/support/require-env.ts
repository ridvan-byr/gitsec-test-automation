const DEFAULT_ENVS: Record<string, string> = {
  DASHBOARD_BASE_URL: 'https://staging.dashboard.gitsec.io',
  API_BASE_URL: 'https://staging.api.gitsec.io',
  WORKSPACE_ID: '291',
  E2E_USER_EMAIL: 'test-user@gitsec.io',
  E2E_USER_PASSWORD: 'PlaceholderPassword123!',
  GOOGLE_TEST_USER: 'test-user@gitsec.io',
  GOOGLE_TEST_PASSWORD: 'PlaceholderPassword123!',
  GITHUB_TEST_USER: 'gitsectest-user',
  GITHUB_TEST_PASSWORD: 'PlaceholderPassword123!',
  GITHUB_MAIL_USER: 'test-user@gitsec.io',
  GITHUB_MAIL_PASSWORD: 'PlaceholderPassword123!',
};

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === '') {
    if (DEFAULT_ENVS[name]) {
      return DEFAULT_ENVS[name];
    }
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}
