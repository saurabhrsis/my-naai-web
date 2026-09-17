import globals from 'globals';
import react from 'eslint-plugin-react';

// Lint config with REAL rules.
//
// This file used to declare parser options and nothing else — zero rules — so
// `eslint .` exited 0 on a codebase that threw "ReferenceError: Download is not
// defined" in production (an icon used in src/App.jsx that was never imported).
// A parse-only config cannot catch that; `no-undef` can, and does.
//
// The rule set is deliberately small: undefined/unused identifiers and a few
// footguns that survive a bundle and only fail at runtime. It is not a style
// pass, so it does not fight the existing code.
const reactGlobals = {
  ...globals.browser,
  ...globals.es2021,
  React: 'readonly',
  JSX: 'readonly',
  // Notification Triggers is experimental and missing from `globals`. It is
  // always feature-detected before use (see src/lib/reminders.js).
  TimestampTrigger: 'readonly',
};

export default [
  {
    ignores: ['dist/**', 'node_modules/**', 'public/assets/**', 'public/sw.js', 'public/firebase-messaging-sw.js'],
  },
  {
    files: ['**/*.{js,jsx}'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: reactGlobals,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    linterOptions: {
      reportUnusedDisableDirectives: true,
    },
    // The React plugin is here for exactly one reason: teach `no-unused-vars`
    // that an identifier used in JSX (`<Download />`, `<SalonCard />`) IS used.
    // Without it every component and icon import is reported as dead, which
    // buries the real findings in hundreds of false positives — the state this
    // config was in when the `Download` crash shipped.
    plugins: { react },
    settings: { react: { version: 'detect' } },
    rules: {
      'react/jsx-uses-vars': 'error',
      'react/jsx-uses-react': 'error',
      // A component referenced in JSX but never defined/imported is the exact
      // shape of the production `Download is not defined` crash.
      'react/jsx-no-undef': 'error',
      // The one that would have caught `Download is not defined` at lint time.
      'no-undef': 'error',
      // An unused import is usually the other half of a bad refactor: the JSX
      // was deleted but the import stayed, or (worse) the import was renamed
      // and a stale identifier is still referenced somewhere else.
      'no-unused-vars': ['warn', {
        args: 'none',
        ignoreRestSiblings: true,
        varsIgnorePattern: '^_',
      }],
      // Runtime footguns that a bundler happily ships.
      'no-const-assign': 'error',
      'no-dupe-keys': 'error',
      'no-dupe-args': 'error',
      'no-dupe-class-members': 'error',
      'no-duplicate-case': 'error',
      'no-unsafe-negation': 'error',
      'no-unreachable': 'error',
      'no-cond-assign': 'error',
      'no-self-assign': 'error',
      'no-sparse-arrays': 'error',
      'valid-typeof': 'error',
      'use-isnan': 'error',
    },
  },
  {
    // Vitest specs run in jsdom with the Vitest globals injected by config.
    files: ['**/*.test.{js,jsx}', 'src/test/**/*.{js,jsx}'],
    languageOptions: {
      globals: { ...reactGlobals, ...globals.node },
    },
  },
  {
    // Service workers get the worker/SW globals, not the DOM ones.
    files: ['**/sw.js', '**/*-sw.js', '**/firebase-messaging-sw.js'],
    languageOptions: {
      sourceType: 'script',
      globals: { ...globals.serviceworker, ...globals.browser },
    },
  },
  {
    // `backend/` is standalone CommonJS meant to be copied into the Node API.
    // It is not bundled by Vite, so it does not follow the app's ESM setup.
    files: ['backend/**/*.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'commonjs',
      globals: globals.node,
    },
  },
  {
    // Vite/vitest config files run in Node.
    files: ['*.config.js', 'vite.config.js', 'vitest.config.js'],
    languageOptions: {
      globals: globals.node,
    },
  },
];
