import fs from "fs";
import path from "path";
import os from "os";
import matter from "gray-matter";

const LEXICON_PATH = path.join(os.homedir(), "workspace/playground/lexicon_for_oculory");
const OUTPUT_FILE = path.join(os.homedir(), "oculory-knowledge-base.json");

interface Doc {
  layer: string;
  project: string;
  title: string;
  content: string;
}

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
  const layers = ["Memory", "People", "Meetings", "Metadata", "Transcripts"];
  const docs: Doc[] = [];

  console.log("Loading from:", LEXICON_PATH);

  for (const layer of layers) {
    const layerPath = path.join(LEXICON_PATH, layer);
    if (!fs.existsSync(layerPath)) {
      console.log("Missing:", layerPath);
      continue;
    }

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
                title: (data?.title as string) || entry.name.replace(".md", ""),
                content: body,
              });
            }
          } catch (e) {
            // Skip bad files - some markdown has parsing issues
          }
        }
      }
    };
    walk(layerPath);
  }

  return docs;
}

async function main() {
  console.log("Exporting Lexicon to JSON...\n");

  const docs = loadDocuments();
  console.log(`\nFound ${docs.length} documents`);

  // Write to JSON
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(docs, null, 2));
  console.log(`\nExported to: ${OUTPUT_FILE}`);
  console.log(`File size: ${(fs.statSync(OUTPUT_FILE).size / 1024).toFixed(1)} KB`);

  console.log("\nTo use:");
  console.log("1. Go to https://gist.github.com");
  console.log("2. Create a new SECRET gist");
  console.log("3. Paste the contents of this file");
  console.log("4. Get the raw URL and add to Vercel as GIST_URL");
}

main();
