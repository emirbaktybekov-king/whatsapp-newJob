import { Pool } from "pg";
import dotenv from "dotenv";

// Load appropriate .env based on NODE_ENV
dotenv.config({
  path: process.env.NODE_ENV === "production" ? ".env.production" : ".env.development",
});

const isProduction = process.env.NODE_ENV === "production";

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: isProduction
    ? { rejectUnauthorized: false } 
    : false,                        
});
