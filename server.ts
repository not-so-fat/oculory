import "dotenv/config";
import express from "express";
import fs from "fs";
import path from "path";
import matter from "gray-matter";

// ArmorIQ-like access control (inlined to avoid Vercel import issues)
interface AccessPolicy {
  allowedProjects: string[];
  allowedLayers: string[];
}

class ArmorIQAccess {
  private policies = new Map<string, AccessPolicy>();
  
  setPolicy(userId: string, policy: AccessPolicy) {
    this.policies.set(userId, policy);
  }
  
  canSearch(userId: string): boolean {
    return this.policies.has(userId);
  }
  
  canRead(userId: string, project: string, layer: string): boolean {
    const policy = this.policies.get(userId);
    if (!policy) return false;
    if (!policy.allowedProjects.includes(project) && !policy.allowedProjects.includes("default")) return false;
    if (!policy.allowedLayers.includes(layer)) return false;
    return true;
  }
  
  getFilters(userId: string): AccessPolicy {
    return this.policies.get(userId) || { allowedProjects: ["default"], allowedLayers: ["memory", "people", "meeting", "metadata", "transcript"] };
  }
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
  const context = results.map(r => `[${r.title}] (${r.layer}): ${r.content.slice(0, 1000)}`).join("\n\n");
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
const armorIQ = new ArmorIQAccess();

// Define two users with different access levels
const users = new Map([
  ["USER001", { 
    name: "Full Access User", 
    code: "FULL2026", 
    projects: ["default", "personal"], 
    layers: ["memory", "people", "meeting", "metadata", "transcript"] 
  }],
  ["USER002", { 
    name: "Limited User (Metadata + Aaron)", 
    code: "LIMITED2026", 
    projects: ["default"], 
    layers: ["metadata", "people"]  // Can only see Metadata layer and People layer (for Aaron)
  }]
]);

// Set ArmorIQ policies for each user
users.forEach((u, id) => {
  armorIQ.setPolicy(id, { allowedProjects: u.projects, allowedLayers: u.layers });
  console.log(`[ArmorIQ] Policy set for ${u.name}: projects=${u.projects.join(",")}, layers=${u.layers.join(",")}`);
});

// Simple session store
const sessions = new Map<string, string>(); // sessionToken -> userId

// HTML
const HTML = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Oculory - ArmorIQ Access Control</title>
  <style>
    body { font-family: -apple-system, sans-serif; max-width: 700px; margin: 50px auto; padding: 20px; background: #0A0A07; color: #92E4DD; }
    .container { background: rgba(146,228,221,0.05); border: 1px solid #92E4DD; border-radius: 12px; padding: 30px; }
    h1 { color: #C4B643; text-align: center; margin: 0 0 20px; }
    h2 { color: #92E4DD; margin: 20px 0 10px; }
    .info { background: rgba(146,228,221,0.1); padding: 10px; border-radius: 8px; margin: 10px 0; font-size: 14px; }
    input { width: 100%; padding: 15px; margin: 10px 0; border: 1px solid #92E4DD; border-radius: 8px; background: transparent; color: #92E4DD; font-size: 16px; box-sizing: border-box; }
    input::placeholder { color: #888; }
    button { width: 100%; padding: 15px; background: #92E4DD; color: #0A0A07; border: none; border-radius: 8px; font-size: 16px; font-weight: bold; cursor: pointer; margin: 5px 0; }
    button:hover { background: #C4B643; }
    button.secondary { background: transparent; border: 1px solid #92E4DD; color: #92E4DD; }
    button.secondary:hover { background: rgba(146,228,221,0.1); }
    .error { color: #F9386D; margin: 10px 0; }
    a { color: #C4B643; }
    .hidden { display: none; }
    #messages { background: rgba(0,0,0,0.3); border: 1px solid #444; border-radius: 8px; padding: 15px; min-height: 200px; max-height: 300px; overflow-y: auto; margin: 15px 0; text-align: left; }
    .message { margin: 10px 0; }
    .message.user { text-align: right; }
    .bubble { display: inline-block; padding: 10px 15px; border-radius: 15px; max-width: 80%; }
    .message.user .bubble { background: #C4B643; color: #0A0A07; }
    .message.bot .bubble { background: rgba(146,228,221,0.2); border: 1px solid #92E4DD; }
    .sources { font-size: 12px; color: #888; margin-top: 5px; }
    .access-info { background: rgba(196,182,67,0.2); border: 1px solid #C4B643; padding: 10px; border-radius: 8px; margin: 10px 0; }
  </style>
</head>
<body>
  <div class="container">
    <h1>Oculory - ArmorIQ Demo</h1>
    <p style="text-align:center;color:#888">Testing access control with ArmorIQ</p>
    
    <div id="login-view">
      <h2>Choose a user to test:</h2>
      <div class="info">
        <strong>User 1:</strong> FULL2026<br/>
        <span style="color:#888">Access: All projects, All layers</span>
      </div>
      <div class="info">
        <strong>User 2:</strong> LIMITED2026<br/>
        <span style="color:#888">Access: Default project only, Metadata + People layers only</span>
      </div>
      <input type="text" id="code" placeholder="Enter invite code" />
      <button onclick="join()">Join Chat</button>
      <p class="error" id="msg"></p>
    </div>
    
    <div id="chat-view" class="hidden">
      <div class="access-info" id="user-access"></div>
      <div id="messages"></div>
      <input type="text" id="query" placeholder="Ask about Satish..." onkeypress="if(event.key==='Enter')ask()" />
      <button onclick="ask()">Ask</button>
      <button class="secondary" onclick="logout()">Logout</button>
    </div>
  </div>
  <script>
    var sessionToken = null;
    var currentUser = null;
    
    function join(){
      var code=document.getElementById('code').value;
      fetch('/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code:code})})
        .then(function(r){return r.json()})
        .then(function(d){
          if(d.valid){
            sessionToken=d.token;
            currentUser=d.user;
            document.getElementById('login-view').classList.add('hidden');
            document.getElementById('chat-view').classList.remove('hidden');
            document.getElementById('user-access').innerHTML='<strong>Logged in as:</strong> '+d.name+'<br/><strong>Projects:</strong> '+d.projects.join(', ')+'<br/><strong>Layers:</strong> '+d.layers.join(', ');
          }else{
            document.getElementById('msg').textContent=' Invalid code';
          }
        });
    }
    function logout(){
      sessionToken=null;
      currentUser=null;
      document.getElementById('chat-view').classList.add('hidden');
      document.getElementById('login-view').classList.remove('hidden');
      document.getElementById('messages').innerHTML='';
    }
    function ask(){
      var q=document.getElementById('query').value;
      if(!q)return;
      var ms=document.getElementById('messages');
      ms.innerHTML+='<div class="message user"><div class="bubble">'+q+'</div></div>';
      document.getElementById('query').value='';
      ms.innerHTML+='<div class="message bot"><div class="bubble">Thinking...</div></div>';
      ms.scrollTop=ms.scrollHeight;
      fetch('/api/query',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({query:q,token:sessionToken})})
        .then(function(r){return r.json()})
        .then(function(d){
          ms.removeChild(ms.lastChild);
          var html='<div class="message bot"><div class="bubble">'+(d.response||d.error)+'</div>';
          if(d.sources&&d.sources.length){
            html+='<div class="sources">Sources: '+d.sources.map(function(s){return s.title+' ('+s.layer+')';}).join(', ')+'</div>';
          }
          html+='</div>';
          ms.innerHTML+=html;
          ms.scrollTop=ms.scrollHeight;
        });
    }
  </script>
</body>
</html>`;

app.get("/", function(req, res) { res.send(HTML); });

// Login - returns user info and session token
app.post("/api/login", express.json(), function(req, res) {
  const { code } = req.body;
  for (const [userId, u] of users.entries()) {
    if (u.code === code) {
      const token = "token_" + Math.random().toString(36).slice(2);
      sessions.set(token, userId);
      console.log(`[ArmorIQ] User ${u.name} logged in with token ${token}`);
      res.json({ valid: true, token: token, user: userId, name: u.name, projects: u.projects, layers: u.layers });
      return;
    }
  }
  res.json({ valid: false });
});

// Query - ArmorIQ access control
app.post("/api/query", express.json(), async function(req, res) {
  const { query, token } = req.body;
  const userId = sessions.get(token);
  
  if (!userId) {
    res.json({ error: "Not authenticated" });
    return;
  }
  
  const user = users.get(userId);
  console.log(`\n[Query] User: ${user.name}, Query: "${query}"`);
  
  // ArmorIQ access check
  console.log(`[ArmorIQ] Checking access for user ${userId}...`);
  const filters = armorIQ.getFilters(userId);
  console.log(`[ArmorIQ] Allowed projects: ${filters.allowedProjects.join(",")}`);
  console.log(`[ArmorIQ] Allowed layers: ${filters.allowedLayers.join(",")}`);
  
  const docs = await docsPromise;
  
  // Filter by ArmorIQ policy
  const accessibleDocs = docs.filter(d => {
    const projectOk = filters.allowedProjects.includes(d.project) || filters.allowedProjects.includes("default");
    const layerOk = filters.allowedLayers.includes(d.layer);
    return projectOk && layerOk;
  });
  
  console.log(`[ArmorIQ] Filtered ${docs.length} docs -> ${accessibleDocs.length} accessible`);
  
  const results = searchDocs(accessibleDocs, query);
  console.log(`[ArmorIQ] Search returned ${results.length} results`);
  
  const response = await generateResponse(query, results);
  
  res.json({ 
    response: response,
    sources: results.map(r => ({ title: r.title, layer: r.layer, project: r.project }))
  });
});

app.listen(PORT, function() { 
  console.log(`\n========================================`);
  console.log(`Oculory Server - ArmorIQ Demo`);
  console.log(`========================================`);
  console.log(`Server: http://localhost:${PORT}`);
  console.log(`\nTest Users:`);
  users.forEach((u) => {
    console.log(`  ${u.code}: ${u.name}`);
    console.log(`    Projects: ${u.projects.join(", ")}`);
    console.log(`    Layers: ${u.layers.join(", ")}`);
  });
  console.log(`\n========================================\n`);
});
