import globals from 'globals';
import base from './base.js';

export default [
  ...base,
  {
    languageOptions: { globals: { ...globals.node } },
    rules: {
      // NestJS depende de imports de valor para a injeção de dependência
      '@typescript-eslint/consistent-type-imports': 'off',
    },
  },
];
