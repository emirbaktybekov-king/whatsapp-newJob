"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.pool = void 0;
const pg_1 = require("pg");
const dotenv_1 = __importDefault(require("dotenv"));
// Load appropriate .env based on NODE_ENV
dotenv_1.default.config({
    path: process.env.NODE_ENV === "production" ? ".env.production" : ".env.development",
});
const isProduction = process.env.NODE_ENV === "production";
exports.pool = new pg_1.Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: isProduction
        ? { rejectUnauthorized: false }
        : false,
});
