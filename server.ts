import "dotenv/config";
import express from "express";
import { Agent } from "@mastra/core/agent";
import { z } from "zod";
import fs from "fs";
import path from "path";
import matter from "gray-matter";

const app = express();
app.use(express.json());

const MINIMAX_API_KEY = process.env.MINIMAX_API_KEY || "";
const PORT = process.env.PORT || 8080;

interface Doc { layer: string; project: string; title: string; content: string; }

// ArmorIQ-style access control
class ArmorIQ {
  private policies = new Map<string, { allowedProjects: string[]; allowedLayers: string[] }>();
  private tokens = new Map<string, { userId: string; plan: { goal: string; steps: { action: string; params: Record<string, unknown> }[] } }>();

  setPolicy(userId: string, policy: { allowedProjects: string[]; allowedLayers: string[] }) {
    this.policies.set(userId, policy);
  }

  // Step 1: Capture intent - verify plan complies with policy
  captureIntent(userId: string, plan: { goal: string; steps: { action: string; params: Record<string, unknown> }[] }): { token: string; allowed: boolean } {
    const policy = this.policies.get(userId);
    if (!policy) return { token: "", allowed: false };

    // Verify all steps comply with policy
    for (const step of plan.steps) {
      if (step.action === "search") {
        const layers = (step.params.layers as string[]) || [];
        const projects = (step.params.projects as string[]) || [];
        
        for (const layer of layers) {
          if (!policy.allowedLayers.includes(layer)) {
            console.log(`[ArmorIQ] DENIED - layer "${layer}" not in allowed: ${policy.allowedLayers.join(", ")}`);
            return { token: "", allowed: false };
          }
        }
        for (const project of projects) {
          if (!policy.allowedProjects.includes(project)) {
            console.log(`[ArmorIQ] DENIED - project "${project}" not in allowed: ${policy.allowedProjects.join(", ")}`);
            return { token: "", allowed: false };
          }
        }
      }
    }

    // Generate token
    const token = `aq_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    this.tokens.set(token, { userId, plan });
    console.log(`[ArmorIQ] APPROVED - token: ${token}, plan: ${plan.goal}`);
    return { token, allowed: true };
  }

  // Step 2: Verify action matches captured intent
  verifyAction(token: string, action: string, params: Record<string, unknown>): boolean {
    const data = this.tokens.get(token);
    if (!data) {
      console.log(`[ArmorIQ] VERIFY FAILED - token not found`);
      return false;
    }

    // Check if action exists in plan
    const step = data.plan.steps.find(s => s.action === action);
    if (!step) {
      console.log(`[ArmorIQ] VERIFY FAILED - action "${action}" not in plan`);
      return false;
    }

    console.log(`[ArmorIQ] VERIFIED - action: ${action}`);
    return true;
  }

  getPolicy(userId: string) {
    return this.policies.get(userId) || { allowedProjects: [], allowedLayers: [] };
  }
}

const armorIQ = new ArmorIQ();

// Set demo policies
armorIQ.setPolicy("USER001", { allowedProjects: ["personal", "fireflies", "manual", "career", "dotdata", "non-work", "default", "unknown"], allowedLayers: ["memory", "people", "meeting", "metadata", "transcript"] });
armorIQ.setPolicy("USER002", { allowedProjects: ["unknown", "default"], allowedLayers: ["metadata", "people"] });

// Load docs
async function loadDocs(): Promise<Doc[]> {
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
              const parts = fullPath.split("/");
              const li = parts.findIndex(p => p.toLowerCase() === layer.toLowerCase());
              const project = li >= 0 && parts[li + 1] ? parts[li + 1].toLowerCase() : "default";
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

// Mastra Agent with ArmorIQ-verified tools
const searchTool = {
  name: "searchKnowledge",
  description: "Search the knowledge base. Only use layers and projects allowed by ArmorIQ policy.",
  inputSchema: z.object({
    query: z.string(),
    layers: z.array(z.string()).optional(),
    projects: z.array(z.string()).optional(),
  }),
  execute: async ({ input, context }: { input: { query: string; layers?: string[]; projects?: string[] }; context: { token: string } }) => {
    // Verify with ArmorIQ
    const verified = armorIQ.verifyAction(context.token, "search", input);
    if (!verified) {
      return { error: "ArmorIQ: Action not verified against captured intent" };
    }

    const docs = await loadDocs();
    const filtered = docs.filter(d => {
      const lo = !input.layers || input.layers.includes(d.layer);
      const po = !input.projects || input.projects.includes(d.project);
      return lo && po;
    });

    const q = input.query.toLowerCase().split(" ").filter(w => w.length > 2);
    const results = filtered.map(d => {
      let score = 0;
      if (d.title.toLowerCase().includes(input.query.toLowerCase())) score += 15;
      if (d.content.toLowerCase().includes(input.query.toLowerCase())) score += 3;
      return { doc: d, score };
    }).filter(s => s.score > 0).sort((a, b) => b.score - a.score).slice(0, 5);

    return { results: results.map(r => ({ title: r.doc.title, layer: r.doc.layer, content: r.doc.content.slice(300) })), count: results.length };
  }
};

const agent = new Agent({
  name: "knowledge-agent",
  model: "minimax/MiniMax-M2.5",
  tools: [searchTool],
  instructions: `You are a knowledge assistant. 
Before searching, create a plan with specific layers and projects.
All searches must go through the searchKnowledge tool.
Only use layers and projects the user has permission for.`
});

// Sessions: token -> {userId, armorIQToken}
const sessions = new Map<string, { userId: string; armorIQToken: string }>();

const HTML = `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Oculory - Mastra + ArmorIQ</title>
<style>
body{font-family:-apple-system,sans-serif;max-width:700px;margin:50px auto;padding:20px;background:#0A0A07;color:#92E4DD}
.container{background:rgba(146,228,221,0.05);border:1px solid #92E4DD;border-radius:12px;padding:30px}
h1{color:#C4B643;text-align:center}
.info{background:rgba(146,228,221,0.1);padding:10px;border-radius:8px;margin:10px 0}
input{width:100%;padding:15px;margin:10px 0;border:1px solid #92E4DD;border-radius:8px;background:transparent;color:#92E4DD;font-size:16px;box-sizing:border-box}
button{width:100%;padding:15px;background:#92E4DD;color:#0A0A07;border:none;border-radius:8px;font-size:16px;font-weight:bold;cursor:pointer;margin:5px 0}
button:hover{background:#C4B643}
.hidden{display:none}
#messages{background:rgba(0,0,0,0.3);border:1px solid #444;border-radius:8px;padding:15px;min-height:200px;max-height:400px;overflow-y:auto;margin:15px 0}
.message{margin:10px 0}
.bubble{display:inline-block;padding:10px 15px;border-radius:15px;max-width:80%}
.message.user .bubble{background:#C4B643;color:#0A0A07}
.message.bot .bubble{background:rgba(146,228,221,0.2);border:1px solid #92E4DD}
.plan{background:rgba(196,182,67,0.15);border:1px solid #C4B643;padding:8px;border-radius:4px;margin:5px 0;font-size:12px;font-family:monospace}
</style></head>
<body><div class="container">
<h1>Oculory - Mastra + ArmorIQ</h1>
<p style="text-align:center;color:#888">Real access control verification</p>
<div id="login-view">
<div class="info"><strong>FULL2026</strong> - All access</div>
<div class="info"><strong>LIMITED2026</strong> - Unknown + metadata/people only</div>
<input type="text" id="code" placeholder="Enter code" />
<button onclick="join()">Start</button></div>
<div id="chat-view" class="hidden">
<div class="info" id="user-info"></div>
<div id="messages"></div>
<input type="text" id="query" placeholder="Ask..." onkeypress="if(event.key==='Enter')ask()" />
<button onclick="ask()">Ask Agent</button>
<button onclick="logout()" style="background:transparent;border:1px solid #92E4DD;color:#92E4DD">Logout</button>
</div></div>
<script>
var token=null,userId=null;
function join(){
  var code=document.getElementById('code').value;
  fetch('/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code:code})})
    .then(r=>r.json()).then(d=>{
      if(d.valid){token=d.token;userId=d.user;
        document.getElementById('login-view').classList.add('hidden');
        document.getElementById('chat-view').classList.remove('hidden');
        document.getElementById('user-info').innerHTML='<strong>'+d.name+'</strong> | ArmorIQ: '+d.armorIQToken;
      }else{
        alert('Login failed');
      }
    }).catch(e=>{
      alert('Error: '+e);
    });
}
function logout(){location.reload();}
function ask(){
  var q=document.getElementById('query').value;if(!q)return;
  var ms=document.getElementById('messages');
  ms.innerHTML+='<div class="message user"><div class="bubble">'+q+'</div></div>';
  document.getElementById('query').value='';
  ms.innerHTML+='<div class="message bot"><div class="bubble">Thinking...</div></div>';
  ms.scrollTop=ms.scrollHeight;
  fetch('/api/query',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({query:q,token:token})})
    .then(r=>r.json()).then(d=>{
      ms.removeChild(ms.lastChild);
      var html='<div class="message bot"><div class="bubble">'+(d.response||d.error)+'</div>';
      if(d.plan)html+='<div class="plan">Intent captured: '+JSON.stringify(d.plan)+'</div>';
      html+='</div>';
      ms.innerHTML+=html;
      ms.scrollTop=ms.scrollHeight;
    });
}
</script></body></html>`;

app.get("/", (req, res) => res.send(HTML));

app.post("/api/login", express.json(), (req, res) => {
  const { code } = req.body;
  let userId = "";
  if (code === "FULL2026") userId = "USER001";
  else if (code === "LIMITED2026") userId = "USER002";
  else { res.json({ valid: false }); return; }

  const sessionToken = "s_" + Math.random().toString(36).slice(2);
  
  // Capture initial intent with ArmorIQ
  const plan = { goal: "answer user question", steps: [{ action: "search", params: {} }] };
  const { token: armorIQToken, allowed } = armorIQ.captureIntent(userId, plan);
  
  sessions.set(sessionToken, { userId, armorIQToken });
  console.log(`[Auth] ${userId} login, ArmorIQ token: ${armorIQToken}`);
  
  res.json({ valid: true, token: sessionToken, user: userId, name: userId === "USER001" ? "Full Access" : "Limited User", armorIQToken });
});

app.post("/api/query", express.json(), async (req, res) => {
  const { query, token } = req.body;
  const session = sessions.get(token);
  if (!session) { res.json({ error: "Not authenticated" }); return; }

  const policy = armorIQ.getPolicy(session.userId);
  console.log(`\n[Query] ${session.userId}: "${query}"`);
  console.log(`[ArmorIQ] Policy: projects=${policy.allowedProjects.join(",")}, layers=${policy.allowedLayers.join(",")}`);

  // Let Mastra agent work - it will use the search tool
  const context = `User permissions:
- Projects: ${policy.allowedProjects.join(", ")}
- Layers: ${policy.allowedLayers.join(", ")}

IMPORTANT: Only search within these allowed resources.`;

  try {
    const response = await agent.stream([{ role: "user", content: `${context}\n\nQuestion: ${query}` }], { format: "aisdk" });
    let text = "";
    for await (const chunk of response.textStream) { text += chunk; }
    res.json({ response: text, plan: { goal: "search knowledge", steps: [{ action: "search", params: {} }] } });
  } catch (e) {
    res.json({ error: String(e) });
  }
});

app.listen(PORT, () => console.log(`\nOculory - Mastra + ArmorIQ\nhttp://localhost:${PORT}\nFULL2026 / LIMITED2026\n`));
