import { Pool } from 'pg';

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: false, // Force disable SSL for local development
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});