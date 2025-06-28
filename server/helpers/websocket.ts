import { WebSocketServer, WebSocket } from 'ws';
import { captureWhatsAppQR } from '../controllers/whatsappController';

interface WebSocketMessage {
  type: string;
  id?: number;
}

export function setupWebSocket(wss: WebSocketServer) {
  wss.on('connection', (ws: WebSocket) => {
    console.log('New WebSocket connection');
    ws.on('message', async (message: string) => {
      try {
        const data: WebSocketMessage = JSON.parse(message);
        console.log('Received client message:', data);
        if (data.type === 'get_qr') {
          console.log('QR code request via WebSocket');
          const result = await captureWhatsAppQR(false, wss); // Pass wss
          ws.send(
            JSON.stringify({
              type: 'response',
              id: data.id || 0,
              success: result.success,
              data: result,
            })
          );
        }
      } catch (error) {
        console.error('Error processing WebSocket message:', error);
      }
    });
  });
}