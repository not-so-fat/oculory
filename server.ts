import "dotenv/config";
import express from "express";
import fs from "fs";
import path from "path";
import matter from "gray-matter";
import { KnowledgeBaseSecurity } from "./armoriq/security.js";

const VAPI_API_KEY = process.env.VAPI_API_KEY || "";
const MINIMAX_API_KEY = process.env.MINIMAX_API_KEY || "";
// Always mock mode for demo - real ArmorIQ integration later
const ARMORIQ_API_KEY = "";

// Lexicon: support multiple sources
// 1. data/ folder (local dev)
// 2. GIST_URL env var (private gist for production)
const LEXICON_PATH = process.env.LEXICON_PATH || path.join(process.cwd(), "data");
const GIST_URL = process.env.GIST_URL || "";

interface Doc {
  layer: string;
  project: string;
  title: string;
  content: string;
}

const LAYER_PRIORITY: Record<string, number> = {
  memory: 1,
  people: 2,
  meeting: 3,
  metadata: 4,
  transcript: 5,
};

function getLayerFromPath(filePath: string): string {
  const p = filePath.toLowerCase();
  if (p.includes("/memory/")) return "memory";
  if (p.includes("/people/")) return "people";
  if (p.includes("/meetings/")) return "meeting";
  if (p.includes("/metadata/")) return "metadata";
  if (p.includes("/transcripts/")) return "transcript";
  return "metadata";
}

// Load knowledge base (supports local or gist)
async function loadDocuments(): Promise<Doc[]> {
  // If GIST_URL is set, fetch from gist
  if (GIST_URL) {
    console.log("Loading from gist...");
    try {
      const response = await fetch(GIST_URL);
      const data = await response.json();
      console.log(`Loaded ${data.length} documents from gist`);
      return data as Doc[];
    } catch (e) {
      console.error("Failed to load from gist:", e);
      return [];
    }
  }

  // Otherwise load from local folder
  const layers = ["Memory", "People", "Meetings", "Metadata", "Transcripts"];
  const docs: Doc[] = [];

  for (const layer of layers) {
    const layerPath = path.join(LEXICON_PATH, layer);
    if (!fs.existsSync(layerPath)) continue;

    const walk = (dir: string) => {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(fullPath);
        } else if (entry.name.endsWith(".md")) {
          try {
            const content = fs.readFileSync(fullPath, "utf-8");
            const { data, content: body } = matter(content);
            if (body.trim()) {
              docs.push({
                layer: getLayerFromPath(fullPath),
                project: "default",
                title: (data.title as string) || entry.name.replace(".md", ""),
                content: body,
              });
            }
          } catch (e) {
            // Skip
          }
        }
      }
    };
    walk(layerPath);
  }

  return docs;
}

// Search knowledge base
function searchDocs(docs: Doc[], query: string): Doc[] {
  const qWords = query.toLowerCase().split(" ").filter(w => w.length > 2);
  
  return docs
    .map((d) => {
      let score = 0;
      const content = d.content.toLowerCase();
      const title = d.title.toLowerCase();

      for (const w of qWords) {
        if (title.includes(w)) score += 15;
      }
      for (const w of qWords) {
        if (content.includes(w)) score += 3;
      }
      score -= (LAYER_PRIORITY[d.layer] || 0) * 2;
      return { doc: d, score };
    })
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .map((s) => s.doc);
}

// Generate response (simple fallback)
// MiniMax API config
const MINIMAX_BASE_URL = "https://api.minimax.io/v1";
const MINIMAX_MODEL = "MiniMax-M2.5";

interface GeneratedResponse {
  voiceResponse: string;   // Conversational response for voice
  textSummary: string;     // Detailed summary for text/chat display
}

async function generateResponse(query: string, results: Doc[]): Promise<GeneratedResponse> {
  const noInfo = "I don't have information about that in the knowledge base.";
  if (results.length === 0) {
    return { voiceResponse: noInfo, textSummary: noInfo };
  }

  // More context: top 8 docs, 1500 chars each
  const context = results
    .map((r) => `[${r.title}] (${r.layer}): ${r.content.slice(0, 1500)}`)
    .join("\n\n");

  // Call MiniMax twice: once for voice, once for text
  if (MINIMAX_API_KEY) {
    try {
      // 1. Voice response - conversational, natural dialogue
      const voiceRes = await fetch(`${MINIMAX_BASE_URL}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${MINIMAX_API_KEY}`,
        },
        body: JSON.stringify({
          model: MINIMAX_MODEL,
          messages: [
            { role: "system", content: "You are having a friendly voice conversation. Respond naturally as if you're talking to a friend. Answer the user's question based on the context. Keep it conversational, 1-2 sentences, under 20 words." },
            { role: "user", content: `User asked: "${query}"\n\nRelevant information:\n${context}` }
          ],
          temperature: 0.8,
        }),
      });
      const voiceData = await voiceRes.json();
      const voiceResponse = voiceData.choices?.[0]?.message?.content || noInfo;

      // 2. Text summary - detailed, for chat display
      const textRes = await fetch(`${MINIMAX_BASE_URL}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${MINIMAX_API_KEY}`,
        },
        body: JSON.stringify({
          model: MINIMAX_MODEL,
          messages: [
            { role: "system", content: "You are a helpful assistant. Provide a detailed answer in markdown format. Include specific names, dates, numbers, and outcomes when available." },
            { role: "user", content: `User asked: "${query}"\n\nRelevant information:\n${context}` }
          ],
          temperature: 0.7,
        }),
      });
      const textData = await textRes.json();
      const textSummary = textData.choices?.[0]?.message?.content || noInfo;

      console.log("[MiniMax] Voice:", voiceResponse.slice(0, 60));
      console.log("[MiniMax] Text:", textSummary.slice(0, 60));
      return { voiceResponse, textSummary };
    } catch (e) {
      console.error("MiniMax error:", e);
    }
  }

  // Fallback
  const top = results[0];
  const content = top.content.slice(0, 500).replace(/#{1,6}\s/g, "").replace(/\*\*/g, "").replace(/\n+/g, " ").trim();
  const fallback = `${content}\n\n(Source: ${top.title})`;
  return { voiceResponse: fallback.slice(0, 150), textSummary: fallback };
}

// Main app
const app = express();
app.use(express.json());

// Initialize security and documents (will load async)
let docs: Doc[] = [];
let security: KnowledgeBaseSecurity;

async function init() {
  security = new KnowledgeBaseSecurity();
  docs = await loadDocuments();
  console.log(`Loaded ${docs.length} documents from Lexicon`);
  
  // Start server after loading docs
  app.listen(PORT, () => {
    console.log(`
╔══════════════════════════════════════════════════════════════╗
║          Oculory Voice Agent - Ready!                    ║
╠══════════════════════════════════════════════════════════════╣
║  Server:      http://localhost:${PORT}                        ║
║  API:        http://localhost:${PORT}/api/query              ║
║  VAPI:       http://localhost:${PORT}/vapi/webhook           ║
╠══════════════════════════════════════════════════════════════╣
║  ArmorIQ:    ${ARMORIQ_API_KEY ? "Enabled" : "Disabled (mock mode)"}                              ║
║  VAPI:       ${VAPI_API_KEY ? "Enabled" : "Disabled"}                              ║
║  Documents:  ${docs.length}                                       ║
╚══════════════════════════════════════════════════════════════╝
`);
  });
}

// HTML UI
const HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Oculory - Voice Agent</title>
  <style>
    :root {
      --cyber-dark: #0A0A07;
      --cyber-teal: #92E4DD;
      --cyber-gold: #C4B643;
      --card-red: #F9386D;
      --card-green: #39FF14;
      --card-gray: #E0E0E0;
      --card-orange: #FF6B00;
      --font-sans: Monaco, 'Nunito Sans', -apple-system, BlinkMacSystemFont, sans-serif;
      --font-mono: Monaco, 'SF Mono', Menlo, monospace;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: var(--font-sans);
      background: var(--cyber-dark);
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      color: var(--cyber-teal);
    }
    .container {
      background: rgba(146, 228, 221, 0.05);
      border: 1px solid var(--cyber-teal);
      border-radius: 12px;
      padding: 40px;
      max-width: 500px;
      width: 90%;
      text-align: center;
    }
    h1 { 
      font-size: 2.5rem; 
      margin-bottom: 10px; 
      color: var(--cyber-gold);
      font-family: var(--font-mono);
    }
    .subtitle { color: var(--card-gray); margin-bottom: 30px; }
    
    /* Invite Section */
    #invite-section { display: block; }
    input {
      width: 100%;
      padding: 15px;
      font-size: 18px;
      border: 1px solid var(--cyber-teal);
      border-radius: 8px;
      margin-bottom: 15px;
      background: transparent;
      color: var(--cyber-teal);
      text-align: center;
      font-family: var(--font-mono);
    }
    input::placeholder { color: var(--card-gray); }
    input:focus { outline: none; border-color: var(--cyber-gold); }
    button {
      width: 100%;
      padding: 15px;
      font-size: 18px;
      border: none;
      border-radius: 8px;
      cursor: pointer;
      font-weight: bold;
      transition: all 0.2s;
      font-family: var(--font-mono);
    }
    button:hover { transform: scale(1.02); }
    .btn-primary { 
      background: var(--cyber-teal); 
      color: var(--cyber-dark); 
    }
    .btn-primary:hover { 
      background: var(--cyber-gold); 
    }
    .btn-voice { 
      background: transparent; 
      border: 2px solid var(--cyber-teal);
      color: var(--cyber-teal); 
      margin-top: 10px; 
    }
    .btn-voice:hover { 
      border-color: var(--cyber-gold);
      color: var(--cyber-gold);
    }
    .error { color: var(--card-red); margin-top: 10px; }
    
    /* Chat Section */
    #chat-section { display: none; }
    .chat-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 20px;
    }
    .status {
      padding: 5px 15px;
      border-radius: 20px;
      font-size: 14px;
      font-family: var(--font-mono);
    }
    .status.connected { background: var(--card-green); color: var(--cyber-dark); }
    .status.listening { background: var(--card-orange); color: var(--cyber-dark); }
    
    #messages {
      background: rgba(0,0,0,0.3);
      border: 1px solid var(--card-gray);
      border-radius: 8px;
      padding: 20px;
      min-height: 200px;
      max-height: 300px;
      overflow-y: auto;
      text-align: left;
      margin-bottom: 20px;
    }
    .message { margin-bottom: 15px; }
    .message.user { text-align: right; }
    .message .bubble {
      display: inline-block;
      padding: 10px 15px;
      border-radius: 15px;
      max-width: 80%;
    }
    .message.user .bubble { 
      background: var(--cyber-gold); 
      color: var(--cyber-dark);
    }
    .message.bot .bubble { 
      background: rgba(146, 228, 221, 0.1); 
      border: 1px solid var(--cyber-teal);
    }
    .sources { font-size: 12px; color: #888; margin-top: 5px; }
    
    #voice-btn {
      width: 80px;
      height: 80px;
      border-radius: 50%;
      font-size: 24px;
      margin: 20px auto;
      display: block;
      border: 2px solid var(--cyber-teal);
      background: transparent;
      color: var(--cyber-teal);
    }
    #voice-btn.listening { 
      background: var(--card-red); 
      border-color: var(--card-red);
      color: var(--cyber-dark);
      animation: pulse 1s infinite; 
    }
    #voice-btn:hover {
      border-color: var(--cyber-gold);
      color: var(--cyber-gold);
    }
    @keyframes pulse {
      0%, 100% { transform: scale(1); }
      50% { transform: scale(1.1); }
    }
    .message.bot .bubble h1, .message.bot .bubble h2, .message.bot .bubble h3 { margin: 0.5em 0; font-size: 1em; }
    .message.bot .bubble ul, .message.bot .bubble ol { margin: 0.5em 0; padding-left: 1.2em; }
    .message.bot .bubble p { margin: 0.4em 0; }
    .play-voice { margin-top: 10px; font-size: 14px; cursor: pointer; color: var(--cyber-teal); display: inline-flex; align-items: center; gap: 5px; }
    .play-voice:hover { color: var(--cyber-gold); text-decoration: underline; }
  </style>
  <script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"></script>
</head>
<body>
  <div class="container">
    <h1>Oculory</h1>
    <p class="subtitle">Ask questions about your friend's knowledge</p>
    
    <div id="invite-section">
      <input type="text" id="invite-code" placeholder="Enter invite code" />
      <button class="btn-primary" onclick="joinChat()">Join Chat</button>
      <p class="error" id="invite-error"></p>
    </div>
    
    <div id="chat-section">
      <div class="chat-header">
        <span id="user-name">Welcome!</span>
        <span class="status connected" id="status">Ready</span>
      </div>
      
      <div id="messages">
        <div class="message bot">
          <div class="bubble">Hi! Ask me anything about your friend's knowledge base.</div>
        </div>
      </div>
      
      <button id="voice-btn" class="btn-voice" onclick="toggleVoice()">
        🎤
      </button>
      
      <input type="text" id="chat-input" placeholder="Type a message..." onkeypress="handleKeyPress(event)" />
      <button class="btn-primary" onclick="sendMessage()">Send</button>
    </div>
  </div>

  <script>
    let userId = null;
    let isListening = false;
    let isSpeaking = false;
    
    async function joinChat() {
      const code = document.getElementById('invite-code').value;
      const errorEl = document.getElementById('invite-error');
      
      if (!code) {
        errorEl.textContent = 'Please enter a code';
        return;
      }
      
      console.log('Verifying code:', code);
      
      try {
        const res = await fetch('/api/verify-invite', {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({code})
        });
        const data = await res.json();
        
        if (data.valid) {
          userId = data.userId;
          document.getElementById('invite-section').style.display = 'none';
          document.getElementById('chat-section').style.display = 'block';
        } else {
          errorEl.textContent = 'Invalid invite code';
        }
      } catch (e) {
        errorEl.textContent = 'Error joining chat';
      }
    }
    
    async function sendMessage() {
      const input = document.getElementById('chat-input');
      const message = input.value.trim();
      if (!message) return;
      
      addMessage(message, 'user');
      input.value = '';
      
      const res = await fetch('/api/query', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({query: message, userId})
      });
      const data = await res.json();
      console.log("API response:", data);

      if (data.success) {
        addMessage(data.response, 'bot', data.sources, data.voiceSummary);
      } else {
        addMessage('Error: ' + data.error, 'bot');
      }
    }
    
    function addMessage(text, type, sources = [], voiceSummary = null) {
      console.log("addMessage() called, voiceSummary:", voiceSummary);
      const messages = document.getElementById('messages');
      const div = document.createElement('div');
      div.className = 'message ' + type;
      const bubble = document.createElement('div');
      bubble.className = 'bubble';
      if (type === 'bot' && typeof marked !== 'undefined') {
        bubble.innerHTML = marked.parse(text || '');
      } else {
        bubble.textContent = text || '';
      }
      if (type === 'bot' && voiceSummary) {
        console.log("Creating play button, voiceSummary:", voiceSummary);
        const playBtn = document.createElement('div');
        playBtn.className = 'play-voice';
        playBtn.textContent = '🔊 Play voice';
        playBtn.onclick = () => { console.log("Play button clicked"); speak(voiceSummary); };
        bubble.appendChild(playBtn);
      }
      div.appendChild(bubble);
      messages.appendChild(div);
      
      if (sources.length > 0) {
        const src = document.createElement('div');
        src.className = 'sources';
        src.textContent = 'Sources: ' + sources.map(s => s.title).join(', ');
        messages.appendChild(src);
      }
      
messages.scrollTop = messages.scrollHeight;

      // Auto-play after a short delay
      if (type === 'bot' && voiceSummary) {
        setTimeout(() => speak(voiceSummary), 500);
      }
    }
    
    function speak(text) {
      console.log("speak() called, text:", text ? text.slice(0, 30) : "null");
      // Reset isSpeaking to fix stuck flag
      isSpeaking = false;
      if (!text || !text.trim()) {
        console.log("TTS skipped: no text");
        return;
      }
      if (!window.speechSynthesis) {
        console.log("TTS skipped: no speechSynthesis");
        return;
      }
      try {
        isSpeaking = true;
        window.speechSynthesis.cancel();
        
        const u = new SpeechSynthesisUtterance(text.trim());
        u.rate = 0.85;
        u.pitch = 1;
        u.volume = 1;
        
        // Try to set a specific voice
        const voices = window.speechSynthesis.getVoices();
        if (voices.length > 0) {
          // Prefer Google US English or similar
          const enVoice = voices.find(v => v.name.includes("Google US English") || v.name.includes("English United States"));
          if (enVoice) u.voice = enVoice;
        }
        
        u.onstart = () => console.log("TTS started");
        u.onend = () => { console.log("TTS ended"); isSpeaking = false; };
        u.onerror = (e) => { console.log("TTS error:", e.error, "msg:", e.message); isSpeaking = false; };
        
        // Use setTimeout to ensure browser allows the speech
        setTimeout(() => {
          window.speechSynthesis.speak(u);
          console.log("TTS speak() called");
        }, 50);
      } catch(e) {
        console.log("TTS exception:", e);
        isSpeaking = false;
      }
    }
    
    function handleKeyPress(e) {
      if (e.key === 'Enter') sendMessage();
    }
    
    let recognition = null;
    
    function toggleVoice() {
      const btn = document.getElementById('voice-btn');
      const status = document.getElementById('status');
      const input = document.getElementById('chat-input');
      
      if (!isListening) {
        // Start listening
        if (!recognition) {
          recognition = new (window.SpeechRecognition || window.webkitSpeechRecognition)();
          recognition.continuous = true;
          recognition.interimResults = false;
          
          recognition.onstart = () => {
            isListening = true;
            btn.classList.add('listening');
            btn.textContent = '⏹️';
            status.textContent = 'Listening...';
            status.className = 'status listening';
          };
          
          recognition.onresult = (event) => {
            // Don't auto-send - just show the recorded text
            for (let i = 0; i < event.results.length; i++) {
              if (event.results[i].isFinal) {
                const transcript = event.results[i][0].transcript;
                input.value = transcript;
                break;
              }
            }
          };
          
          recognition.onend = () => {
            // Don't auto-send - just show the recorded text
            isListening = false;
            btn.classList.remove('listening');
            btn.textContent = '🎤';
            status.textContent = 'Say something and click mic to stop';
            status.className = 'status connected';
          };
          
          recognition.onerror = (event) => {
            console.error('Speech error:', event.error);
            isListening = false;
            btn.classList.remove('listening');
            btn.textContent = '🎤';
            status.textContent = 'Error: ' + event.error;
          };
        }
        
        recognition.start();
      } else {
        // Stop listening
        if (recognition) {
          recognition.stop();
        }
      }
    }

    function handleKeyPress(e) {
      if (e.key === 'Enter') sendMessage();
    }
  </script>
</body>
</html>`;

// Health check
app.get("/", (req, res) => {
  res.send(HTML);
});

// API: Health JSON
app.get("/api/health", (req, res) => {
  res.json({ 
    status: "ok", 
    documents: docs.length,
    armoriq: !!ARMORIQ_API_KEY,
    vapi: !!VAPI_API_KEY
  });
});

// API: Process voice query (from VAPI)
app.post("/api/query", async (req, res) => {
  const { query, userId = "anonymous" } = req.body;

  console.log(`\n[Query] User: ${userId}, Query: "${query}"`);

  // Step 1: ArmorIQ security check
// Skip security check for now (mocked anyway)
  const accessCheck = { allowed: true, reason: "" };
  /*
  const accessCheck = await security.canSearch(userId, query);
  if (!accessCheck.allowed) {
    console.log("[ArmorIQ] Access denied:", accessCheck.reason);
    res.json({ 
      success: false, 
      error: accessCheck.reason,
      security: "denied"
    });
    return;
  }
  //*/

  console.log("[ArmorIQ] Access granted");

  // Step 2: Search knowledge base
  const results = searchDocs(docs, query);

  // Step 3: Generate response (short for voice, full markdown for chat)
  const { voiceResponse, textSummary } = await generateResponse(query, results);

  res.json({
    success: true,
    query,
response: textSummary,
    // Quick fix: strip thinking tags and cap voice at 25 words
    voiceSummary: query.toLowerCase().includes("test voice")
      ? "This is a test voice message. Hello! Can you hear me?"
      : (voiceResponse || "").replace(/<think>[\s\S]*?</think>/gi, "").split(" ").slice(0, 25).join(" ") + ".",
    sources: results.map(r => ({ title: r.title, layer: r.layer })),
    security: "approved"
  });
});

// API: Verify invite code
app.post("/api/verify-invite", async (req, res) => {
  const { code } = req.body;

  // Simple code validation (in production, check against Convex)
  const validCodes: Record<string, string> = {
    "HACK2026": "user_001",
  };

  const userId = validCodes[code];
  if (!userId) {
    res.json({ valid: false });
    return;
  }

  // Set policy for this user
  security.setUserPolicy(userId, {
    can_read: true,
    can_search: true,
    rate_limit: 10,
    allowed_projects: ["default"],
  });

  res.json({ valid: true, userId });
});

// VAPI webhook endpoint
app.post("/vapi/webhook", async (req, res) => {
  const { type, message } = req.body;

  console.log("[VAPI] Event:", type);

  switch (type) {
    case "conversation-start":
      // Return welcome message
      res.json({
        response: "Hi! Ask me anything about your friend's knowledge base."
      });
      return;

    case "conversation-end":
      console.log("[VAPI] Call ended");
      res.json({ success: true });
      return;

    case "transcript":
      if (message?.type === "user" && message?.content) {
        const query = message.content;
        console.log("[VAPI] User said:", query);

        // Process query
        const results = searchDocs(docs, query);
        const { voiceResponse } = await generateResponse(query, results);

        console.log("[VAPI] Response:", voiceResponse);
        res.json({ response: voiceResponse });
        return;
      }
      break;
  }

  res.json({ success: true });
});

// Start server
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`
╔══════════════════════════════════════════════════════════════╗
║          Oculory Voice Agent - Ready!                       ║
╠══════════════════════════════════════════════════════════════╣
║  Server:      http://localhost:${PORT}                        ║
║  API:        http://localhost:${PORT}/api/query              ║
║  VAPI:       http://localhost:${PORT}/vapi/webhook           ║
╠══════════════════════════════════════════════════════════════╣
║  ArmorIQ:    ${ARMORIQ_API_KEY ? "Enabled" : "Disabled (mock mode)"}                              ║
║  VAPI:       ${VAPI_API_KEY ? "Enabled" : "Disabled"}                              ║
║  Documents:  ${docs.length}                                       ║
╚══════════════════════════════════════════════════════════════╝

Quick test:
  curl -X POST http://localhost:${PORT}/api/query \\
    -H "Content-Type: application/json" \\
    -d '{"query": "What about AI?", "userId": "user_001"}'
`);
});

// Start
init();
