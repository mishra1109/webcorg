const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const fs = require('fs');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname)));

// In-memory database (persistent storage using JSON file)
const DB_FILE = path.join(__dirname, 'database.json');
let database = {
    users: {},
    messages: [],
    adminPassword: 'admin123'
};

// Load database
function loadDatabase() {
    try {
        if (fs.existsSync(DB_FILE)) {
            const data = fs.readFileSync(DB_FILE, 'utf8');
            database = JSON.parse(data);
            console.log('Database loaded successfully');
        }
    } catch (error) {
        console.error('Error loading database:', error);
    }
}

// Save database
function saveDatabase() {
    try {
        fs.writeFileSync(DB_FILE, JSON.stringify(database, null, 2));
    } catch (error) {
        console.error('Error saving database:', error);
    }
}

loadDatabase();

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// API endpoints
app.post('/api/verify-admin', (req, res) => {
    const { password } = req.body;
    if (password === database.adminPassword) {
        res.json({ success: true });
    } else {
        res.json({ success: false });
    }
});

app.get('/api/admin/users', (req, res) => {
    res.json({ users: database.users });
});

app.get('/api/admin/messages', (req, res) => {
    res.json({ messages: database.messages });
});

app.post('/api/admin/remove-user', (req, res) => {
    const { email } = req.body;
    if (database.users[email]) {
        delete database.users[email];
        saveDatabase();
        
        // Disconnect user if online
        for (let [clientWs, userData] of clients.entries()) {
            if (userData.email === email) {
                clientWs.close();
                break;
            }
        }
        
        res.json({ success: true });
    } else {
        res.json({ success: false });
    }
});

app.post('/api/save-user', (req, res) => {
    const { name, email, picture } = req.body;
    
    if (!database.users[email]) {
        database.users[email] = {
            name,
            email,
            picture,
            firstJoined: new Date().toISOString(),
            lastSeen: new Date().toISOString()
        };
    } else {
        database.users[email].lastSeen = new Date().toISOString();
    }
    
    saveDatabase();
    res.json({ success: true });
});

app.get('/api/messages/:userEmail', (req, res) => {
    const userEmail = req.params.userEmail;
    const userMessages = database.messages.filter(msg => 
        msg.from === userEmail || msg.to === userEmail
    );
    res.json({ messages: userMessages });
});

app.post('/api/save-message', (req, res) => {
    const { from, to, message } = req.body;
    
    database.messages.push({
        from,
        to,
        message,
        timestamp: new Date().toISOString(),
        id: Date.now() + Math.random()
    });
    
    saveDatabase();
    res.json({ success: true });
});

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });
const clients = new Map();

console.log('WebCorg Enhanced Chat Server Starting...\n');

wss.on('connection', (ws) => {
    console.log('New client connected');
    
    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            handleMessage(ws, data);
        } catch (error) {
            console.error('Error parsing message:', error);
        }
    });
    
    ws.on('close', () => {
        for (let [clientWs, userData] of clients.entries()) {
            if (clientWs === ws) {
                console.log(userData.name + ' disconnected');
                
                if (database.users[userData.email]) {
                    database.users[userData.email].lastSeen = new Date().toISOString();
                    saveDatabase();
                }
                
                clients.delete(clientWs);
                broadcast({
                    type: 'user_left',
                    email: userData.email,
                    name: userData.name
                }, ws);
                break;
            }
        }
    });
    
    ws.on('error', (error) => {
        console.error('WebSocket error:', error);
    });
});

function handleMessage(ws, data) {
    switch(data.type) {
        case 'user_join':
            clients.set(ws, {
                name: data.name,
                email: data.email,
                picture: data.picture
            });
            
            console.log(data.name + ' joined (' + data.email + ')');
            
            const usersList = [];
            for (let [clientWs, userData] of clients.entries()) {
                if (clientWs !== ws) {
                    usersList.push(userData);
                }
            }
            
            ws.send(JSON.stringify({
                type: 'users_list',
                users: usersList
            }));
            
            broadcast({
                type: 'user_join',
                name: data.name,
                email: data.email,
                picture: data.picture
            }, ws);
            break;
            
        case 'chat_message':
            // Send to recipient if online
            let delivered = false;
            for (let [clientWs, userData] of clients.entries()) {
                if (userData.email === data.to) {
                    clientWs.send(JSON.stringify({
                        type: 'chat_message',
                        from: data.from,
                        to: data.to,
                        message: data.message
                    }));
                    delivered = true;
                    console.log('Message delivered: ' + data.from + ' to ' + data.to);
                    break;
                }
            }
            
            if (!delivered) {
                console.log('Message stored for offline user: ' + data.to);
            }
            break;
            
        case 'request_users':
            const allUsers = [];
            for (let [clientWs, userData] of clients.entries()) {
                if (clientWs !== ws) {
                    allUsers.push(userData);
                }
            }
            
            ws.send(JSON.stringify({
                type: 'users_list',
                users: allUsers
            }));
            break;
    }
}

function broadcast(data, senderWs) {
    const message = JSON.stringify(data);
    
    for (let [clientWs, userData] of clients.entries()) {
        if (clientWs !== senderWs && clientWs.readyState === WebSocket.OPEN) {
            clientWs.send(message);
        }
    }
}

const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
    console.log('Server is running on port ' + PORT);
    console.log('WebSocket URL: ws://localhost:' + PORT);
    console.log('HTTP URL: http://localhost:' + PORT);
    console.log('\nAdmin Password: ' + database.adminPassword);
    console.log('\nWaiting for connections...\n');
});

process.on('SIGINT', () => {
    console.log('\n\nShutting down server...');
    saveDatabase();
    
    for (let [clientWs, userData] of clients.entries()) {
        clientWs.close();
    }
    
    wss.close(() => {
        console.log('WebSocket server closed');
        server.close(() => {
            console.log('HTTP server closed');
            process.exit(0);
        });
    });
});