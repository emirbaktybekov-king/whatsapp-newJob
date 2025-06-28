"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = setupRoutes;
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const whatsappController_1 = require("../controllers/whatsappController");
function setupRoutes(app) {
    // API to get QR code
    app.post("/api/get-qr", async (req, res) => {
        try {
            console.log("Received QR code request");
            const result = await (0, whatsappController_1.captureWhatsAppQR)(false, app.locals.wss);
            res.json(result);
        }
        catch (error) {
            console.error("Error processing QR code request:", error);
            res.status(500).json({
                success: false,
                error: error.message,
            });
        }
    });
    app.get("/api/latest-qr", async (req, res) => {
        try {
            const result = await (0, whatsappController_1.getLatestQR)();
            res.json(result);
        }
        catch (error) {
            console.error("Error retrieving latest QR code:", error);
            res.status(500).json({
                success: false,
                error: error.message,
            });
        }
    });
    app.get("/api/messages", async (req, res) => {
        try {
            const limit = parseInt(req.query.limit) || 10;
            const messages = await (0, whatsappController_1.getMessages)(limit);
            res.json(messages);
        }
        catch (error) {
            console.error("Error retrieving messages:", error);
            res.status(500).json({
                success: false,
                error: error.message,
            });
        }
    });
    app.post("/api/refresh-qr", async (req, res) => {
        try {
            const result = await (0, whatsappController_1.captureWhatsAppQR)(true, app.locals.wss);
            res.json(result);
        }
        catch (error) {
            console.error("Error refreshing QR code:", error);
            res.status(500).json({
                success: false,
                error: error.message,
            });
        }
    });
    app.post("/api/scan-qr", async (req, res) => {
        res.json({
            success: true,
            message: "QR code scan initiated (handled by client)",
        });
    });
    app.post("/api/logout", async (req, res) => {
        try {
            await (0, whatsappController_1.logout)();
            res.json({ success: true });
        }
        catch (error) {
            console.error("Error logging out:", error);
            res.status(500).json({
                success: false,
                error: error.message,
            });
        }
    });
    //@ts-ignore
    app.post("/api/send-message", async (req, res) => {
        try {
            const { to, body } = req.body;
            if (!to || !body) {
                return res
                    .status(400)
                    .json({ success: false, error: "Missing to or body" });
            }
            await (0, whatsappController_1.sendMessage)(to, body);
            res.json({ success: true });
        }
        catch (error) {
            console.error("Error sending message:", error);
            res.status(500).json({
                success: false,
                error: error.message,
            });
        }
    });
    // Serve frontend
    app.get("/web/page", (req, res) => {
        const filePath = path_1.default.join(__dirname, "../../src", "index.html");
        console.log(`Attempting to serve file: ${filePath}`);
        if (fs_1.default.existsSync(filePath)) {
            res.sendFile(filePath);
        }
        else {
            console.error(`File not found: ${filePath}`);
            res.status(404).send("Error: index.html not found in src directory");
        }
    });
    // Redirect root to /web/page
    app.get("/", (req, res) => {
        return res.redirect("/web/page");
    });
}
