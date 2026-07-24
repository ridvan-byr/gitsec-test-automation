export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    if (name === 'DASHBOARD_BASE_URL') {
      return process.env.DASHBOARD_BASE_URL || 'https://staging.dashboard.gitsec.io';
    }
    if (name === 'API_BASE_URL') {
      return process.env.API_BASE_URL || 'https://staging.api.gitsec.io';
    }
    if (name === 'WORKSPACE_ID') {
      return process.env.WORKSPACE_ID || '28';
    }
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}
