import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  {
    ignores: ['**/dist/**', '**/node_modules/**', 'design/**', 'packages/db/migrations/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },
  {
    // Operator scripts: run by a human on a terminal, so talking to stdout is the point.
    files: ['scripts/**/*.mjs'],
    languageOptions: {
      globals: {
        console: 'readonly',
        fetch: 'readonly',
        process: 'readonly',
      },
    },
    rules: {
      'no-console': 'off',
    },
  },
  {
    // Metro, Babel and Tailwind all load these directly via Node's CommonJS loader before
    // any bundling happens -- they cannot be ESM, and `require`/`module.exports` is the
    // format the tooling itself mandates, not a style choice.
    files: [
      'apps/mobile/babel.config.js',
      'apps/mobile/metro.config.js',
      'apps/mobile/tailwind.config.js',
    ],
    languageOptions: {
      globals: {
        module: 'writable',
        require: 'readonly',
        __dirname: 'readonly',
      },
    },
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
  {
    // packages/rules must never gain a dependency (build-plan.md S1). Nothing lives
    // there yet -- this guard is here so Stage 5 inherits it rather than inventing it.
    // Relative imports (own files within the package) are exempt -- the rule is "no
    // dependencies," not "no internal structure."
    files: ['packages/rules/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              // Matches any import specifier NOT starting with "." -- i.e. every external
              // package, while leaving this package's own relative imports alone. Tried
              // `group: ['*', '!./**', '!../**']` first; ESLint's group-array negation does
              // not compose the way that reads, and it still flagged the package's own
              // internal imports. `regex` is the documented escape hatch for exactly this.
              regex: '^(?!\\.).*$',
              message:
                'packages/rules is dependency-free by design: pure functions over plain JSON only.',
            },
          ],
        },
      ],
    },
  },
  {
    // packages/contracts is types-only (build-plan.md S3 Decision 2): apps/mobile imports it
    // directly, and an import here of packages/db (pg) or packages/sleeper (@upstash/redis)
    // would pull a Postgres driver into an Android bundle the first time someone "simplifies"
    // a type by importing it from its source instead of re-declaring it here. Relative
    // imports (own files within the package, e.g. index.ts re-exporting user-leagues.ts) are
    // exempt -- the rule is "no external dependencies," not "no internal structure."
    files: ['packages/contracts/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              // See the matching comment on packages/rules above -- same regex, same reason.
              regex: '^(?!\\.).*$',
              message:
                'packages/contracts is types-only by design: wire shapes with no runtime imports, so apps/mobile never pulls in a server-side dependency.',
            },
          ],
        },
      ],
    },
  },
);
