import base from '@voltex/eslint-config/base';

export default [{ ignores: ['prepare-db.mjs', 'playwright-report', 'test-results'] }, ...base];
