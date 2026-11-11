import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['legacy/**', 'dist/**', 'node_modules/**', 'vendor/**', 'assets/**', 'docs/**'],
  },
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.{ts,tsx}', 'tests/**/*.ts', 'sw/**/*.ts'],
    rules: {
      'eqeqeq': ['error', 'always'],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      '@typescript-eslint/no-explicit-any': 'error',
      'max-lines': ['warn', { max: 300, skipBlankLines: true, skipComments: true }],
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@features/*', '../features/*', '../../features/*'],
              message: 'features/* must not import other features; share via ui/ or data/.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['src/domain/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@data/*', '@ui/*', '@app/*', '@platform/*', '@features/*'],
              message: 'domain/ may only import from domain/.',
            },
          ],
        },
      ],
    },
  },
);
