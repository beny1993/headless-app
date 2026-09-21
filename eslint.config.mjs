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
      // Playwright output: the HTML report ships the trace viewer's own bundle.
      'playwright-report/**',
      'test-results/**',
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
      // A shadowed name reads as the outer one until you look twice: a `max`
      // parameter beside drizzle's `max` aggregate, a `path` parameter beside
      // node's `path`. The base rule is off because it cannot see TypeScript's
      // own scopes (enums, type parameters, declaration merging).
      'no-shadow': 'off',
      '@typescript-eslint/no-shadow': 'error',
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
    //
    // The four `src/lib` domain directories are here for the same reason and a
    // sharper one. They hold the client-safe contracts both sides of the wire
    // import, and `account/pet.ts`, `account/address.ts` and
    // `discount/discount-code.ts` demonstrably reach the browser (`pets-tab`,
    // `addresses-tab`, `checkout-form`, `discount-manager`). Their wire
    // projections take a row type from `@/db`, which is erased — but a later
    // edit dropping one `type` keyword ships `pgTable` to the client and
    // nothing fails: a DAO import announces itself by breaking the build on
    // `dns`, a schema import is silent. A comment was all that stood here.
    files: [
      'src/features/**/*.ts',
      'src/features/**/*.tsx',
      'src/lib/{account,catalog,discount,orders}/**/*.ts',
    ],
    ignores: [
      'src/features/**/*.test.ts',
      'src/features/**/*.test.tsx',
      'src/lib/{account,catalog,discount,orders}/**/*.test.ts',
    ],
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
    // A route file imports `@hono/zod-openapi`, which imports the router, which
    // imports the DAOs. A page that imports a *value* out of one — a response
    // mapper, a message constant — pulls that whole graph into the RSC module
    // graph for the sake of one pure function. The fix is always the same: the
    // shared thing belongs in a client-safe domain module both sides import
    // (`@/lib/account/pet`, `@/lib/orders/order-summary`, the pattern
    // `@/lib/catalog/product-query` set). Type imports are erased, so they stay
    // allowed — a page is free to name the shape the API returns.
    //
    // `@/lib/hono` itself is in the group, not just its routes: importing the
    // whole router is strictly worse than importing one route, and it is the
    // plausible accident when somebody wants a shared constant out of
    // `index.ts`. `routes/**` rather than `routes/*` because minimatch's `*`
    // does not cross a slash, so a future `routes/sub/x.ts` would walk straight
    // past a single star. Layouts are covered too — a layout is a server
    // component with the same module graph a page has.
    //
    // Deliberately not covered: a dynamic `import()` and a relative path out of
    // `src/app`. Both would need a different rule for a hazard nothing in the
    // tree is near — no file under `src/app` reaches `src/lib` relatively.
    files: ['src/app/**/page.tsx', 'src/app/**/layout.tsx'],
    rules: {
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@/lib/hono', '@/lib/hono/index', '@/lib/hono/routes/**'],
              allowTypeImports: true,
              message:
                'Import types only: a value import of the Hono app or one of its routes drags the API router (and the DAOs behind it) into this page. Move the shared value into a client-safe domain module under @/lib and import it from there.',
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
