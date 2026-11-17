import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { createServer as createViteServer } from 'vite';
import 'dotenv/config';
import { getDb } from './server/db/database.ts';
import { seedDatabase } from './server/db/seed.ts';
import { scanConflicts } from './server/services/conflictEngine.ts';
import { runOptimization } from './server/services/optimizer.ts';
import { createApiRouter } from './server/routes/api.ts';

async function bootstrap() {
  // Initialize SQLite & seed synthetic corridor on first launch
  getDb();
  const seedOut = seedDatabase(false);
  const optCount = (getDb().prepare('SELECT COUNT(*) as c FROM optimization_runs').get() as { c: number }).c;
  if (seedOut.seeded || optCount === 0) {
    scanConflicts('ORIGINAL', true);
    runOptimization({ persist: true });
  }

  const app = express();
  app.use(express.json({ limit: '5mb' }));

  app.use('/api/v1', createApiRouter());

  const isProd = process.env.NODE_ENV === 'production' && fs.existsSync(path.resolve(process.cwd(), 'dist'));
  if (isProd) {
    const distPath = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  } else {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  const port = Number(process.env.PORT || 3000);
  app.listen(port, '0.0.0.0', () => {
    console.log(`RailSmart AI server listening on http://0.0.0.0:${port}`);
  });
}

bootstrap().catch((err) => {
  console.error('Failed to start RailSmart AI:', err);
  process.exit(1);
});
