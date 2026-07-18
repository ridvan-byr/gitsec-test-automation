export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    if (name === 'WORKSPACE_ID') {
      return process.env.WORKSPACE_ID || '';
    }
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}
