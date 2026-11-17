import path from 'path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { tutorPlugin } from './server/tutor/plugin';
import { bugReportPlugin } from './server/bugreport/plugin';
import { execSync } from 'child_process';

function commitId(): string {
  try { return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch { return 'unknown'; }
}

export default defineConfig(() => {
    return {
      server: {
        port: 3000,
        host: '0.0.0.0',
      },
      plugins: [react(), tutorPlugin(), bugReportPlugin()],
      define: { __APP_COMMIT__: JSON.stringify(commitId()) },
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      }
    };
});
