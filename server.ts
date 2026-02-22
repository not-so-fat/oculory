import "dotenv/config";
import express from "express";
import fs from "fs";
import path from "path";
import matter from "gray-matter";

const app = express();
app.use(express.json());

const MINIMAX_API_KEY = process.env.MINIMAX_API_KEY || "";
const ARMORIQ_API_KEY = process.env.ARMORIQ_API_KEY || "";
const GIST_URL = process.env.GIST_URL || "";
const PORT = process.env.PORT || 8080;

// Types
interface Doc { layer: string; project: string; title: string; content: string; }
interface AccessPolicy { allowedProjects: string[]; allowedLayers: string[]; }
interface AgentPlan { goal: string; steps: { action: string; params: Record<string, unknown>; }[]; }

// ArmorIQ Client (mock for now - needs real API key)
class ArmorIQClient {
  private policies = new Map<string, AccessPolicy>();
  
  setPolicy(userId: string, policy: AccessPolicy) {
    this.policies.set(userId, policy);
  }
  
  // Step 1: Capture intent - LLM creates plan, ArmorIQ verifies and returns token
  async captureIntent(userId: string, query: string, plan: AgentPlan): Promise<{ token: string; allowed: boolean }> {
    const policy = this.policies.get(userId);
    if (!policy) return { token: "", allowed: false };
    
    // Verify all steps comply with policy
    for (const step of plan.steps) {
      if (step.action === "search") {
        const params = step.params;
        const layers = (params.layers as string[]) || [];
        const projects = (params.projects as string[]) || [];
        
        // Check if requested layers are allowed
        for (const layer of layers) {
          if (!policy.allowedLayers.includes(layer)) {
            console.log(`[ArmorIQ] DENIED: layer "${layer}" not in allowed ${policy.allowedLayers.join(", ")}`);
            return { token: "", allowed: false };
          }
        }
        for (const project of projects) {
          if (!policy.allowedProjects.includes(project)) {
            console.log(`[ArmorIQ] DENIED: project "${project}" not in allowed ${policy.allowedProjects.join(", ")}`);
            return { token: "", allowed: false };
          }
        }
      }
    }
    
    // Generate token (in real impl, this would be cryptographic)
    const token = `armoriq_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    console.log(`[ArmorIQ] APPROVED: token=${token}, plan=${JSON.stringify(plan)}`);
    return { token, allowed: true };
  }
  
  // Step 2: Verify action against token
  async verifyAction(token: string, action: string, params: Record<string, unknown>): Promise<boolean> {
    if (!token.startsWith("armoriq_")) return false;
    console.log(`[ArmorIQ] VERIFIED: action=${action}, params=${JSON.stringify(params)}`);
    return true;
  }
  
  getPolicy(userId: string): AccessPolicy {
    return this.policies.get(userId) || { allowedProjects: [], allowedLayers: [] };
  }
}

// Agent - uses LLM to create plan, then executes with ArmorIQ verification
class Agent {
  private armorIQ: ArmorIQClient;
  private docs: Doc[];
  
  constructor(armorIQ: ArmorIQClient, docs: Doc[]) {
    this.armorIQ = armorIQ;
    this.docs = docs;
  }
  
  // LLM creates a plan based on query
  private async createPlan(userId: string, query: string): Promise<AgentPlan> {
    const policy = this.armorIQ.getPolicy(userId);
    
    // Ask LLM to determine which layers/projects to search
    const prompt = `User query: "${query}"
    
Allowed layers: ${policy.allowedLayers.join(", ")}
Allowed projects: ${policy.allowedProjects.join(", ")}

Determine:
1. What layers to search (choose from allowed)
2. What projects to search (choose from allowed)
3. Extract key search terms

Return as JSON:
{
  "goal": "what the user wants",
  "steps": [
    {"action": "search", "params": {"layers": ["..."], "projects": ["..."], "query": "..."}}
  ]
}`;

    try {
      const res = await fetch("https://api.minimax.io/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${MINIMAX_API_KEY}` },
        body: JSON.stringify({
          model: "MiniMax-M2.5",
          messages: [{ role: "system", content: "You are a planning assistant. Return only valid JSON." }, { role: "user", content: prompt }],
          temperature: 0.3
        })
      });
      const data = await res.json();
      const content = data.choices?.[0]?.message?.content || "";
      
      // Extract JSON from response
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const plan = JSON.parse(jsonMatch[0]);
        console.log(`[Agent] LLM created plan:`, plan);
        return plan;
      }
    } catch (e) {
      console.error("[Agent] LLM planning error:", e);
    }
    
    // Fallback: search all allowed
    return {
      goal: query,
      steps: [{ action: "search", params: { layers: policy.allowedLayers, projects: policy.allowedProjects, query } }]
    };
  }
  
  // Execute query through agent with ArmorIQ verification
  async process(userId: string, query: string): Promise<{ response: string; sources: unknown[]; plan: AgentPlan }> {
    // Step 1: LLM creates plan
    const plan = await this.createPlan(userId, query);
    console.log(`\n[Agent] Step 1: Plan created`);
    
    // Step 2: ArmorIQ captures intent and returns token
    const { token, allowed } = await this.armorIQ.captureIntent(userId, query, plan);
    if (!allowed) {
      return { response: "Access denied: Your query requires resources you don't have permission to access.", sources: [], plan };
    }
    console.log(`[Agent] Step 2: ArmorIQ intent captured, token=${token}`);
    
    // Step 3: Execute each step with token verification
    const results: Doc[] = [];
    for (const step of plan.steps) {
      if (step.action === "search") {
        // Verify action
        const verified = await this.armorIQ.verifyAction(token, step.action, step.params);
        if (!verified) {
          console.log(`[Agent] Step verification failed`);
          continue;
        }
        
        const params = step.params;
        const layers = (params.layers as string[]) || [];
        const projects = (params.projects as string[]) || [];
        const searchQuery = params.query as string;
        
        // Filter docs by plan params
        const filtered = this.docs.filter(d => 
          layers.includes(d.layer) && projects.includes(d.project)
        );
        
        // Search
        const qWords = searchQuery.toLowerCase().split(" ").filter(w => w.length > 2);
        const scored = filtered.map(d => {
          let score = 0;
          if (d.title.toLowerCase().includes(searchQuery.toLowerCase())) score += 15;
          if (d.content.toLowerCase().includes(searchQuery.toLowerCase())) score += 3;
          return { doc: d, score };
        }).filter(s => s.score > 0).sort((a, b) => b.score - a.score).slice(0, 5);
        
        results.push(...scored.map(s => s.doc));
        console.log(`[Agent] Step 3: Executed search, found ${scored.length} results`);
      }
    }
    
    // Step 4: Generate response
    const context = results.map(r => `[${r.title}]: ${r.content.slice(500)}`).join("\n");
    let response = results.length > 0 
      ? `Found ${results.length} relevant documents.\n\n${results[0].content.slice(300)}`
      : "No relevant information found.";
    
    if (MINIMAX_API_KEY && results.length > 0) {
      try {
        const res = await fetch("https://api.minimax.io/v1/chat/completions", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${MINIMAX_API_KEY}` },
          body: JSON.stringify({
            model: "MiniMax-M2.5",
            messages: [{ role: "system", content: "You are Yusuke. Answer the user's question based on the context." }, { role: "user", content: `Query: ${query}\n\nContext:\n${context}` }]
          })
        });
        const data = await res.json();
        response = data.choices?.[0]?.message?.content || response;
      } catch (e) {}
    }
    
    return { response, sources: results, plan };
  }
}

// Load documents
async function loadDocuments(): Promise<Doc[]> {
  if (GIST_URL) {
    try { return await (await fetch(GIST_URL)).json() as Doc[]; } catch { return []; }
  }
  const layers = ["Memory", "People", "Meetings", "Metadata", "Transcripts"];
  const docs: Doc[] = [];
  for (const layer of layers) {
    const layerPath = path.join(process.cwd(), "data", layer);
    if (!fs.existsSync(layerPath)) continue;
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(fullPath);
        else if (entry.name.endsWith(".md")) {
          try {
            const { data, content } = matter(fs.readFileSync(fullPath, "utf-8"));
            if (content.trim()) {
              // Extract project from path
              const parts = fullPath.split("/");
              const layerIdx = parts.findIndex(p => p.toLowerCase() === layer.toLowerCase());
              const project = layerIdx >= 0 && parts[layerIdx + 1] ? parts[layerIdx + 1].toLowerCase() : "default";
              docs.push({ layer: layer.toLowerCase(), project, title: (data.title as string) || entry.name.replace(".md", ""), content });
            }
          } catch {}
        }
      }
    };
    walk(layerPath);
  }
  return docs;
}

// Initialize
const armorIQ = new ArmorIQClient();
loadDocuments().then(docs => {
  console.log(`Loaded ${docs.length} documents`);
  
  // Demo users with different access levels
  const users = new Map([
    ["USER001", { code: "FULL2026", name: "Full Access", policy: { allowedProjects: ["personal", "fireflies", "manual", "career", "dotdata", "non-work", "default", "unknown"], allowedLayers: ["memory", "people", "meeting", "metadata", "transcript"] } }],
    ["USER002", { code: "LIMITED2026", name: "Limited User", policy: { allowedProjects: ["unknown", "default"], allowedLayers: ["metadata", "people"] } }]
  ]);
  
  // Set policies
  users.forEach((u, id) => armorIQ.setPolicy(id, u.policy));
  
  const agent = new Agent(armorIQ, docs);

  // HTML
  const HTML = `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Oculory - Agent with ArmorIQ</title>
<style>
body{font-family:-apple-system,sans-serif;max-width:700px;margin:50px auto;padding:20px;background:#0A0A07;color:#92E4DD}
.container{background:rgba(146,228,221,0.05);border:1px solid #92E4DD;border-radius:12px;padding:30px}
h1{color:#C4B643;text-align:center}
.info{background:rgba(146,228,221,0.1);padding:10px;border-radius:8px;margin:10px 0;font-size:14px}
input{width:100%;padding:15px;margin:10px 0;border:1px solid #92E4DD;border-radius:8px;background:transparent;color:#92E4DD;font-size:16px;box-sizing:border-box}
button{width:100%;padding:15px;background:#92E4DD;color:#0A0A07;border:none;border-radius:8px;font-size:16px;font-weight:bold;cursor:pointer;margin:5px 0}
button:hover{background:#C4B643}
.hidden{display:none}
#messages{background:rgba(0,0,0,0.3);border:1px solid #444;border-radius:8px;padding:15px;min-height:200px;max-height:400px;overflow-y:auto;margin:15px 0;text-align:left}
.message{margin:10px 0}
.bubble{display:inline-block;padding:10px 15px;border-radius:15px;max-width:80%}
.message.user .bubble{background:#C4B643;color:#0A0A07}
.message.bot .bubble{background:rgba(146,228,221,0.2);border:1px solid #92E4DD}
.plan{background:rgba(196,182,67,0.1);border:1px solid #C4B643;padding:10px;border-radius:8px;margin:10px 0;font-size:12px;font-family:monospace}
.sources{font-size:12px;color:#888;margin-top:5px}
</style></head>
<body><div class="container">
<h1>Oculory - Agent Demo</h1>
<p style="text-align:center;color:#888">LLM Agent + ArmorIQ Access Control</p>
<div id="login-view">
<h2>Select User:</h2>
<div class="info"><strong>FULL2026</strong> - All projects, all layers</div>
<div class="info"><strong>LIMITED2026</strong> - Only unknown project, metadata+people layers</div>
<input type="text" id="code" placeholder="Enter code" />
<button onclick="join()">Start Chat</button>
<p class="error" id="msg"></p>
</div>
<div id="chat-view" class="hidden">
<div class="info" id="user-info"></div>
<div id="messages"></div>
<input type="text" id="query" placeholder="Ask about anything..." onkeypress="if(event.key==='Enter')ask()" />
<button onclick="ask()">Ask Agent</button>
<button onclick="logout()" style="background:transparent;border:1px solid #92E4DD;color:#92E4DD">Logout</button>
</div>
</div>
<script>
var token=null,userId=null;
function join(){
  var code=document.getElementById('code').value;
  fetch('/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code:code})})
    .then(r=>r.json()).then(d=>{
      if(d.valid){token=d.token;userId=d.user;
        document.getElementById('login-view').classList.add('hidden');
        document.getElementById('chat-view').classList.remove('hidden');
        document.getElementById('user-info').innerHTML='<strong>'+d.name+'</strong><br/>Projects: '+d.projects.join(', ')+'<br/>Layers: '+d.layers.join(', ');
      }else document.getElementById('msg').textContent='Invalid code';
    });
}
function logout(){token=null;userId=null;location.reload();}
function ask(){
  var q=document.getElementById('query').value;if(!q)return;
  var ms=document.getElementById('messages');
  ms.innerHTML+='<div class="message user"><div class="bubble">'+q+'</div></div>';
  document.getElementById('query').value='';
  ms.innerHTML+='<div class="message bot"><div class="bubble">Agent is thinking...</div></div>';
  ms.scrollTop=ms.scrollHeight;
  fetch('/api/query',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({query:q,token:token})})
    .then(r=>r.json()).then(d=>{
      ms.removeChild(ms.lastChild);
      if(d.error){ms.innerHTML+='<div class="message bot"><div class="bubble">'+d.error+'</div></div>';return;}
      var html='<div class="message bot"><div class="bubble">'+d.response+'</div>';
      if(d.plan)html+='<div class="plan">Plan: '+JSON.stringify(d.plan)+'</div>';
      if(d.sources&&d.sources.length)html+='<div class="sources">Sources: '+d.sources.map(s=>s.title).join(', ')+'</div>';
      html+='</div>';
      ms.innerHTML+=html;
      ms.scrollTop=ms.scrollHeight;
    });
}
</script></body></html>`;

  app.get("/", (req, res) => res.send(HTML));
  
  app.post("/api/login", express.json(), (req, res) => {
    const { code } = req.body;
    for (const [id, u] of users.entries()) {
      if (u.code === code) {
        const sessionToken = "session_" + Math.random().toString(36).slice(2);
        console.log(`[Auth] User ${u.name} logged in`);
        res.json({ valid: true, token: sessionToken, user: id, name: u.name, projects: u.policy.allowedProjects, layers: u.policy.allowedLayers });
        return;
      }
    }
    res.json({ valid: false });
  });
  
  app.post("/api/query", express.json(), async (req, res) => {
    const { query, token: sessionToken } = req.body;
    // For demo, just use first user - in real app, map token to user
    const userId = "USER001";
    
    console.log(`\n[Query] User: ${userId}, Query: "${query}"`);
    
    try {
      const result = await agent.process(userId, query);
      res.json({ response: result.response, sources: result.sources, plan: result.plan });
    } catch (e) {
      res.json({ error: "Agent error: " + String(e) });
    }
  });
  
  app.listen(PORT, () => console.log(`\nOculory Agent - http://localhost:${PORT}\nFULL2026 / LIMITED2026\n`));
});
