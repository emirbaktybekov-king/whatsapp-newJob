// DOM Elements
const themeToggle = document.getElementById('themeToggle');
const statusIndicator = document.getElementById('statusIndicator');
const qrCode = document.getElementById('qrCode');
const connectedInfo = document.getElementById('connectedInfo');
const userInfo = document.getElementById('userInfo');
const phoneInfo = document.getElementById('phoneInfo');
const refreshQrBtn = document.getElementById('refreshQrBtn');
const scanQrBtn = document.getElementById('scanQrBtn');
const logoutBtn = document.getElementById('logoutBtn');
const cpuUsage = document.getElementById('cpuUsage');
const memoryUsage = document.getElementById('memoryUsage');
const uptime = document.getElementById('uptime');
const systemStatus = document.getElementById('systemStatus');
const totalMessages = document.getElementById('totalMessages');
const sentMessages = document.getElementById('sentMessages');
const receivedMessages = document.getElementById('receivedMessages');
const mediaMessages = document.getElementById('mediaMessages');
const messageList = document.getElementById('messageList');
const sendMessageForm = document.getElementById('sendMessageForm');
const messageRecipient = document.getElementById('messageRecipient');
const messageContent = document.getElementById('messageContent');
const sendMessageBtn = document.getElementById('sendMessageBtn');

// Theme state
let darkMode = localStorage.getItem('darkMode') === 'true';

// WebSocket connection
let ws;

// Connection status
let isConnected = false;

// Initialize
function init() {
    // Apply theme
    updateTheme();
    
    // Set up theme toggle
    themeToggle.addEventListener('click', toggleTheme);
    
    // Connect to WebSocket
    connectWebSocket();
    
    // Fetch initial QR code and messages
    fetchLatestQr();
    fetchMessages();
    
    // Set up button handlers
    refreshQrBtn.addEventListener('click', refreshQrCode);
    scanQrBtn.addEventListener('click', scanQrCode);
    logoutBtn.addEventListener('click', logout);
    
    // Set up send message form
    sendMessageBtn.addEventListener('click', sendMessage);
    
    // Poll for QR code every 5 seconds
    setInterval(fetchLatestQr, 5000);
}

// Theme functions
function updateTheme() {
    if (darkMode) {
        document.body.classList.add('dark');
        themeToggle.textContent = '☀️';
    } else {
        document.body.classList.remove('dark');
        themeToggle.textContent = '🌙';
    }
}

function toggleTheme() {
    darkMode = !darkMode;
    localStorage.setItem('darkMode', darkMode);
    updateTheme();
}

// WebSocket functions
function connectWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}`;
    
    ws = new WebSocket(wsUrl);
    
    ws.onopen = () => {
        console.log('WebSocket connected');
        // Delay QR code request to avoid race condition
        setTimeout(() => {
            ws.send(JSON.stringify({ type: 'get_qr', id: Date.now() }));
        }, 1000);
    };
    
    ws.onmessage = (event) => {
        try {
            const data = JSON.parse(event.data);
            console.log('WebSocket message:', data);
            
            if (data.type === 'qr_code') {
                displayQrCode(data.data.qrUrl);
            } else if (data.type === 'response' && data.data.qrUrl) {
                displayQrCode(data.data.qrUrl);
            } else if (data.type === 'authenticated') {
                handleAuthenticationSuccess(data.data.userName);
            } else if (data.type === 'new_message') {
                addMessage(data.data);
            }
        } catch (error) {
            console.error('Error parsing WebSocket message:', error);
        }
    };
    
    ws.onclose = () => {
        console.log('WebSocket disconnected');
        setTimeout(connectWebSocket, 5000);
    };
    
    ws.onerror = (error) => {
        console.error('WebSocket error:', error);
    };
}

// UI update functions
function displayQrCode(qrUrl) {
    console.log('Displaying QR code:', qrUrl);
    qrCode.innerHTML = `<img src="${qrUrl}" alt="WhatsApp QR Code">`;
    scanQrBtn.disabled = false;
    logoutBtn.disabled = true;
    connectedInfo.classList.add('hidden');
    sendMessageForm.classList.add('hidden');
    statusIndicator.textContent = 'Please scan this QR code with WhatsApp';
    statusIndicator.className = 'status status-disconnected';
    isConnected = false;
}

function handleAuthenticationSuccess(userName) {
    console.log('Authentication successful:', userName);
    statusIndicator.textContent = 'Connected to WhatsApp';
    statusIndicator.className = 'status status-connected';
    qrCode.innerHTML = `<div>Authenticated successfully!</div>`;
    qrCode.classList.add('hidden');
    connectedInfo.classList.remove('hidden');
    userInfo.textContent = userName || 'Пользователь WhatsApp';
    phoneInfo.textContent = '-';
    scanQrBtn.disabled = true;
    logoutBtn.disabled = false;
    sendMessageForm.classList.remove('hidden');
    isConnected = true;
}

function formatTime(timestamp) {
    const date = new Date(timestamp);
    return date.toLocaleTimeString() + ' ' + date.toLocaleDateString();
}

function addMessage(message) {
    console.log('Adding message:', message);
    const messageElement = document.createElement('div');
    messageElement.className = `message ${message.fromMe ? 'message-outgoing' : 'message-incoming'}`;
    
    const messageHeader = document.createElement('div');
    messageHeader.className = 'message-header';
    
    const messageFrom = document.createElement('span');
    messageFrom.className = 'message-from';
    messageFrom.textContent = message.chatName || message.contactName || (message.fromMe ? 'You' : message.from);
    
    const messageTime = document.createElement('span');
    messageTime.className = 'message-time';
    messageTime.textContent = formatTime(message.timestamp);
    
    messageHeader.appendChild(messageFrom);
    messageHeader.appendChild(messageTime);
    
    const messageBody = document.createElement('div');
    messageBody.className = 'message-body';
    messageBody.textContent = message.body;
    
    messageElement.appendChild(messageHeader);
    messageElement.appendChild(messageBody);
    
    messageList.insertBefore(messageElement, messageList.firstChild);
    
    // Update message stats
    fetchMessages(1);
}

// API functions
async function fetchLatestQr() {
    try {
        const response = await fetch('/api/latest-qr');
        if (!response.ok) {
            throw new Error(`HTTP error ${response.status}`);
        }
        
        const result = await response.json();
        console.log('Fetched QR code:', result);
        if (result.success) {
            displayQrCode(result.qrUrl);
        } else {
            qrCode.innerHTML = `<div>No QR code available</div>`;
        }
    } catch (error) {
        console.error('Error fetching QR code:', error);
        qrCode.innerHTML = `<div>Error loading QR code: ${error.message}</div>`;
    }
}

async function fetchMessages(limit = 10) {
    try {
        const response = await fetch(`/api/messages?limit=${limit}`);
        if (!response.ok) {
            throw new Error(`HTTP error ${response.status}`);
        }
        
        const messages = await response.json();
        console.log('Fetched messages:', messages);
        
        if (limit > 1) {
            messageList.innerHTML = '';
            messages.forEach(message => addMessage(message));
        }
        
        // Update stats
        const total = messages.length;
        const sent = messages.filter(m => m.fromMe).length;
        const received = messages.filter(m => !m.fromMe).length;
        const media = messages.filter(m => m.hasMedia).length;
        
        totalMessages.textContent = total;
        sentMessages.textContent = sent;
        receivedMessages.textContent = received;
        mediaMessages.textContent = media;
        
        return messages;
    } catch (error) {
        console.error('Error fetching messages:', error);
        messageList.innerHTML = `<div class="message message-incoming">
            <div class="message-header">
                <span class="message-from">Error</span>
                <span class="message-time"></span>
            </div>
            <div class="message-body">Could not load messages: ${error.message}</div>
        </div>`;
        return [];
    }
}

async function refreshQrCode() {
    try {
        const response = await fetch('/api/refresh-qr', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        });
        
        if (!response.ok) {
            throw new Error(`HTTP error ${response.status}`);
        }
        
        const result = await response.json();
        if (!result.success) {
            throw new Error(result.error || 'Failed to refresh QR code');
        }
    } catch (error) {
        console.error('Error refreshing QR code:', error);
        alert(`Error refreshing QR code: ${error.message}`);
    }
}

async function scanQrCode() {
    try {
        scanQrBtn.disabled = true;
        const response = await fetch('/api/scan-qr', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        });
        
        if (!response.ok) {
            throw new Error(`HTTP error ${response.status}`);
        }
        
        const result = await response.json();
        if (!result.success) {
            throw new Error(result.error || 'Failed to scan QR code');
        }
    } catch (error) {
        console.error('Error scanning QR code:', error);
        alert(`Error scanning QR code: ${error.message}`);
        scanQrBtn.disabled = false;
    }
}

async function logout() {
    try {
        const response = await fetch('/api/logout', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        });
        
        if (!response.ok) {
            throw new Error(`HTTP error ${response.status}`);
        }
        
        const result = await response.json();
        if (!result.success) {
            throw new Error(result.error || 'Failed to logout');
        }
    } catch (error) {
        console.error('Error logging out:', error);
        alert(`Error logging out: ${error.message}`);
    }
}

async function sendMessage() {
    try {
        const to = messageRecipient.value.trim();
        const body = messageContent.value.trim();
        
        if (!to || !body) {
            alert('Please enter both recipient and message content');
            return;
        }
        
        if (!isConnected) {
            alert('You must be connected to WhatsApp to send messages');
            return;
        }
        
        sendMessageBtn.disabled = true;
        
        const response = await fetch('/api/send-message', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ to, body })
        });
        
        if (!response.ok) {
            throw new Error(`HTTP error ${response.status}`);
        }
        
        const result = await response.json();
        if (!result.success) {
            throw new Error(result.error || 'Failed to send message');
        }
        
        messageContent.value = '';
    } catch (error) {
        console.error('Error sending message:', error);
        alert(`Error sending message: ${error.message}`);
    } finally {
        sendMessageBtn.disabled = false;
    }
}

// Initialize the app
document.addEventListener('DOMContentLoaded', init);
