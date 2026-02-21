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
    .slice(0, 3)
    .map((s) => s.doc);
}

// Generate response (simple fallback)
function generateResponse(results: Doc[]): string {
  if (results.length === 0) {
    return "I don't have information about that in the knowledge base.";
  }

  const context = results
    .map((r) => `${r.title} (${r.layer}): ${r.content.slice(0, 150)}...`)
    .join("\n\n");

  return `Based on the knowledge base:\n\n${context}`;
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

// Health check (works even before init)
app.get("/", (req, res) => {
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

  console.log("[ArmorIQ] Access granted");

  // Step 2: Search knowledge base
  const results = searchDocs(docs, query);

  // Step 3: Generate response
  const response = generateResponse(results);

  res.json({
    success: true,
    query,
    response,
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
      console.log("[VAPI] Call started");
      break;

    case "conversation-end":
      console.log("[VAPI] Call ended");
      break;

    case "transcript":
      if (message?.type === "user" && message?.content) {
        const query = message.content;
        console.log("[VAPI] User said:", query);

        // Process query through security
        const results = searchDocs(docs, query);
        const response = generateResponse(results);

        // In production, stream this back via VAPI
        console.log("[VAPI] Response:", response);
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
