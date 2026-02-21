import "dotenv/config";
import fs from "fs";
import path from "path";
import os from "os";
import matter from "gray-matter";

const MINIMAX_API_KEY = process.env.MINIMAX_API_KEY || "";
const MINIMAX_BASE_URL = "https://api.minimax.chat/v1";
const MINIMAX_MODEL = "MiniMax-Text-01";
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

function loadDocuments(): Doc[] {
  const basePath = path.join(os.homedir(), "workspace/playground/lexicon_for_oculory");
  const layers = ["Memory", "People", "Meetings", "Metadata", "Transcripts"];
  const docs: Doc[] = [];

  console.log("Loading from:", basePath);

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

function detectQuestionType(query: string): string {
  const q = query.toLowerCase();
  if (q.includes("tell me about") || q.includes("who is")) return "about_person";
  if (q.includes("happened") || q.includes("meeting")) return "what_happened";
  if (q.includes("prepare")) return "prepare_meeting";
  if (q.includes("decision")) return "decisions";
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
        { role: "system", content: "You are a helpful assistant. Answer based only on the provided context." },
        { role: "user", content: prompt + "\n\nContext:\n" + context },
      ],
      temperature: 0.7,
    }),
  });

  const data = await response.json();
  if (!data.choices || !data.choices[0]) {
    console.error("MiniMax response:", data);
    return "Error: No response from MiniMax";
  }
  return data.choices[0].message.content;
}

async function main() {
  console.log("=== Oculory Voice Agent - Full Test ===\n");

  const docs = loadDocuments();
  console.log(`Loaded ${docs.length} documents\n`);

  // Show layer distribution
  const layers = {} as Record<string, number>;
  for (const d of docs) {
    layers[d.layer] = (layers[d.layer] || 0) + 1;
  }
  console.log("Layer distribution:", layers);
  console.log("(Priority: memory=1, people=2, meeting=3, metadata=4, transcript=5)\n");

  // Test query
  const query = "What did we discuss about AI?";
  const questionType = detectQuestionType(query);
  const results = searchDocs(docs, query);

  console.log(`\n--- Query: "${query}" ---`);
  console.log(`Question type: ${questionType}`);
  console.log(`Results: ${results.length}`);

  for (const r of results) {
    console.log(`\n[${r.layer}] ${r.title}`);
    console.log(`  ${r.content.slice(0, 150)}...`);
  }

  if (results.length > 0) {
    console.log("\n--- Calling MiniMax ---\n");
    const context = results
      .map((r) => `[${r.title}] (${r.layer}): ${r.content.slice(0, 500)}...`)
      .join("\n\n");

    const response = await chat(query, context);
    console.log("MiniMax Response:", response);
  }

  console.log("\n=== Test Complete ===");
}

main().catch(console.error);
