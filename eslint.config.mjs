import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import prettier_plugin from 'eslint-plugin-prettier';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import unusedImports from 'eslint-plugin-unused-imports';
import tseslint from 'typescript-eslint';

const config = [
  {
    ignores: [
      'node_modules/**',
      '.next/**',
      'out/**',
      'build/**',
      'next-env.d.ts',
      'src/db/migrations/**',
      '**.json',
      // Vendored Figma design prototype — reference material, not app code.
      'design/**',
      // Agent worktrees: a second checkout of this same repo under .claude/.
      // Linting it double-reports every file and drags in `design/` again from a
      // path the ignore above does not match.
      '.claude/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,
  {
    plugins: {
      react,
      'react-hooks': reactHooks,
      prettier: prettier_plugin,
      'unused-imports': unusedImports,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-explicit-any': 'warn',
      'no-console': 'off',
      'no-debugger': 'error',
      'linebreak-style': 'off',
      'react/react-in-jsx-scope': 'off',
      'react/prop-types': 'off',
      'react-hooks/preserve-manual-memoization': 'warn',
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/purity': 'warn',
      'react-hooks/static-components': 'warn',
      'prettier/prettier': [
        'error',
        {
          endOfLine: 'auto',
        },
      ],
      'unused-imports/no-unused-imports': 'error',
    },
    settings: {
      react: {
        version: 'detect',
      },
    },
  },
  {
    files: ['src/db/**/*.ts'],
    rules: {
      '@typescript-eslint/no-unused-vars': 'off',
    },
  },
  {
    // Feature modules get pulled into `'use client'` components, and a *value*
    // import of the Drizzle schema is the silent way to ship `pgTable` and
    // `pg-core` — table names, column names, CHECK clauses — to the browser.
    // A DAO import is not restricted here: it fails loudly (node builtins in a
    // client bundle) and feature-level server components read DAOs legitimately.
    // Type imports are erased, so they stay allowed; tests never reach a bundle.
    files: ['src/features/**/*.ts', 'src/features/**/*.tsx'],
    ignores: ['src/features/**/*.test.ts', 'src/features/**/*.test.tsx'],
    rules: {
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@/db/schema', '@/db/schema/*'],
              allowTypeImports: true,
              message:
                'Import types only: a value import of the schema drags drizzle into the client bundle. Re-declare the literal, or read the data in a server component and pass it down.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['*.config.js', '*.config.cjs', '*.config.mjs', 'scripts/**/*.mjs'],
    languageOptions: {
      globals: {
        process: 'readonly',
        console: 'readonly',
        module: 'readonly',
        require: 'readonly',
        __dirname: 'readonly',
        __filename: 'readonly',
      },
    },
  },
];

export default config;
