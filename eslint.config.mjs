import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    ignores: [
      'tests/e2e/**',
      'node_modules/**',
      'playwright-report/**',
      'test-results/**',
      'tests-server.js',
      'scripts/**',
      'playwright.config.ts',
      'scratch/**',
    ],
  },
  {
    languageOptions: {
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': 'warn',
      '@typescript-eslint/no-require-imports': 'off',
      'prefer-const': 'warn',
      'no-useless-escape': 'off',
      'no-useless-assignment': 'warn',
      'no-empty': 'warn',
      'no-case-declarations': 'off',
      'no-console': 'off',
      'no-unused-vars': 'warn',
    },
  }
);
