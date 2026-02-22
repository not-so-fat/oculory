import "dotenv/config";
import express from "express";
import fs from "fs";
import path from "path";
import matter from "gray-matter";

// Inline KnowledgeBaseSecurity
class KnowledgeBaseSecurity {
  private permissions = new Map();
  setUserPermissions(userId: string, perm: any) { this.permissions.set(userId, perm); }
  getSearchFilters(userId: string) { return this.permissions.get(userId) || { allowedProjects: ["default"], allowedLayers: ["memory", "people", "meeting", "metadata", "transcript"] }; }
}

const app = express();
app.use(express.json());

const LEXICON_PATH = process.env.LEXICON_PATH || path.join(process.cwd(), "data");
const GIST_URL = process.env.GIST_URL || "";
const MINIMAX_API_KEY = process.env.MINIMAX_API_KEY || "";
const PORT = process.env.PORT || 8080;

interface Doc { layer: string; project: string; title: string; content: string; }
const LAYER_PRIORITY: Record<string, number> = { memory: 1, people: 2, meeting: 3, metadata: 4, transcript: 5 };

function getLayerFromPath(filePath: string): string {
  const p = filePath.toLowerCase();
  if (p.includes("/memory/")) return "memory";
  if (p.includes("/people/")) return "people";
  if (p.includes("/meetings/")) return "meeting";
  if (p.includes("/metadata/")) return "metadata";
  if (p.includes("/transcripts/")) return "transcript";
  return "metadata";
}

async function loadDocuments(): Promise<Doc[]> {
  if (GIST_URL) {
    try {
      const response = await fetch(GIST_URL);
      return await response.json() as Doc[];
    } catch (e) { return []; }
  }
  const layers = ["Memory", "People", "Meetings", "Metadata", "Transcripts"];
  const docs: Doc[] = [];
  for (const layer of layers) {
    const layerPath = path.join(LEXICON_PATH, layer);
    if (!fs.existsSync(layerPath)) continue;
    const walk = (dir: string) => {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(fullPath);
        else if (entry.name.endsWith(".md")) {
          try {
            const content = fs.readFileSync(fullPath, "utf-8");
            const { data, content: body } = matter(content);
            if (body.trim()) docs.push({ layer: getLayerFromPath(fullPath), project: "default", title: (data.title as string) || entry.name.replace(".md", ""), content: body });
          } catch (e) { /* skip */ }
        }
      }
    };
    walk(layerPath);
  }
  return docs;
}

function searchDocs(docs: Doc[], query: string): Doc[] {
  const qWords = query.toLowerCase().split(" ").filter(w => w.length > 2);
  return docs.map(d => {
    let score = 0;
    const content = d.content.toLowerCase();
    const title = d.title.toLowerCase();
    for (const w of qWords) { if (title.includes(w)) score += 15; }
    for (const w of qWords) { if (content.includes(w)) score += 3; }
    score -= (LAYER_PRIORITY[d.layer] || 0) * 2;
    return { doc: d, score };
  }).filter(s => s.score > 0).sort((a, b) => b.score - a.score).slice(0, 5).map(s => s.doc);
}

async function generateResponse(query: string, results: Doc[]): Promise<string> {
  if (results.length === 0) return "No information found.";
  const context = results.map(r => `[${r.title}]: ${r.content.slice(0, 1000)}`).join("\n\n");
  if (!MINIMAX_API_KEY) return results[0].content.slice(0, 500) + `\n\n(Source: ${results[0].title})`;
  try {
    const res = await fetch("https://api.minimax.io/v1/chat/completions", {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${MINIMAX_API_KEY}` },
      body: JSON.stringify({ model: "MiniMax-M2.5", messages: [{ role: "system", content: "You are Yusuke. Provide detailed answers in markdown." }, { role: "user", content: `Question: ${query}\n\nContext:\n${context}` }], temperature: 0.7 })
    });
    const data = await res.json();
    return data.choices?.[0]?.message?.content || "No response generated.";
  } catch (e) { return "Error generating response."; }
}

const docsPromise = loadDocuments();
const security = new KnowledgeBaseSecurity();

// Demo data
const invites = new Map([["HACK2026", { name: "Demo User", projects: ["default", "personal"], layers: ["memory", "people", "meeting", "metadata", "transcript"] }]]);

// HTML - simple and clean
const HTML = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Oculory</title>
  <style>
    body { font-family: -apple-system, sans-serif; max-width: 600px; margin: 50px auto; padding: 20px; background: #0A0A07; color: #92E4DD; }
    .container { background: rgba(146,228,221,0.05); border: 1px solid #92E4DD; border-radius: 12px; padding: 30px; }
    h1 { color: #C4B643; text-align: center; margin: 0 0 20px; }
    input { width: 100%; padding: 15px; margin: 10px 0; border: 1px solid #92E4DD; border-radius: 8px; background: transparent; color: #92E4DD; font-size: 16px; box-sizing: border-box; }
    input::placeholder { color: #888; }
    button { width: 100%; padding: 15px; background: #92E4DD; color: #0A0A07; border: none; border-radius: 8px; font-size: 16px; font-weight: bold; cursor: pointer; margin: 5px 0; }
    button:hover { background: #C4B643; }
    .error { color: #F9386D; margin: 10px 0; }
    a { color: #C4B643; }
    .hidden { display: none; }
    #messages { background: rgba(0,0,0,0.3); border: 1px solid #444; border-radius: 8px; padding: 15px; min-height: 200px; max-height: 300px; overflow-y: auto; margin: 15px 0; text-align: left; }
    .message { margin: 10px 0; }
    .message.user { text-align: right; }
    .message.bot { text-align: left; }
    .bubble { display: inline-block; padding: 10px 15px; border-radius: 15px; max-width: 80%; }
    .message.user .bubble { background: #C4B643; color: #0A0A07; }
    .message.bot .bubble { background: rgba(146,228,221,0.2); border: 1px solid #92E4DD; }
    .sources { font-size: 12px; color: #888; margin-top: 5px; }
  </style>
</head>
<body>
  <div class="container">
    <h1>Oculory</h1>
    <div id="login-view">
      <p>Enter invite code:</p>
      <input type="text" id="code" placeholder="Enter code" />
      <button onclick="join()">Join Chat</button>
      <p class="error" id="msg"></p>
      <p style="margin-top:20px"><a href="#" onclick="showOwner()">Owner login</a></p>
    </div>
    <div id="owner-view" class="hidden">
      <p>Owner code:</p>
      <input type="password" id="owner-code" placeholder="Enter owner code" />
      <button onclick="ownerLogin()">Login</button>
      <p class="error" id="owner-msg"></p>
      <p style="margin-top:20px"><a href="#" onclick="showLogin()">Back to login</a></p>
    </div>
    <div id="chat-view" class="hidden">
      <div id="messages"></div>
      <input type="text" id="query" placeholder="Ask a question..." onkeypress="if(event.key==='Enter')ask()" />
      <button onclick="ask()">Ask</button>
    </div>
    <div id="dashboard-view" class="hidden">
      <h2>Owner Dashboard</h2>
      <button onclick="createInvite()">Create Invite</button>
      <button onclick="listInvites()">View Invites</button>
      <div id="dashboard-content" style="margin-top:20px"></div>
      <p style="margin-top:20px"><a href="#" onclick="showLogin()">Logout</a></p>
    </div>
  </div>
  <script>
    function join() {
      var code = document.getElementById('code').value;
      fetch('/api/verify', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({code:code}) })
        .then(function(r){return r.json()})
        .then(function(d){
          if(d.valid){
            document.getElementById('login-view').classList.add('hidden');
            document.getElementById('chat-view').classList.remove('hidden');
          }else{
            document.getElementById('msg').textContent='Invalid code';
          }
        });
    }
    function showOwner(){document.getElementById('login-view').classList.add('hidden');document.getElementById('owner-view').classList.remove('hidden');}
    function showLogin(){document.getElementById('owner-view').classList.add('hidden');document.getElementById('dashboard-view').classList.add('hidden');document.getElementById('chat-view').classList.add('hidden');document.getElementById('login-view').classList.remove('hidden');}
    function ownerLogin(){
      var code=document.getElementById('owner-code').value;
      if(code==='OWNER2026'){
        document.getElementById('owner-view').classList.add('hidden');
        document.getElementById('dashboard-view').classList.remove('hidden');
      }else{
        document.getElementById('owner-msg').textContent='Invalid code';
      }
    }
    function createInvite(){
      var name=prompt('Friend name:');
      if(!name)return;
      var code=Math.random().toString(36).substring(2,10).toUpperCase();
      alert('Invite created! Code: '+code);
      navigator.clipboard.writeText(code);
    }
    function listInvites(){
      document.getElementById('dashboard-content').innerHTML='<div style="background:rgba(146,228,221,0.1);padding:15px;border-radius:8px"><strong>Demo User</strong><br/>Code: HACK2026<br/>Status: active</div>';
    }
    function ask(){
      var q=document.getElementById('query').value;
      if(!q)return;
      var ms=document.getElementById('messages');
      ms.innerHTML+='<div class="message user"><div class="bubble">'+q+'</div></div>';
      document.getElementById('query').value='';
      ms.innerHTML+='<div class="message bot"><div class="bubble">Thinking...</div></div>';
      ms.scrollTop=ms.scrollHeight;
      fetch('/api/query',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({query:q})})
        .then(function(r){return r.json()})
        .then(function(d){
          ms.removeChild(ms.lastChild);
          ms.innerHTML+='<div class="message bot"><div class="bubble">'+(d.response||d.error)+'</div></div>';
          ms.scrollTop=ms.scrollHeight;
        });
    }
  </script>
</body>
</html>`;

app.get("/", function(req, res) { res.send(HTML); });

app.post("/api/verify", express.json(), function(req, res) {
  if (invites.has(req.body.code)) res.json({ valid: true });
  else res.json({ valid: false });
});

app.post("/api/query", express.json(), async function(req, res) {
  const docs = await docsPromise;
  const results = searchDocs(docs, req.body.query);
  const response = await generateResponse(req.body.query, results);
  res.json({ response: response });
});

app.listen(PORT, function() { console.log("Server on "+PORT); });
