import { defineConfig } from 'vitest/config';
import path from 'path';

/*
  🔴 THE COVERAGE SCOPE USED TO BE AN ACCIDENT OF AN EXCLUDE GLOB, and the
  accident pointed the thresholds away from the risk: `'src/app/**'` was written
  for page and layout components and it also removed all 75 API route handlers,
  while an unset `include` meant an untested file was absent from the
  denominator rather than a zero in it. The scope is now declared in
  `lib/ops/coverage-scope.ts`, which carries the whole finding, the figures
  measured before it was widened, and the reason each unmeasured area is out.
  `lib/ops/coverage-scope.test.ts` holds it to that.
*/
import {
  COVERAGE_INCLUDE,
  COVERAGE_EXCLUDE,
} from './lib/ops/coverage-scope';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'lib/**/*.test.ts'],
    // Declares which environment the assertions are about. See vitest.setup.ts.
    setupFiles: ['./vitest.setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 70,
        statements: 80,
      },
      include: COVERAGE_INCLUDE,
      exclude: COVERAGE_EXCLUDE,
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
