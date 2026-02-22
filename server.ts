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

// Types
interface Doc { layer: string; project: string; title: string; content: string; }

// Load documents
async function loadDocuments(): Promise<Doc[]> {
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

// Access policies (ArmorIQ-style)
const policies = new Map<string, { allowedProjects: string[]; allowedLayers: string[] }>([
  ["USER001", { allowedProjects: ["personal", "fireflies", "manual", "career", "dotdata", "non-work", "default", "unknown"], allowedLayers: ["memory", "people", "meeting", "metadata", "transcript"] }],
  ["USER002", { allowedProjects: ["unknown", "default"], allowedLayers: ["metadata", "people"] }]
]);

// Tool: search knowledge base
const searchTool = {
  name: "searchKnowledge",
  description: "Search the knowledge base for information. Returns documents matching the query.",
  inputSchema: z.object({
    query: z.string().describe("Search query"),
    layers: z.array(z.string()).optional().describe("Which layers to search"),
    projects: z.array(z.string()).optional().describe("Which projects to search"),
  }),
  execute: async ({ input }: { input: { query: string; layers?: string[]; projects?: string[] } }) => {
    const docs = await loadDocuments();
    const qWords = input.query.toLowerCase().split(" ").filter(w => w.length > 2);
    
    const filtered = docs.filter(d => {
      const layerOk = !input.layers || input.layers.includes(d.layer);
      const projectOk = !input.projects || input.projects.includes(d.project);
      return layerOk && projectOk;
    });
    
    const results = filtered.map(d => {
      let score = 0;
      if (d.title.toLowerCase().includes(input.query.toLowerCase())) score += 15;
      if (d.content.toLowerCase().includes(input.query.toLowerCase())) score += 3;
      return { doc: d, score };
    }).filter(s => s.score > 0).sort((a, b) => b.score - a.score).slice(0, 5);
    
    return {
      results: results.map(r => ({ title: r.doc.title, layer: r.doc.layer, project: r.doc.project, content: r.doc.content.slice(200) })),
      count: results.length
    };
  }
};

// Create Mastra agent
const agent = new Agent({
  name: "knowledge-agent",
  model: {
    provider: "miniMax",
    name: "MiniMax-M2.5",
    apiKey: MINIMAX_API_KEY,
  },
  tools: [searchTool],
  instructions: `You are a helpful assistant that searches a knowledge base to answer user questions.
Before searching, check what layers and projects the user has access to.
Always use the searchKnowledge tool to find relevant information.
Provide clear, concise answers based on the search results.`
});

// Sessions
const sessions = new Map<string, string>();

const HTML = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Oculory - Mastra Agent</title>
  <style>
    body{font-family:-apple-system,sans-serif;max-width:700px;margin:50px auto;padding:20px;background:#0A0A07;color:#92E4DD}
    .container{background:rgba(146,228,221,0.05);border:1px solid #92E4DD;border-radius:12px;padding:30px}
    h1{color:#C4B643;text-align:center}
    .info{background:rgba(146,228,221,0.1);padding:10px;border-radius:8px;margin:10px 0;font-size:14px}
    input{width:100%;padding:15px;margin:10px 0;border:1px solid #92E4DD;border-radius:8px;background:transparent;color:#92E4DD;font-size:16px;box-sizing:border-box}
    button{width:100%;padding:15px;background:#92E4DD;color:#0A0A07;border:none;border-radius:8px;font-size:16px;font-weight:bold;cursor:pointer;margin:5px 0}
    button:hover{background:#C4B643}
    .hidden{display:none}
    #messages{background:rgba(0,0,0,0.3);border:1px solid #444;border-radius:8px;padding:15px;min-height:200px;max-height:400px;overflow-y:auto;margin:15px 0}
    .message{margin:10px 0}
    .bubble{display:inline-block;padding:10px 15px;border-radius:15px;max-width:80%}
    .message.user .bubble{background:#C4B643;color:#0A0A07}
    .message.bot .bubble{background:rgba(146,228,221,0.2);border:1px solid #92E4DD}
    .sources{font-size:12px;color:#888;margin-top:5px}
    .tool-call{background:rgba(196,182,67,0.1);border:1px solid #C4B643;padding:8px;border-radius:4px;margin:5px 0;font-size:12px;font-family:monospace}
  </style>
</head>
<body>
<div class="container">
<h1>Oculory - Mastra Agent</h1>
<p style="text-align:center;color:#888">Agent Framework + ArmorIQ Access Control</p>
<div id="login-view">
<h2>Select User:</h2>
<div class="info"><strong>FULL2026</strong> - All projects, all layers</div>
<div class="info"><strong>LIMITED2026</strong> - Unknown project, metadata+people only</div>
<input type="text" id="code" placeholder="Enter code" />
<button onclick="join()">Start Chat</button>
<p class="error" id="msg"></p>
</div>
<div id="chat-view" class="hidden">
<div class="info" id="user-info"></div>
<div id="messages"></div>
<input type="text" id="query" placeholder="Ask a question..." onkeypress="if(event.key==='Enter')ask()" />
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
      if(d.valid){
        token=d.token;userId=d.user;
        document.getElementById('login-view').classList.add('hidden');
        document.getElementById('chat-view').classList.remove('hidden');
        var p=policies[d.user]||{allowedProjects:['none'],allowedLayers:['none']};
        document.getElementById('user-info').innerHTML='<strong>'+d.name+'</strong><br/>Projects: '+p.allowedProjects.join(', ')+'<br/>Layers: '+p.allowedLayers.join(', ');
      }else document.getElementById('msg').textContent=' Invalid code';
    });
}
var policies={USER001:{allowedProjects:['personal','fireflies','manual','career','dotdata','non-work','default','unknown'],allowedLayers:['memory','people','meeting','metadata','transcript']},USER002:{allowedProjects:['unknown','default'],allowedLayers:['metadata','people']}};
function logout(){location.reload();}
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
      var html='<div class="message bot"><div class="bubble">'+(d.response||d.message||JSON.stringify(d))+'</div>';
      if(d.toolCalls)html+='<div class="tool-call">Tool calls: '+JSON.stringify(d.toolCalls)+'</div>';
      html+='</div>';
      ms.innerHTML+=html;
      ms.scrollTop=ms.scrollHeight;
    });
}
</script>
</body>
</html>`;

app.get("/", (req, res) => res.send(HTML));

app.post("/api/login", express.json(), (req, res) => {
  const { code } = req.body;
  if (code === "FULL2026") {
    const token = "session_" + Math.random().toString(36).slice(2);
    sessions.set(token, "USER001");
    res.json({ valid: true, token, user: "USER001", name: "Full Access User" });
  } else if (code === "LIMITED2026") {
    const token = "session_" + Math.random().toString(36).slice(2);
    sessions.set(token, "USER002");
    res.json({ valid: true, token, user: "USER002", name: "Limited User" });
  } else {
    res.json({ valid: false });
  }
});

app.post("/api/query", express.json(), async (req, res) => {
  const { query, token } = req.body;
  const userId = sessions.get(token);
  
  if (!userId) {
    res.json({ error: "Not authenticated" });
    return;
  }
  
  const policy = policies.get(userId);
  console.log(`\n[Query] User: ${userId}, Policy:`, policy);
  
  // Build context with access policy
  const context = `User has access to:
- Projects: ${policy?.allowedProjects.join(", ") || "none"}
- Layers: ${policy?.allowedLayers.join(", ") || "none"}

Only search within these allowed resources.`;

  try {
    const response = await agent.stream([{ role: "user", content: `${context}\n\nQuestion: ${query}` }]);
    
    let fullResponse = "";
    for await (const chunk of response.text) {
      fullResponse += chunk;
    }
    
    res.json({ response: fullResponse });
  } catch (e) {
    res.json({ error: "Agent error: " + String(e) });
  }
});

app.listen(PORT, () => console.log(`\nOculory Mastra Agent - http://localhost:${PORT}\nFULL2026 / LIMITED2026\n`));
