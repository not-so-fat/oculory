import "dotenv/config";
import express from "express";
import { Vapi } from "@vapi-ai/server-sdk";
import fs from "fs";
import path from "path";
import os from "os";
import matter from "gray-matter";

const VAPI_API_KEY = process.env.VAPI_API_KEY || "";
const MINIMAX_API_KEY = process.env.MINIMAX_API_KEY || "";

// Lexicon config
const LEXICON_PATH = path.join(os.homedir(), "workspace/playground/lexicon_for_oculory");

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

// Load knowledge base
function loadDocuments(): Doc[] {
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

// Generate LLM response (simple rule-based fallback if no MiniMax)
function generateResponse(query: string, results: Doc[]): string {
  if (results.length === 0) {
    return "I don't have information about that in the knowledge base.";
  }

  const context = results
    .map((r) => `${r.title}: ${r.content.slice(0, 200)}...`)
    .join("\n\n");

  // Simple response generation (can be replaced with MiniMax)
  return `Based on the knowledge base:\n\n${context}\n\nWould you like me to elaborate on any of these?`;
}

// Initialize VAPI
const vapi = new Vapi(VAPI_API_KEY);

const app = express();
app.use(express.json());

// Load documents at startup
const docs = loadDocuments();
console.log(`Loaded ${docs.length} documents from Lexicon`);

// Health check
app.get("/", (req, res) => {
  res.json({ status: "ok", documents: docs.length });
});

// VAPI webhook - handle incoming voice call
app.post("/vapi/webhook", async (req, res) => {
  const { type, message } = req.body;

  console.log("VAPI webhook:", type);

  switch (type) {
    case "conversation-start":
      console.log("Conversation started");
      break;

    case "conversation-end":
      console.log("Conversation ended");
      break;

    case "transcript":
      // User spoke - process their message
      if (message?.type === "user" && message?.content) {
        const userQuery = message.content;
        console.log("User query:", userQuery);

        // Search knowledge base
        const results = searchDocs(docs, userQuery);
        
        // Generate response
        const response = generateResponse(userQuery, results);
        
        console.log("Response:", response);

        // Send response back to VAPI
        // Note: In production, you'd use vapi.send() here
      }
      break;

    default:
      console.log("Unknown event type:", type);
  }

  res.json({ success: true });
});

// Start server
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`
=== Oculory Voice Agent ===
Server running on http://localhost:${PORT}
VAPI webhook endpoint: http://localhost:${PORT}/vapi/webhook

To use with VAPI:
1. Go to VAPI dashboard
2. Set webhook URL to above endpoint
3. Create an outbound call or configure inbound
  `);
});
