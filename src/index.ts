import { buildApp } from './app.js';
import { config } from './config.js';
import { createHereService } from './here/index.js';

// Initialize HERE service if API key is available
let hereService;
if (config.hereApiKey) {
  hereService = createHereService({ apiKey: config.hereApiKey });
  console.log('HERE API service initialized');
} else {
  console.warn('WARNING: HERE_API_KEY not set. /api/route-facts endpoint will not be available.');
}

const app = buildApp({ hereService });

const start = async () => {
  try {
    await app.listen({ port: config.port, host: config.host });
    console.log(`Server running at http://${config.host}:${config.port}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
};

start();
