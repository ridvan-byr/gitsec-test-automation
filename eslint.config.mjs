import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    ignores: [
      'node_modules/**',
      'playwright-report/**',
      'test-results/**',
    ],
  },
  {
    languageOptions: {
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
      },
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': 'warn',
      '@typescript-eslint/no-require-imports': 'off',
      '@typescript-eslint/no-unused-expressions': 'warn',
      '@typescript-eslint/no-unsafe-function-type': 'warn',
      '@typescript-eslint/no-wrapper-object-types': 'warn',
      '@typescript-eslint/no-unsafe-declaration-merging': 'warn',
      '@typescript-eslint/no-empty-object-type': 'warn',
      'prefer-const': 'warn',
      'no-useless-escape': 'off',
      'no-useless-assignment': 'warn',
      'no-empty': 'warn',
      'no-case-declarations': 'off',
      'no-console': 'off',
      'no-unused-vars': 'warn',
      'no-unused-expressions': 'warn',
      'no-redeclare': 'warn',
      'no-shadow': 'warn',
      'no-undef': 'warn',
      'preserve-caught-error': 'off',
    },
  }
);
