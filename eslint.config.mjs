import eslint from '@eslint/js';
import eslintConfigPrettier from 'eslint-config-prettier';
import eslintPluginReactHooks from 'eslint-plugin-react-hooks';
import eslintPluginVue from 'eslint-plugin-vue';
import globals from 'globals';
import typescriptEslint from 'typescript-eslint';

export default typescriptEslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/coverage/**',
      'playwright-report/**',
      'test-results/**',
      '.worktrees/**'
    ]
  },
  eslint.configs.recommended,
  ...typescriptEslint.configs.strictTypeChecked,
  ...eslintPluginVue.configs['flat/recommended'],
  {
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...globals.browser
      },
      parserOptions: {
        projectService: {
          allowDefaultProject: ['*.mjs', 'scripts/*.mjs']
        },
        extraFileExtensions: ['.vue'],
        parser: typescriptEslint.parser,
        tsconfigRootDir: import.meta.dirname
      }
    },
    linterOptions: {
      noInlineConfig: true,
      reportUnusedDisableDirectives: 'error'
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }
      ],
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
      'no-console': 'error',
      'no-debugger': 'error',
      'object-shorthand': 'error',
      'prefer-const': 'error',
      eqeqeq: ['error', 'always']
    }
  },
  {
    files: ['packages/core/src/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['vue', 'react', '@kumochart-sdk/*'],
              message: 'The core SDK must not depend on any framework or adapter package.'
            }
          ]
        }
      ]
    }
  },
  {
    files: ['packages/react/**/*.ts', 'examples/src/react/**/*.ts'],
    plugins: { 'react-hooks': eslintPluginReactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'error'
    }
  },
  {
    files: ['**/test/**/*.ts', '**/e2e/**/*.ts'],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off'
    }
  },
  {
    files: ['**/*.mjs', 'scripts/**'],
    languageOptions: {
      globals: globals.node
    },
    rules: {
      'no-console': 'off'
    }
  },
  {
    files: ['**/*.mjs'],
    ...typescriptEslint.configs.disableTypeChecked
  },
  eslintConfigPrettier
);
