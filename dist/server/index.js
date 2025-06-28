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
dotenv_1.default.config({
    path: process.env.NODE_ENV === 'production' ? '.env.production' : '.env.development',
});
const whatsappController_1 = require("./controllers/whatsappController");
const websocket_1 = require("./helpers/websocket");
const postgres_1 = require("./database/postgres");
const routes_1 = __importDefault(require("./routes"));
const app = (0, express_1.default)();
const server = http_1.default.createServer(app);
const wss = new ws_1.WebSocketServer({ server });
app.locals.wss = wss;
const isProduction = process.env.NODE_ENV === 'production';
const baseDir = isProduction ? path_1.default.join(__dirname, '../..') : path_1.default.join(__dirname, '..');
const srcDir = path_1.default.join(baseDir, 'src');
const screenshotsDir = path_1.default.join(baseDir, 'screenshots');
if (!fs_1.default.existsSync(screenshotsDir)) {
    fs_1.default.mkdirSync(screenshotsDir, { recursive: true });
    console.log(`Created screenshots directory: ${screenshotsDir}`);
}
app.use(express_1.default.json());
app.use(express_1.default.static(srcDir));
app.use('/screenshots', express_1.default.static(screenshotsDir));
app.use('/lang', express_1.default.static(path_1.default.join(srcDir, 'lang')));
(0, routes_1.default)(app);
(0, websocket_1.setupWebSocket)(wss);
async function startServer() {
    try {
        const clientDb = await postgres_1.pool.connect();
        console.log('Database connection successful');
        clientDb.release();
        const indexPath = path_1.default.join(srcDir, 'index.html');
        if (!fs_1.default.existsSync(indexPath)) {
            console.error(`Error: File ${indexPath} not found`);
            process.exit(1);
        }
        await (0, whatsappController_1.initializeWhatsAppClient)(wss);
        const PORT = parseInt(process.env.PORT || '3000', 10);
        server.listen(PORT, () => {
            console.log(`Server started on port ${PORT}`);
            console.log(`Interface available at: http://localhost:${PORT}/web/page`);
        });
    }
    catch (error) {
        console.error('Error starting server:', error);
        process.exit(1);
    }
}
process.on('SIGINT', async () => {
    console.log('Shutting down...');
    try {
        await postgres_1.pool.end();
        console.log('Database pool closed');
    }
    catch (error) {
        console.error('Error closing database pool:', error);
    }
    server.close();
    console.log('Server closed');
    process.exit(0);
});
process.on('SIGTERM', async () => {
    console.log('Shutting down due to SIGTERM...');
    try {
        await postgres_1.pool.end();
        console.log('Database pool closed');
    }
    catch (error) {
        console.error('Error closing database pool:', error);
    }
    server.close();
    console.log('Server closed');
    process.exit(0);
});
startServer();
