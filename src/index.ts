import { buildApp } from './app.js';
import { config } from './config.js';

const app = buildApp();

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
