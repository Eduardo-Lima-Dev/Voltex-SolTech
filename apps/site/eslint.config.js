import base from '@voltex/eslint-config/base';
import globals from 'globals';

export default [...base, { languageOptions: { globals: globals.browser } }];
