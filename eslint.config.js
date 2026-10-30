import tseslint from 'typescript-eslint'

export default tseslint.config(
  { ignores: ['dist', 'dist-test', 'node_modules', 'coverage', 'test-results', 'playwright-report', 'src/sw-template.js', 'public'] },
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },
)
