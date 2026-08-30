import path from 'path';

const buildEslintCommand = (filenames) =>
  `eslint --fix ${filenames.map((f) => path.relative(process.cwd(), f)).join(' ')}`;

const buildPrettierCommand = (filenames) =>
  `prettier --write ${filenames
    .map((f) => path.relative(process.cwd(), f))
    .join(' ')}`;

const lintStagedConfig = {
  '*.{js,jsx,ts,tsx}': [buildEslintCommand],
  '**/*.{ts,js,tsx,jsx,css,json}': [buildPrettierCommand],
};

export default lintStagedConfig;
