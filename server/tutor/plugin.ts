import type { Plugin } from 'vite';
import { loadEnv } from 'vite';
import { handleTutorRequest } from './router';

export interface TutorPluginOptions {
  envDir?: string;
}

export function tutorPlugin(options: TutorPluginOptions = {}): Plugin {
  const middleware = async (req: any, res: any, next: any) => {
    if (req.method !== 'POST' && req.method !== 'GET') {
      return next();
    }

    try {
      const env = loadEnv('', options.envDir || process.cwd(), '');
      await handleTutorRequest(req, res, env);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ success: false, error: msg, failureKind: 'unavailable' }));
    }
  };

  return {
    name: 'tutor-server-plugin',
    configureServer(server) {
      server.middlewares.use('/api/tutor', middleware);
    },
    configurePreviewServer(server) {
      server.middlewares.use('/api/tutor', middleware);
    },
  };
}
