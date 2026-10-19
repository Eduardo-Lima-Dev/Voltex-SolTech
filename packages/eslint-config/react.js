import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import base from './base.js';

export default [
  ...base,
  {
    languageOptions: { globals: { ...globals.browser } },
    plugins: { 'react-hooks': reactHooks },
    rules: reactHooks.configs.recommended.rules,
  },
];
