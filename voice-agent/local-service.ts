import "dotenv/config";
import fs from "fs";
import path from "path";
import os from "os";
import matter from "gray-matter";

// Configuration
const LEXICON_PATH = process.env.LEXICON_PATH || "~/workspace/codes/lexicon";
const MINIMAX_API_KEY = process.env.MINIMAX_API_KEY || "";

const MINIMAX_BASE_URL = "https://api.minimax.chat/v1";
const MINIMAX_MODEL = "MiniMax-Text-01";

const SYSTEM_PROMPT = `You are a helpful assistant answering questions about your friend's knowledge base.

## Search Priority (follow this exactly)
1. **Memory/** - Most distilled knowledge (search FIRST)
2. **People/** - Per-person observations (search FIRST if question is about a person)
3. **Meetings/** - Structured meeting notes (search SECOND)
4. **Metadata/** - Registries and config (reference only)
5. **Transcripts/** - Raw transcripts (LAST RESORT only if user explicitly asks)

## Question Types
- "What do we know about X?" → Check Memory/ first
- "Tell me about [person]" → Read People/<Name>.md first
- "What happened on [date]?" → List Meetings/ by date
- "Prepare me for meeting with X about Y" → Combine People + Memory + Recent Meetings

## Response Rules
- Always cite sources (file path and layer)
- If information is insufficient, say "I don't have enough context about that"
- Never fabricate - only use provided context`;

interface Doc {
  layer: string;
  project: string;
  filePath: string;
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

function getProjectFromPath(filePath: string): string {
  const parts = filePath.split("/");
  const idx = ["Memory", "People", "Meetings", "Metadata", "Transcripts"]
    .map((name) => parts.indexOf(name))
    .filter((i) => i !== -1)
    .sort((a, b) => b - a)[0];
  return idx !== undefined && parts[idx + 1] ? parts[idx + 1] : "default";
}

async function loadDocuments(): Promise<Doc[]> {
  const basePath = path.join(os.homedir(), "workspace/codes/lexicon");
  const layers = ["Memory", "People", "Meetings", "Metadata", "Transcripts"];
  const docs: Doc[] = [];

  for (const layer of layers) {
    const layerPath = path.join(basePath, layer);
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
                project: getProjectFromPath(fullPath),
                filePath: fullPath,
                title: (data.title as string) || entry.name.replace(".md", ""),
                content: body,
              });
            }
          } catch (e) {
            // Skip bad files
          }
        }
      }
    };
    walk(layerPath);
  }

  return docs;
}

function searchDocs(docs: Doc[], query: string, questionType: string): Doc[] {
  const q = query.toLowerCase();

  // Determine which layers to search
  let layers: string[];
  switch (questionType) {
    case "about_person":
      layers = ["people", "meeting", "memory"];
      break;
    case "what_happened":
      layers = ["meeting", "memory"];
      break;
    case "prepare_meeting":
      layers = ["people", "memory", "meeting"];
      break;
    case "decisions":
      layers = ["memory", "meeting"];
      break;
    case "what_know":
      layers = ["memory", "meeting", "people"];
      break;
    default:
      layers = ["memory", "people", "meeting", "metadata", "transcript"];
  }

  // Score and filter
  const scored = docs
    .filter((d) => layers.includes(d.layer))
    .map((d) => {
      let score = 0;
      const content = d.content.toLowerCase();
      const title = d.title.toLowerCase();
      const qLower = q;

      // Title match
      if (title.includes(qLower.split(" ")[0])) score += 10;
      // Content match
      if (content.includes(qLower)) score += 5;
      // Layer priority
      score -= LAYER_PRIORITY[d.layer] || 0;

      return { doc: d, score };
    })
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .map((s) => s.doc);

  return scored;
}

function detectQuestionType(query: string): string {
  const q = query.toLowerCase();
  if (q.includes("tell me about") || q.includes("who is") || q.includes("what do we know about")) return "what_know";
  if (q.includes("person") || q.includes("meet with") || q.includes("talk to")) return "about_person";
  if (q.includes("happened") || q.includes("meeting") || q.includes("when")) return "what_happened";
  if (q.includes("prepare") || q.includes("upcoming")) return "prepare_meeting";
  if (q.includes("decision") || q.includes("agreed")) return "decisions";
  return "general";
}

async function chat(prompt: string, context: string): Promise<string> {
  const response = await fetch(`${MINIMAX_BASE_URL}/text/chatcompletion_v2`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${MINIMAX_API_KEY}`,
    },
    body: JSON.stringify({
      model: MINIMAX_MODEL,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: prompt + "\n\n## Context:\n" + context },
      ],
      temperature: 0.7,
    }),
  });

  if (!response.ok) {
    throw new Error(`MiniMax error: ${response.statusText}`);
  }

  const data = await response.json();
  return data.choices[0].message.content;
}

async function main() {
  if (!MINIMAX_API_KEY) {
    console.error("MINIMAX_API_KEY not set in .env");
    process.exit(1);
  }

  console.log("Loading Lexicon documents...");
  const docs = await loadDocuments();
  console.log(`Loaded ${docs.length} documents`);

  if (docs.length === 0) {
    console.log("No documents found. Add some meetings/people/memory first!");
  }

  console.log("\nReady! Ask questions about your knowledge base.");
  console.log("Example: 'What do we know about [topic]?' or 'Tell me about [person]'\n");

  const readline = await import("readline");
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  const ask = () => {
    rl.question("You: ", async (input) => {
      if (input.toLowerCase() === "quit") {
        rl.close();
        return;
      }

      const questionType = detectQuestionType(input);
      const results = searchDocs(docs, input, questionType);

      let context = "";
      if (results.length > 0) {
        context = results
          .map((r) => `### [${r.title}] (${r.layer}/${r.project})\n${r.content.slice(0, 600)}...\n`)
          .join("\n");
      } else {
        context = "No relevant documents found in the knowledge base.";
      }

      console.log("\nSearching...");
      const response = await chat(input, context);
      console.log(`\nAgent: ${response}\n`);

      ask();
    });
  };

  ask();
}

main().catch(console.error);
