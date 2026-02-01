import 'dotenv/config';

export const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  host: process.env.HOST || '0.0.0.0',
  hereApiKey: process.env.HERE_API_KEY || '',
} as const;
