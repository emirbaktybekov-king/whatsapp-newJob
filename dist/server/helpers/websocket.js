"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.setupWebSocket = setupWebSocket;
const whatsappController_1 = require("../controllers/whatsappController");
function setupWebSocket(wss) {
    wss.on('connection', (ws) => {
        console.log('New WebSocket connection');
        ws.on('message', async (message) => {
            try {
                const data = JSON.parse(message);
                console.log('Received client message:', data);
                if (data.type === 'get_qr') {
                    console.log('QR code request via WebSocket');
                    const result = await (0, whatsappController_1.captureWhatsAppQR)(false, wss);
                    ws.send(JSON.stringify({
                        type: 'response',
                        id: data.id || 0,
                        success: result.success,
                        data: result,
                    }));
                }
            }
            catch (error) {
                console.error('Error processing WebSocket message:', error);
            }
        });
    });
}
