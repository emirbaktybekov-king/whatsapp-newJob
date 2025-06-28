import puppeteer, { Browser, Page } from 'puppeteer';
import path from 'path';
import fs from 'fs';
import { Client, LocalAuth, Message } from 'whatsapp-web.js';
import { WebSocketServer } from 'ws';
import { pool } from '../database/postgres';
import { wait } from '../helpers/utils';

// Determine environment (Render.com sets RENDER=true)
const isRender = process.env.RENDER === 'true';
const baseDir = isRender ? '/app' : path.join(__dirname, '../..');
const screenshotsDir = isRender ? '/app/screenshots' : path.join(baseDir, 'screenshots');
const sessionDir = isRender ? '/app/whatsapp_session' : path.join(baseDir, 'whatsapp_session');

// Ensure directories exist
if (!fs.existsSync(screenshotsDir)) {
  fs.mkdirSync(screenshotsDir, { recursive: true });
  console.log(`Created screenshots directory: ${screenshotsDir}`);
}
if (!fs.existsSync(sessionDir)) {
  fs.mkdirSync(sessionDir, { recursive: true });
  console.log(`Created session directory: ${sessionDir}`);
}

interface QRResponse {
  success: boolean;
  qrUrl?: string;
  path?: string;
  error?: string;
  dbError?: string;
}

interface MessageData {
  id: number;
  from_number: string;
  to_number: string;
  body: string;
  from_me: boolean;
  timestamp: number;
  chat_name: string;
  contact_name: string;
}

let browser: Browser | null = null;
let page: Page | null = null;
let isCapturingQR = false;
let latestQr: { qrUrl: string; path: string; timestamp: number } | null = null;

const client = new Client({
  authStrategy: new LocalAuth({
    dataPath: sessionDir,
  }),
  puppeteer: {
    headless: true,
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--disable-gpu',
      '--user-agent=Mozilla/5.0 (Macintosh; Intel Mac OS X 14_6_1) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36',
    ],
    timeout: 120000,
  },
});

interface ExtendedMessage extends Message {
  notifyName?: string;
}

export async function initializeWhatsAppClient(wss: WebSocketServer) {
  client.on('ready', async () => {
    console.log('WhatsApp client is ready!');
    let userName = 'WhatsApp User';
    try {
      const info = await client.getState();
      if (info === 'CONNECTED') {
        const chats = await client.getChats();
        userName = chats[0]?.name || 'WhatsApp User';
      }
    } catch (error) {
      console.log('Failed to retrieve username');
    }
    wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(
          JSON.stringify({
            type: 'authenticated',
            data: {
              userName,
              timestamp: Date.now(),
            },
          })
        );
      }
    });
  });

  client.on('message', async (message: ExtendedMessage) => {
    try {
      if (message.body === '!ping') {
        await message.reply('Pong!');
      }

      const tableCheck = await pool.query(`
        SELECT EXISTS (
          SELECT FROM information_schema.tables 
          WHERE table_schema = 'public' 
          AND table_name = 'messages'
        );
      `);

      if (!tableCheck.rows[0].exists) {
        await pool.query(`
          CREATE TABLE messages (
            id SERIAL PRIMARY KEY,
            from_number VARCHAR(255),
            to_number VARCHAR(255),
            body TEXT,
            from_me BOOLEAN,
            timestamp BIGINT,
            chat_name VARCHAR(255),
            contact_name VARCHAR(255)
          );
        `);
        console.log('messages table created');
      }

      const chatName = message.notifyName || '';
      const contactName = message.notifyName || '';

      const result = await pool.query(
        `
        INSERT INTO messages (from_number, to_number, body, from_me, timestamp, chat_name, contact_name)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING id
      `,
        [
          message.from,
          message.to,
          message.body,
          message.fromMe,
          Math.floor(Date.now() / 1000),
          chatName,
          contactName,
        ]
      );

      console.log(`Message saved to database with ID: ${result.rows[0].id}`);

      wss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
          client.send(
            JSON.stringify({
              type: 'new_message',
              data: {
                from: message.from,
                to: message.to,
                body: message.body,
                fromMe: message.fromMe,
                timestamp: Date.now(),
                chatName,
                contactName,
              },
            })
          );
        }
      });
    } catch (error) {
      console.error('Error processing message:', error);
    }
  });

  await client.initialize();
}

export async function captureWhatsAppQR(refresh: boolean = false, wss: WebSocketServer): Promise<QRResponse> {
  console.log(`Using PUPPETEER_EXECUTABLE_PATH: ${process.env.PUPPETEER_EXECUTABLE_PATH}`);
  if (isCapturingQR) {
    console.log('QR code capture process already started, please wait...');
    return latestQr
      ? { success: true, qrUrl: latestQr.qrUrl, path: latestQr.path }
      : { success: false, error: 'Process already started' };
  }

  if (refresh) {
    await client.logout();
  }

  isCapturingQR = true;
  console.log('Starting WhatsApp QR code capture...');

  try {
    await pool.query('UPDATE screenshot_qr SET is_active = FALSE WHERE is_active = TRUE');
  } catch (dbError) {
    console.error('Error deactivating old QR codes:', dbError);
  }

  try {
    if (browser) {
      try {
        await browser.close();
      } catch (closeError) {
        console.error('Error closing previous browser session:', closeError);
      }
      browser = null;
      page = null;
    }

    browser = await puppeteer.launch({
      headless: true,
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--disable-gpu',
        '--user-agent=Mozilla/5.0 (Macintosh; Intel Mac OS X 14_6_1) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36',
      ],
    });
    page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 720 });

    console.log('Navigating to https://web.whatsapp.com/...');
    try {
      await page.goto('https://web.whatsapp.com/', {
        waitUntil: 'networkidle2',
        timeout: 180000,
      });
    } catch (gotoError: any) {
      console.error('Error loading WhatsApp Web:', gotoError);
      isCapturingQR = false;
      return { success: false, error: `Failed to load page: ${gotoError.message}` };
    }

    console.log('Waiting 10 seconds for QR code to load...');
    await wait(10000);

    const timestamp = Date.now();
    const screenshotUrl = `/screenshots/qr_${timestamp}.png`;
    const screenshotPath = path.join(screenshotsDir, `qr_${timestamp}.png`);
    console.log(`Attempting to save screenshot to: ${screenshotPath}`);

    try {
      await page.screenshot({ path: screenshotPath as `qr_${string}.png`, fullPage: true });
      console.log(`QR code screenshot saved: ${screenshotPath}`);

      if (fs.existsSync(screenshotPath)) {
        const stats = fs.statSync(screenshotPath);
        console.log(`Screenshot file created, size: ${stats.size} bytes`);
      } else {
        console.error('Screenshot file was not created!');
        isCapturingQR = false;
        return { success: false, error: 'Screenshot file was not created' };
      }
    } catch (screenshotError: any) {
      console.error('Error capturing screenshot:', screenshotError);
      isCapturingQR = false;
      return { success: false, error: `Failed to capture screenshot: ${screenshotError.message}` };
    }

    try {
      const tableCheck = await pool.query(`
        SELECT EXISTS (
          SELECT FROM information_schema.tables 
          WHERE table_schema = 'public' 
          AND table_name = 'screenshot_qr'
        );
      `);

      if (!tableCheck.rows[0].exists) {
        await pool.query(`
          CREATE TABLE screenshot_qr (
            id SERIAL PRIMARY KEY,
            path VARCHAR(255) NOT NULL,
            url VARCHAR(255) NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            is_active BOOLEAN DEFAULT TRUE
          );
        `);
        console.log('screenshot_qr table created');
      }

      const result = await pool.query(
        `
        INSERT INTO screenshot_qr (path, url, created_at, is_active)
        VALUES ($1, $2, NOW(), TRUE)
        RETURNING id
      `,
        [screenshotPath, screenshotUrl]
      );

      console.log(`Database entry added with ID: ${result.rows[0].id}`);

      latestQr = { qrUrl: screenshotUrl, path: screenshotPath, timestamp };

      await startAuthCheck(wss);

      return {
        success: true,
        qrUrl: screenshotUrl,
        path: screenshotPath,
      };
    } catch (dbError: any) {
      console.error('Error saving to database:', dbError);
      latestQr = { qrUrl: screenshotUrl, path: screenshotPath, timestamp };
      return {
        success: true,
        qrUrl: screenshotUrl,
        path: screenshotPath,
        dbError: dbError.message,
      };
    }
  } catch (error: any) {
    console.error('Error capturing QR code:', error);
    return {
      success: false,
      error: error.message,
    };
  } finally {
    isCapturingQR = false;
  }
}

async function startAuthCheck(wss: WebSocketServer) {
  try {
    if (!browser) {
      browser = await puppeteer.launch({
        headless: true,
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--disable-gpu',
          '--user-agent=Mozilla/5.0 (Macintosh; Intel Mac OS X 14_6_1) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36',
        ],
      });
    }
    if (!page) {
      page = await browser.newPage();
      await page.setViewport({ width: 1280, height: 720 });
      await page.goto('https://web.whatsapp.com/', { waitUntil: 'networkidle2', timeout: 180000 });
    }

    console.log('Starting authentication monitoring...');

    const checkInterval = setInterval(async () => {
      if (!page) {
        clearInterval(checkInterval);
        return;
      }

      try {
        const isAuthenticated = await page.evaluate(() => {
          return document.querySelector('div[data-testid="chat-list"]') !== null;
        });

        if (isAuthenticated) {
          console.log('User authenticated in WhatsApp Web!');

          let userName: string = 'WhatsApp User';
          try {
            const nameElement = await page.evaluate(() => {
              const element = document.querySelector('span[data-testid="default-user"]');
              return element ? element.textContent : null;
            });
            if (nameElement) {
              userName = nameElement;
            }
          } catch (nameError) {
            console.log('Failed to retrieve username');
          }

          wss.clients.forEach((client) => {
            if (client.readyState === WebSocket.OPEN) {
              client.send(
                JSON.stringify({
                  type: 'authenticated',
                  data: {
                    userName,
                    timestamp: Date.now(),
                  },
                })
              );
            }
          });

          clearInterval(checkInterval);
          if (browser) {
            await browser.close();
            browser = null;
            page = null;
          }
        }
      } catch (error) {
        console.error('Error checking authentication:', error);
      }
    }, 5000);
  } catch (error) {
    console.error('Error launching Puppeteer for authentication check:', error);
  }
}

export async function getLatestQR(): Promise<QRResponse> {
  try {
    const result = await pool.query(`
      SELECT url FROM screenshot_qr 
      WHERE is_active = TRUE 
      ORDER BY created_at DESC 
      LIMIT 1
    `);
    if (result.rows.length > 0) {
      return { success: true, qrUrl: result.rows[0].url };
    } else if (latestQr) {
      return { success: true, qrUrl: latestQr.qrUrl };
    } else {
      return { success: false, error: 'QR code not found' };
    }
  } catch (error: any) {
    console.error('Error retrieving latest QR code:', error);
    if (latestQr) {
      return { success: true, qrUrl: latestQr.qrUrl };
    } else {
      return { success: false, error: error.message };
    }
  }
}

export async function getMessages(limit: number): Promise<MessageData[]> {
  try {
    const result = await pool.query(
      `
      SELECT * FROM messages 
      ORDER BY timestamp DESC 
      LIMIT $1
    `,
      [limit]
    );
    return result.rows;
  } catch (error: any) {
    console.error('Error retrieving messages:', error);
    throw error;
  }
}

export async function sendMessage(to: string, body: string) {
  await client.sendMessage(`${to}@c.us`, body);
}

export async function logout() {
  if (browser) {
    await browser.close();
    browser = null;
    page = null;
  }
  await client.logout();
  isCapturingQR = false;
  latestQr = null;
}