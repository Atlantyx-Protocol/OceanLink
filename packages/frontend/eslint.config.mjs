import nextCoreWebVitals from 'eslint-config-next/core-web-vitals';
import nextTypeScript from 'eslint-config-next/typescript';

const config = [
  ...nextCoreWebVitals,
  ...nextTypeScript,
  {
    ignores: ['.next/**', 'node_modules/**', 'next-env.d.ts'],
  },
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],

      // small token/chain icons are static and tiny — Next/Image overhead
      // isn't worth it for these
      '@next/next/no-img-element': 'off',

      // we intentionally react to async bridge lifecycle events from useBridge
      // inside an effect; restructuring to satisfy this rule would obscure the
      // state-machine flow
      'react-hooks/set-state-in-effect': 'off',
    },
  },
];

export default config;
