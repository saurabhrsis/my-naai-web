export default [
  {
    ignores: ['dist/**', 'node_modules/**', 'public/assets/**'],
  },
  {
    files: ['**/*.{js,jsx}'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
  },
  {
    // `backend/` is standalone CommonJS meant to be copied into the Node API.
    // It is not bundled by Vite, so it does not follow the app's ESM setup.
    files: ['backend/**/*.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'commonjs',
    },
  },
];
