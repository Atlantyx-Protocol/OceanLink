/* ESLint config for the backend (ESLint 8 classic config; package is ESM, so
 * this file must use the .cjs extension). */
module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
  },
  plugins: ['@typescript-eslint'],
  extends: ['eslint:recommended', 'plugin:@typescript-eslint/recommended'],
  env: {
    node: true,
    es2022: true,
  },
  ignorePatterns: ['dist', 'node_modules'],
  rules: {
    '@typescript-eslint/no-unused-vars': [
      'warn',
      { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
    ],
    // `while (true) { ...; if (cond) break; }` is used on purpose in the
    // matching algorithm; only flag constant conditions outside loops.
    'no-constant-condition': ['error', { checkLoops: false }],
    // Fastify route handlers cast `request` to `any` because the wrapHandler
    // wrapper widens the generic types; keep this visible as a warning.
    '@typescript-eslint/no-explicit-any': 'warn',
  },
};
