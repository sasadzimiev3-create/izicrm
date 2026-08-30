import eslint from '@eslint/js';
import importPlugin from 'eslint-plugin-import';
import tseslint from 'typescript-eslint';

const layerZones = [
  {
    target: './src/domain',
    from: './src/application',
    message: 'domain не импортирует application',
  },
  {
    target: './src/domain',
    from: './src/infrastructure',
    message: 'domain не импортирует infrastructure',
  },
  {
    target: './src/domain',
    from: './src/interface',
    message: 'domain не импортирует interface',
  },
  {
    target: './src/application',
    from: './src/infrastructure',
    message: 'application не импортирует infrastructure — только порты',
  },
  {
    target: './src/application',
    from: './src/interface',
    message: 'application не знает про Telegram',
  },
  {
    target: './src/infrastructure',
    from: './src/interface',
    message: 'infrastructure не импортирует interface',
  },
  {
    target: './src/interface',
    from: './src/infrastructure',
    message: 'interface не импортирует infrastructure — только application и domain',
  },
];

const telegramStack = [
  { name: 'grammy', message: 'grammy живёт только в interface/telegram и infrastructure/telegram' },
  { name: 'pg', message: 'драйвер БД живёт только в infrastructure/db' },
  { name: 'kysely', message: 'SQL живёт только в infrastructure' },
];

export default tseslint.config(
  {
    ignores: ['dist/**', 'coverage/**', 'node_modules/**', 'migrations/**', 'web/public/**'],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.ts'],
    plugins: {
      import: importPlugin,
    },
    settings: {
      'import/resolver': {
        typescript: { alwaysTryTypes: true, project: './tsconfig.json' },
        node: true,
      },
    },
    rules: {
      'import/no-restricted-paths': ['error', { zones: layerZones }],
    },
  },
  {
    files: ['src/domain/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            ...telegramStack,
            { name: '@office-kit/xlsx', message: 'domain не знает про Excel' },
            { name: 'node-pg-migrate', message: 'domain не знает про миграции' },
          ],
          patterns: ['grammy/*', 'pg/*', 'kysely/*'],
        },
      ],
    },
  },
  {
    files: ['src/infrastructure/repositories/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '../db/pool.js',
              message: 'репозитории получают tx из UnitOfWork, не пул',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['src/application/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            { name: 'grammy', message: 'application не знает про Telegram' },
            { name: 'pg', message: 'application не пишет SQL' },
            { name: 'kysely', message: 'application обращается к БД только через порты' },
          ],
          patterns: ['grammy/*', 'pg/*', 'kysely/*'],
        },
      ],
    },
  },
);
