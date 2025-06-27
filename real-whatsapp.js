require('dotenv').config();
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const fs = require('fs');
const puppeteer = require('puppeteer');
const { Pool } = require('pg');
const { Client, LocalAuth } = require('whatsapp-web.js');

// Create Express app
const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Configure PostgreSQL database connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL.includes('sslmode=disable') || process.env.DATABASE_URL.includes('localhost') ? false : { rejectUnauthorized: false },
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

// WhatsApp client
const client = new Client({
  authStrategy: new LocalAuth({
    dataPath: path.resolve(__dirname, 'whatsapp_session'),
  }),
  puppeteer: {
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--disable-gpu',
      '--user-agent=Mozilla/5.0 (Macintosh; Intel Mac OS X 14_6_1) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36'
    ],
    timeout: 120000,
  },
});

// Create necessary directories
const screenshotsDir = path.join(__dirname, 'screenshots');
if (!fs.existsSync(screenshotsDir)) {
  fs.mkdirSync(screenshotsDir, { recursive: true });
  console.log(`Created screenshots directory: ${screenshotsDir}`);
}

const srcDir = path.join(__dirname, 'src');
if (!fs.existsSync(srcDir)) {
  fs.mkdirSync(srcDir, { recursive: true });
  console.log(`Created src directory: ${srcDir}`);
}

// Middleware
app.use(express.json());
app.use(express.static(srcDir));
app.use('/screenshots', express.static(screenshotsDir));

// Global variables
let browser = null;
let page = null;
let isCapturingQR = false;
let latestQr = null;

// WebSocket broadcast
function broadcast(message) {
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(message));
    }
  });
}

// Function to capture QR code using Puppeteer with XPath
async function captureWhatsAppQR() {
  if (isCapturingQR) {
    console.log('QR code capture process already started, please wait...');
    return latestQr ? { success: true, qrUrl: latestQr.qrUrl, path: latestQr.path } : { success: false, error: 'Process already started' };
  }

  isCapturingQR = true;
  console.log('Starting WhatsApp QR code capture...');

  // Deactivate old QR codes
  try {
    await pool.query('UPDATE screenshot_qr SET is_active = FALSE WHERE is_active = TRUE');
  } catch (dbError) {
    console.error('Error deactivating old QR codes:', dbError);
  }

  try {
    // Close previous browser if open
    if (browser) {
      try {
        await browser.close();
      } catch (closeError) {
        console.error('Error closing previous browser session:', closeError);
      }
      browser = null;
      page = null;
    }

    // Launch Puppeteer
    browser = await puppeteer.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--disable-gpu',
        '--user-agent=Mozilla/5.0 (Macintosh; Intel Mac OS X 14_6_1) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36'
      ]
    });
    page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 720 });

    // Navigate to WhatsApp Web
    console.log('Navigating to https://web.whatsapp.com/...');
    try {
      await page.goto('https://web.whatsapp.com/', {
        waitUntil: 'networkidle2',
        timeout: 180000,
      });
    } catch (gotoError) {
      console.error('Error loading WhatsApp Web:', gotoError);
      isCapturingQR = false;
      return { success: false, error: `Failed to load page: ${gotoError.message}` };
    }

    // Wait for QR code
    console.log('Waiting up to 60 seconds for QR code...');
    try {
      await page.waitForXPath('//canvas[@aria-label="Scan me!"]', { timeout: 60000 });
      console.log('QR code found on page!');
    } catch (selectorError) {
      console.error('Failed to find QR code on page:', selectorError);
      const diagTimestamp = Date.now();
      const diagPath = path.join(screenshotsDir, `diag_${diagTimestamp}.png`);
      await page.screenshot({ path: diagPath });
      console.log(`Diagnostic screenshot saved: ${diagPath}`);
      isCapturingQR = false;
      return { success: false, error: `Failed to find QR code: ${selectorError.message}` };
    }

    // Capture QR code screenshot
    const timestamp = Date.now();
    const screenshotUrl = `/screenshots/qr_${timestamp}.png`;
    const screenshotPath = path.join(screenshotsDir, `qr_${timestamp}.png`);
    console.log(`Attempting to save screenshot to: ${screenshotPath}`);

    try {
      const qrElement = await page.$x('//canvas[@aria-label="Scan me!"]');
      if (qrElement.length > 0) {
        await qrElement[0].screenshot({ path: screenshotPath });
        console.log(`QR code screenshot saved: ${screenshotPath}`);

        // Verify file creation
        if (fs.existsSync(screenshotPath)) {
          const stats = fs.statSync(screenshotPath);
          console.log(`Screenshot file created, size: ${stats.size} bytes`);
        } else {
          console.error('Screenshot file was not created!');
          isCapturingQR = false;
          return { success: false, error: 'Screenshot file was not created' };
        }
      } else {
        console.error('QR code not found for screenshot');
        isCapturingQR = false;
        return { success: false, error: 'QR code not found for screenshot' };
      }
    } catch (screenshotError) {
      console.error('Error capturing screenshot:', screenshotError);
      isCapturingQR = false;
      return { success: false, error: `Failed to capture screenshot: ${screenshotError.message}` };
    }

    // Save to database
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

      const result = await pool.query(`
        INSERT INTO screenshot_qr (path, url, created_at, is_active)
        VALUES ($1, $2, NOW(), TRUE)
        RETURNING id
      `, [screenshotPath, screenshotUrl]);

      console.log(`Database entry added with ID: ${result.rows[0].id}`);

      // Save latest QR code in memory
      latestQr = { qrUrl: screenshotUrl, path: screenshotPath, timestamp: timestamp };

      // Broadcast QR code URL via WebSocket
      broadcast({
        type: 'qr_code',
        data: {
          qrUrl: screenshotUrl,
          timestamp: timestamp
        }
      });

      // Start authentication check
      await startAuthCheck();

      return {
        success: true,
        qrUrl: screenshotUrl,
        path: screenshotPath
      };
    } catch (dbError) {
      console.error('Error saving to database:', dbError);
      latestQr = { qrUrl: screenshotUrl, path: screenshotPath, timestamp: timestamp };
      return {
        success: true,
        qrUrl: screenshotUrl,
        path: screenshotPath,
        dbError: dbError.message
      };
    }
  } catch (error) {
    console.error('Error capturing QR code:', error);
    return {
      success: false,
      error: error.message
    };
  } finally {
    isCapturingQR = false;
  }
}

// Function to check authentication status
async function startAuthCheck() {
  try {
    if (!browser) {
      browser = await puppeteer.launch({
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--disable-gpu',
          '--user-agent=Mozilla/5.0 (Macintosh; Intel Mac OS X 14_6_1) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36'
        ]
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

          let userName = 'WhatsApp User';
          try {
            userName = await page.evaluate(() => {
              const nameElement = document.querySelector('span[data-testid="default-user"]');
              return nameElement ? nameElement.textContent : 'WhatsApp User';
            });
          } catch (nameError) {
            console.log('Failed to retrieve username');
          }

          broadcast({
            type: 'authenticated',
            data: {
              userName: userName,
              timestamp: Date.now()
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

client.on('ready', () => {
  console.log('WhatsApp client is ready!');
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify({
        type: 'authenticated',
        data: {
          userName: client.pushname || 'WhatsApp User',
          timestamp: Date.now()
        }
      }));
    }
  });
});

client.on('message', async (message) => {
  try {
    if (message.body === '!ping') {
      await message.reply('Pong!');
    }
    
    // Save message to database
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
    
    const result = await pool.query(`
      INSERT INTO messages (from_number, to_number, body, from_me, timestamp, chat_name, contact_name)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING id
    `, [
      message.from,
      message.to,
      message.body,
      message.fromMe,
      Math.floor(Date.now() / 1000),
      message._data.notifyName || '',
      message._data.notifyName || ''
    ]);
    
    console.log(`Message saved to database with ID: ${result.rows[0].id}`);
    
    // Broadcast message via WebSocket
    wss.clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify({
          type: 'new_message',
          data: {
            from: message.from,
            to: message.to,
            body: message.body,
            fromMe: message.fromMe,
            timestamp: Date.now(),
            chatName: message._data.notifyName || '',
            contactName: message._data.notifyName || ''
          }
        }));
      }
    });
  } catch (error) {
    console.error('Error processing message:', error);
  }
});

// API to get QR code
app.post('/api/get-qr', async (req, res) => {
  try {
    console.log('Received QR code request');
    const result = await captureWhatsAppQR();
    res.json(result);
  } catch (error) {
    console.error('Error processing QR code request:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

app.get('/api/latest-qr', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT url FROM screenshot_qr 
      WHERE is_active = TRUE 
      ORDER BY created_at DESC 
      LIMIT 1
    `);
    if (result.rows.length > 0) {
      res.json({ success: true, qrUrl: result.rows[0].url });
    } else if (latestQr) {
      res.json({ success: true, qrUrl: latestQr.qrUrl });
    } else {
      res.status(404).json({ success: false, error: 'QR code not found' });
    }
  } catch (error) {
    console.error('Error retrieving latest QR code:', error);
    if (latestQr) {
      res.json({ success: true, qrUrl: latestQr.qrUrl });
    } else {
      res.status(500).json({ success: false, error: error.message });
    }
  }
});

app.get('/api/messages', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 10;
    const result = await pool.query(`
      SELECT * FROM messages 
      ORDER BY timestamp DESC 
      LIMIT $1
    `, [limit]);
    res.json(result.rows);
  } catch (error) {
    console.error('Error retrieving messages:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

app.post('/api/refresh-qr', async (req, res) => {
  try {
    await client.logout();
    const result = await captureWhatsAppQR();
    res.json(result);
  } catch (error) {
    console.error('Error refreshing QR code:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

app.post('/api/scan-qr', async (req, res) => {
  res.json({ success: true, message: 'QR code scan initiated (handled by client)' });
});

app.post('/api/logout', async (req, res) => {
  try {
    if (browser) {
      await browser.close();
      browser = null;
      page = null;
    }
    await client.logout();
    isCapturingQR = false;
    latestQr = null;
    res.json({ success: true });
  } catch (error) {
    console.error('Error logging out:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

app.post('/api/send-message', async (req, res) => {
  try {
    const { to, body } = req.body;
    if (!to || !body) {
      return res.status(400).json({ success: false, error: 'Missing to or body' });
    }
    await client.sendMessage(`${to}@c.us`, body);
    res.json({ success: true });
  } catch (error) {
    console.error('Error sending message:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Serve frontend
app.get('/web/page', (req, res) => {
  const filePath = path.join(__dirname, 'src', 'index.html');
  console.log(`Attempting to serve file: ${filePath}`);
  if (fs.existsSync(filePath)) {
    res.sendFile(filePath);
  } else {
    console.error(`File not found: ${filePath}`);
    res.status(404).send('Error: index.html not found in src directory');
  }
});

// Redirect root to /web/page
app.get('/', (req, res) => {
  res.redirect('/web/page');
});

// WebSocket handler
wss.on('connection', ws => {
  console.log('New WebSocket connection');
  ws.on('message', async (message) => {
    try {
      const data = JSON.parse(message);
      console.log('Received client message:', data);
      if (data.type === 'get_qr') {
        console.log('QR code request via WebSocket');
        const result = await captureWhatsAppQR();
        ws.send(JSON.stringify({
          type: 'response',
          id: data.id || 0,
          success: result.success,
          data: result
        }));
      }
    } catch (error) {
      console.error('Error processing WebSocket message:', error);
    }
  });
});

// Start server
async function startServer() {
  try {
    // Check database connection
    const clientDb = await pool.connect();
    console.log('Database connection successful');
    clientDb.release();
    
    // Check for src/index.html
    const indexPath = path.join(__dirname, 'src', 'index.html');
    if (!fs.existsSync(indexPath)) {
      console.error(`Error: File ${indexPath} not found`);
      process.exit(1);
    }
    
    // Initialize WhatsApp client
    await client.initialize();
    
    // Start server
    const PORT = process.env.PORT || 3000;
    server.listen(PORT, '0.0.0.0', () => {
      console.log(`Server started on port ${PORT}`);
      console.log(`Interface available at: http://localhost:${PORT}/web/page`);
    });
  } catch (error) {
    console.error('Error starting server:', error);
    process.exit(1);
  }
}

process.on('SIGINT', async () => {
  console.log('Shutting down...');
  if (browser) {
    try {
      await browser.close();
      console.log('Puppeteer browser closed');
    } catch (error) {
      console.error('Error closing Puppeteer browser:', error);
    }
  }
  try {
    await client.destroy();
    console.log('WhatsApp client closed');
  } catch (error) {
    console.error('Error closing WhatsApp client:', error);
  }
  try {
    await pool.end();
    console.log('Database pool closed');
  } catch (error) {
    console.error('Error closing database pool:', error);
  }
  server.close();
  console.log('Server closed');
  process.exit(0);
});

// Export function for use in other modules
module.exports = {
  captureWhatsAppQR
};

// Start server if running directly
if (require.main === module) {
  startServer();
}
