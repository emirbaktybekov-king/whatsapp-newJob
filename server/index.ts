import express, { Express } from "express";
import http from "http";
import { WebSocketServer } from "ws";
import path from "path";
import fs from "fs";
import dotenv from "dotenv";

dotenv.config({
  path:
    process.env.NODE_ENV === "production"
      ? ".env.production"
      : ".env.development",
});

import { initializeWhatsAppClient } from "./controllers/whatsappController";
import { setupWebSocket } from "./helpers/websocket";
import { pool } from "./database/postgres";
import setupRoutes from "./routes";

const app: Express = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

app.locals.wss = wss;

const isProduction = process.env.NODE_ENV === "production";
const baseDir = process.cwd(); 
const screenshotsDir = isProduction
  ? path.join(baseDir, "dist/screenshots")
  : path.join(baseDir, "screenshots");
const srcDir = path.join(baseDir, "src");

if (!fs.existsSync(screenshotsDir)) {
  fs.mkdirSync(screenshotsDir, { recursive: true });
  console.log(`Created screenshots directory: ${screenshotsDir}`);
}

app.use(express.json());
app.use(express.static(srcDir));
app.use("/screenshots", express.static(screenshotsDir));
app.use("/lang", express.static(path.join(srcDir, "lang")));

setupRoutes(app);

setupWebSocket(wss);

async function startServer() {
  try {
    const clientDb = await pool.connect();
    console.log("Database connection successful");
    clientDb.release();

    const indexPath = path.join(srcDir, "index.html");
    if (!fs.existsSync(indexPath)) {
      console.error(`Error: File ${indexPath} not found`);
      process.exit(1);
    }

    await initializeWhatsAppClient(wss);

    const PORT = parseInt(process.env.PORT || "3000", 10);
    const HOST = "0.0.0.0"; // Explicitly bind to 0.0.0.0 for Render.com
    server.listen(PORT, HOST, () => {
      console.log(`Server started on http://${HOST}:${PORT}`);
      console.log(`Environment: ${process.env.NODE_ENV}`);
      console.log(`Screenshots path: ${screenshotsDir}`);
      console.log(`Interface available at: http://${HOST}:${PORT}/web/page`);
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

process.on("SIGTERM", async () => {
  console.log("Shutting down due to SIGTERM...");
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

startServer();
