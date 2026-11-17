import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
// Default environment is node. A test file that needs the DOM starts with:  // @vitest-environment jsdom
export default defineConfig({ plugins: [react()], test: { include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx', 'src/**/*.test.ts', 'src/**/*.test.tsx'], environment: 'node' } });
