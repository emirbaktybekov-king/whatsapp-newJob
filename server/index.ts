import dotenv from "dotenv";
dotenv.config();

import express, { Express } from "express";
import http from "http";
import { WebSocketServer } from "ws";
import path from "path";
import fs from "fs";
import { initializeWhatsAppClient } from "./controllers/whatsappController";
import { setupWebSocket } from "./helpers/websocket";
import { pool } from "./database/postgres";
import setupRoutes from "./routes";



const app: Express = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

// Store wss in app.locals for access in routes
app.locals.wss = wss;

const srcDir = path.join(__dirname, "../src");
const screenshotsDir = path.join(__dirname, "../screenshots");

// Create necessary directories
if (!fs.existsSync(screenshotsDir)) {
  fs.mkdirSync(screenshotsDir, { recursive: true });
  console.log(`Created screenshots directory: ${screenshotsDir}`);
}

if (!fs.existsSync(srcDir)) {
  fs.mkdirSync(srcDir, { recursive: true });
  console.log(`Created src directory: ${srcDir}`);
}

// Middleware
app.use(express.json());
app.use(express.static(srcDir));
app.use("/screenshots", express.static(screenshotsDir));
app.use("/lang", express.static(path.join(srcDir, "lang")));

// Setup routes
setupRoutes(app);

// WebSocket setup
setupWebSocket(wss);

// Start server
async function startServer() {
  try {
    // Check database connection
    const clientDb = await pool.connect();
    console.log("Database connection successful");
    clientDb.release();

    // Check for src/index.html
    const indexPath = path.join(srcDir, "index.html");
    if (!fs.existsSync(indexPath)) {
      console.error(`Error: File ${indexPath} not found`);
      process.exit(1);
    }

    // Initialize WhatsApp client
    await initializeWhatsAppClient(wss);

    // Start server
    const PORT = parseInt(process.env.PORT || "3000", 10);
    server.listen(PORT, "0.0.0.0", () => {
      console.log(`Server started on port ${PORT}`);
      console.log(`Interface available at: http://localhost:${PORT}/web/page`);
    });
  } catch (error) {
    console.error("Error starting server:", error);
    process.exit(1);
  }
}

process.on("SIGINT", async () => {
  console.log("Shutting down...");
  try {
    await pool.end();
    console.log("Database pool closed");
  } catch (error) {
    console.error("Error closing database pool:", error);
  }
  server.close();
  console.log("Server closed");
  process.exit(0);
});

// Start server
startServer();
