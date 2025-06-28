import { Express, Request, Response } from "express";
import path from "path";
import fs from "fs";
import {
  captureWhatsAppQR,
  sendMessage,
  logout,
  getMessages,
  getLatestQR,
} from "../controllers/whatsappController";

export default function setupRoutes(app: Express) {
  // API to get QR code
  app.post("/api/get-qr", async (req: Request, res: Response) => {
    try {
      console.log("Received QR code request");
      const result = await captureWhatsAppQR(false, app.locals.wss);
      res.json(result);
    } catch (error: any) {
      console.error("Error processing QR code request:", error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  app.get("/api/latest-qr", async (req: Request, res: Response) => {
    try {
      const result = await getLatestQR();
      res.json(result);
    } catch (error: any) {
      console.error("Error retrieving latest QR code:", error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  app.get("/api/messages", async (req: Request, res: Response) => {
    try {
      const limit = parseInt(req.query.limit as string) || 10;
      const messages = await getMessages(limit);
      res.json(messages);
    } catch (error: any) {
      console.error("Error retrieving messages:", error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  app.post("/api/refresh-qr", async (req: Request, res: Response) => {
    try {
      const result = await captureWhatsAppQR(true, app.locals.wss);
      res.json(result);
    } catch (error: any) {
      console.error("Error refreshing QR code:", error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  app.post("/api/scan-qr", async (req: Request, res: Response) => {
    res.json({
      success: true,
      message: "QR code scan initiated (handled by client)",
    });
  });

  app.post("/api/logout", async (req: Request, res: Response) => {
    try {
      await logout();
      res.json({ success: true });
    } catch (error: any) {
      console.error("Error logging out:", error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  //@ts-ignore
  app.post("/api/send-message", async (req: Request, res: Response) => {
    try {
      const { to, body } = req.body;
      if (!to || !body) {
        return res
          .status(400)
          .json({ success: false, error: "Missing to or body" });
      }
      await sendMessage(to, body);
      res.json({ success: true });
    } catch (error: any) {
      console.error("Error sending message:", error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  // Serve frontend
  app.get("/web/page", (req: Request, res: Response) => {
    const filePath = path.join(__dirname, "../../src", "index.html");
    console.log(`Attempting to serve file: ${filePath}`);
    if (fs.existsSync(filePath)) {
      res.sendFile(filePath);
    } else {
      console.error(`File not found: ${filePath}`);
      res.status(404).send("Error: index.html not found in src directory");
    }
  });

  // Redirect root to /web/page
  app.get("/", (req: Request, res: Response) => {
    return res.redirect("/web/page");
  });
}
