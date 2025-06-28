"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const http_1 = __importDefault(require("http"));
const ws_1 = require("ws");
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const dotenv_1 = __importDefault(require("dotenv"));
const whatsappController_1 = require("./controllers/whatsappController");
const websocket_1 = require("./helpers/websocket");
const postgres_1 = require("./database/postgres");
const routes_1 = __importDefault(require("./routes"));
dotenv_1.default.config();
const app = (0, express_1.default)();
const server = http_1.default.createServer(app);
const wss = new ws_1.WebSocketServer({ server });
// Store wss in app.locals for access in routes
app.locals.wss = wss;
const srcDir = path_1.default.join(__dirname, "../../src");
const screenshotsDir = path_1.default.join(__dirname, "../../screenshots");
// Create necessary directories
if (!fs_1.default.existsSync(screenshotsDir)) {
    fs_1.default.mkdirSync(screenshotsDir, { recursive: true });
    console.log(`Created screenshots directory: ${screenshotsDir}`);
}
if (!fs_1.default.existsSync(srcDir)) {
    fs_1.default.mkdirSync(srcDir, { recursive: true });
    console.log(`Created src directory: ${srcDir}`);
}
// Middleware
app.use(express_1.default.json());
app.use(express_1.default.static(srcDir));
app.use("/screenshots", express_1.default.static(screenshotsDir));
app.use("/lang", express_1.default.static(path_1.default.join(srcDir, "lang")));
// Setup routes
(0, routes_1.default)(app);
// WebSocket setup
(0, websocket_1.setupWebSocket)(wss);
// Start server
async function startServer() {
    try {
        // Check database connection
        const clientDb = await postgres_1.pool.connect();
        console.log("Database connection successful");
        clientDb.release();
        // Check for src/index.html
        const indexPath = path_1.default.join(srcDir, "index.html");
        if (!fs_1.default.existsSync(indexPath)) {
            console.error(`Error: File ${indexPath} not found`);
            process.exit(1);
        }
        // Initialize WhatsApp client
        await (0, whatsappController_1.initializeWhatsAppClient)(wss);
        // Start server
        const PORT = parseInt(process.env.PORT || "3000", 10);
        server.listen(PORT, () => {
            console.log(`Server started on port ${PORT}`);
            console.log(`Interface available at: http://localhost:${PORT}/web/page`);
        });
    }
    catch (error) {
        console.error("Error starting server:", error);
        process.exit(1);
    }
}
process.on("SIGINT", async () => {
    console.log("Shutting down...");
    try {
        await postgres_1.pool.end();
        console.log("Database pool closed");
    }
    catch (error) {
        console.error("Error closing database pool:", error);
    }
    server.close();
    console.log("Server closed");
    process.exit(0);
});
process.on("SIGTERM", async () => {
    console.log("Shutting down due to SIGTERM...");
    try {
        await postgres_1.pool.end();
        console.log("Database pool closed");
    }
    catch (error) {
        console.error("Error closing database pool:", error);
    }
    server.close();
    console.log("Server closed");
    process.exit(0);
});
// Start server
startServer();
