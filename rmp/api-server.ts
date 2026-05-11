import express from 'express';
import cors from 'cors';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { RateMyProfessorService } from './src/services/RateMyProfessorService';

export const app = express();
const PORT = process.env.PORT || 3000;

// File paths
const usersFile = path.resolve(process.cwd(), 'users.txt');
const chatsDir = path.resolve(process.cwd(), 'chats');

interface User {
    id: string;
    email: string;
    username: string;
    passwordHash: string;
    salt: string;
    createdAt: string;
}

interface ChatMessage {
    role: 'user' | 'assistant';
    content: string;
    timestamp: string;
}

// In-memory sessions (expires at server restart)
const sessions: Record<string, { userId: string; createdAt: string }> = {};

// Middleware
app.use(cors());
app.use(express.json());

// Ensure directories exist
function ensureStorage() {
    if (!fs.existsSync(chatsDir)) {
        fs.mkdirSync(chatsDir, { recursive: true });
    }
}

// Load all users from text file
function loadAllUsers(): User[] {
    ensureStorage();
    if (!fs.existsSync(usersFile)) {
        return [];
    }
    const lines = fs.readFileSync(usersFile, 'utf8').split('\n').filter((line) => line.trim());
    return lines.map((line) => {
        try {
            return JSON.parse(line) as User;
        } catch {
            return null;
        }
    }).filter((user): user is User => user !== null);
}

// Save user to text file
function saveUser(user: User) {
    ensureStorage();
    const users = loadAllUsers();
    const existingIdx = users.findIndex((u) => u.id === user.id);
    if (existingIdx >= 0) {
        users[existingIdx] = user;
    } else {
        users.push(user);
    }
    const lines = users.map((u) => JSON.stringify(u));
    fs.writeFileSync(usersFile, lines.join('\n') + '\n', 'utf8');
}

// Load chat history for a user
function loadChatHistory(userId: string): ChatMessage[] {
    ensureStorage();
    const chatFile = path.join(chatsDir, `${userId}.txt`);
    if (!fs.existsSync(chatFile)) {
        return [];
    }
    const lines = fs.readFileSync(chatFile, 'utf8').split('\n').filter((line) => line.trim());
    return lines.map((line) => {
        try {
            return JSON.parse(line) as ChatMessage;
        } catch {
            return null;
        }
    }).filter((msg): msg is ChatMessage => msg !== null);
}

// Save chat history for a user
function saveChatHistory(userId: string, messages: ChatMessage[]) {
    ensureStorage();
    const chatFile = path.join(chatsDir, `${userId}.txt`);
    const lines = messages.map((msg) => JSON.stringify(msg));
    fs.writeFileSync(chatFile, lines.join('\n') + (lines.length > 0 ? '\n' : ''), 'utf8');
}

function hashPassword(password: string, salt: string = crypto.randomBytes(16).toString('hex')) {
    const hash = crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');
    return { salt, hash };
}

function verifyPassword(password: string, salt: string, hash: string) {
    return crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex') === hash;
}

function createSession(userId: string) {
    const token = crypto.randomBytes(32).toString('hex');
    sessions[token] = { userId, createdAt: new Date().toISOString() };
    return token;
}

function getUserByToken(token: string) {
    const session = sessions[token];
    if (!session) return null;
    const users = loadAllUsers();
    return users.find((u) => u.id === session.userId) || null;
}

const geminiApiKey = process.env.GEMINI_API_KEY || process.env.Gemini_api_key || process.env.GEMINI_api_key;
const geminiEndpoint = process.env.GEMINI_API_URL || 'https://generativelanguage.googleapis.com/v1beta2/models/text-bison-001:generate';

async function fetchScholarPapers(query: string) {
    const qEnc = encodeURIComponent(query);
    const url = `https://scholar.google.com/scholar?q=${qEnc}`;
    try {
        const res = await fetch(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            }
        });
        if (!res.ok) throw new Error(`Scholar fetch failed: ${res.status}`);
        const text = await res.text();
        const re = /<h3[^>]*class="gs_rt"[^>]*>\s*(?:<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>|([^<]+))\s*<\/h3>/gi;
        const results: Array<{ title: string; url: string; source: string }> = [];
        let m: RegExpExecArray | null;
        while ((m = re.exec(text)) && results.length < 5) {
            const href = m[1];
            const title = (m[2] || m[3] || '').replace(/<[^>]+>/g, '').trim();
            if (!title || !href) continue;
            results.push({ title, url: href, source: 'Google Scholar' });
        }
        return results;
    } catch (error) {
        console.error('Scholar search error:', error);
        return [];
    }
}

async function fetchGeminiResearch(query: string) {
    if (!geminiApiKey) return [];
    const promptText = `Search the web for the query: "${query}". Return a valid JSON array named "results" with up to 5 objects. Each object should have keys: title, url, summary. Respond with only valid JSON and no extra text.`;
    try {
        const body = {
            prompt: { text: promptText },
            temperature: 0.0,
            max_output_tokens: 512,
            candidate_count: 1
        };

        const res = await fetch(geminiEndpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${geminiApiKey}`
            },
            body: JSON.stringify(body)
        });

        if (!res.ok) {
            const errText = await res.text().catch(() => '');
            throw new Error(`Gemini fetch failed ${res.status}: ${errText}`);
        }

        const text = await res.text();
        const tryJson = (s: string) => {
            try { return JSON.parse(s); } catch { return null; }
        };

        let parsed = tryJson(text);
        if (!parsed) {
            const mArr = text.match(/\[[\s\S]*\]/);
            if (mArr) parsed = tryJson(mArr[0]);
        }

        if (Array.isArray(parsed)) {
            return parsed.slice(0, 5).map(item => ({
                title: String(item.title || item.name || item.title || 'Web result'),
                url: String(item.url || ''),
                summary: String(item.summary || item.snippet || item.description || '')
            }));
        }

        if (parsed && Array.isArray(parsed.results)) {
            return parsed.results.slice(0, 5).map(item => ({
                title: String(item.title || item.name || 'Web result'),
                url: String(item.url || ''),
                summary: String(item.summary || item.snippet || item.description || '')
            }));
        }

        return [];
    } catch (error) {
        console.error('Gemini research error:', error);
        return [];
    }
}

async function fetchProfessorResearch(name: string) {
    const query = `${name} papers publications research program affiliation profile`;
    const [scholar, gemini] = await Promise.all([
        fetchScholarPapers(query),
        fetchGeminiResearch(query)
    ]);
    return { scholar, gemini };
}

// Initialize the RMP service
const rmpService = new RateMyProfessorService();

// --- Authentication Endpoints ---
app.post('/api/signup', (req, res) => {
    try {
        const { email, password, username } = req.body;
        if (!email || !password || !username) {
            return res.status(400).json({ error: 'Email, password and username are required.' });
        }

        const users = loadAllUsers();
        const existing = users.find((user) => user.email.toLowerCase() === String(email).toLowerCase());
        if (existing) {
            return res.status(409).json({ error: 'Email is already registered.' });
        }

        const id = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${crypto.randomBytes(8).toString('hex')}`;
        const { salt, hash } = hashPassword(String(password));
        const user: User = {
            id,
            email: String(email).toLowerCase(),
            username: String(username).trim(),
            passwordHash: hash,
            salt,
            createdAt: new Date().toISOString(),
        };

        saveUser(user);
        const token = createSession(user.id);
        console.log(`✅ User signed up: ${user.email}`);
        res.json({ success: true, token, user: { id: user.id, email: user.email, username: user.username } });
    } catch (error) {
        console.error('Signup error:', error);
        res.status(500).json({ error: 'Unable to register user.' });
    }
});

app.post('/api/login', (req, res) => {
    try {
        const { email, password } = req.body;
        if (!email || !password) {
            return res.status(400).json({ error: 'Email and password are required.' });
        }

        const users = loadAllUsers();
        const user = users.find((u) => u.email === String(email).toLowerCase());
        if (!user || !verifyPassword(String(password), user.salt, user.passwordHash)) {
            return res.status(401).json({ error: 'Invalid email or password.' });
        }

        const token = createSession(user.id);
        console.log(`✅ User logged in: ${user.email}`);
        res.json({ success: true, token, user: { id: user.id, email: user.email, username: user.username } });
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ error: 'Unable to log in.' });
    }
});

app.get('/api/session', (req, res) => {
    try {
        const token = String(req.query.token || '');
        if (!token) {
            return res.status(400).json({ error: 'Token is required.' });
        }

        const user = getUserByToken(token);
        if (!user) {
            return res.status(401).json({ error: 'Invalid session token.' });
        }

        res.json({ success: true, user: { id: user.id, email: user.email, username: user.username } });
    } catch (error) {
        console.error('Session error:', error);
        res.status(500).json({ error: 'Unable to verify session.' });
    }
});

app.get('/api/chat-history', (req, res) => {
    try {
        const token = String(req.query.token || '');
        if (!token) {
            return res.status(400).json({ error: 'Token is required.' });
        }

        const user = getUserByToken(token);
        if (!user) {
            return res.status(401).json({ error: 'Invalid session token.' });
        }

        const history = loadChatHistory(user.id);
        res.json({ success: true, history });
    } catch (error) {
        console.error('Chat history error:', error);
        res.status(500).json({ error: 'Unable to load chat history.' });
    }
});

app.post('/api/save-chat', (req, res) => {
    try {
        const { token, history } = req.body;
        if (!token || !Array.isArray(history)) {
            return res.status(400).json({ error: 'Token and history array are required.' });
        }

        const user = getUserByToken(token);
        if (!user) {
            return res.status(401).json({ error: 'Invalid session token.' });
        }

        const messages: ChatMessage[] = history.map((item: unknown) => {
            const row = item as Record<string, unknown>;
            return {
                role: row.role === 'assistant' ? 'assistant' : 'user',
                content: String(row.content || ''),
                timestamp: typeof row.timestamp === 'string' ? row.timestamp : new Date().toISOString(),
            };
        });
        saveChatHistory(user.id, messages);
        res.json({ success: true });
    } catch (error) {
        console.error('Save chat error:', error);
        res.status(500).json({ error: 'Unable to save chat history.' });
    }
});

// Route to search professors
app.get('/api/search-professors', async (req, res) => {
    try {
        const { name, school, max } = req.query;

        if (!name || typeof name !== 'string') {
            return res.status(400).json({
                error: 'Professor name is required',
                results: []
            });
        }

        const requestedMax = typeof max === 'string' ? Number.parseInt(max, 10) : NaN;
        const maxResults = Number.isFinite(requestedMax)
            ? Math.min(Math.max(requestedMax, 10), 300)
            : 150;

        const schoolFilter = typeof school === 'string' ? school.trim() : undefined;

        let professors = [];
        try {
            const searchResult = await rmpService.searchProfessor(name, maxResults, schoolFilter);
            professors = searchResult.professors;
        } catch (error) {
            console.error('RMP API Error:', error);
            professors = [];
        }

        res.json({
            success: true,
            query: name,
            results: professors,
            count: professors.length
        });
    } catch (error) {
        console.error('Error searching professors:', error);
        res.status(500).json({
            error: error instanceof Error ? error.message : 'Unknown error',
            results: []
        });
    }
});

app.get('/api/search-research', async (req, res) => {
    try {
        const { name } = req.query;
        if (!name || typeof name !== 'string') {
            return res.status(400).json({ error: 'Professor name is required.', research: { scholar: [], gemini: [] } });
        }

        const research = await fetchProfessorResearch(name);
        res.json({ success: true, query: name, research });
    } catch (error) {
        console.error('Error searching professor research:', error);
        res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error', research: { scholar: [], gemini: [] } });
    }
});

// Health check endpoint
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', message: 'RMP API Server is running' });
});

// Serve the HTML file
app.get('/', (req, res) => {
    const htmlPath = path.resolve(process.cwd(), 'scripts', 'rmp_ui.html');
    res.sendFile(htmlPath);
});

// Start the server
if (require.main === module) {
    app.listen(PORT, () => {
        console.log(`▶️  RMP API Server running on http://localhost:${PORT}`);
        console.log(`📚 Search endpoint: GET http://localhost:${PORT}/api/search-professors?name=John`);
        console.log(`🌐 UI available at: http://localhost:${PORT}`);
    });
}
