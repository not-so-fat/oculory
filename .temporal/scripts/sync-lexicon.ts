import fs from "fs";
import path from "path";
import matter from "gray-matter";
import { glob } from "glob";
import { ConvexHttpClient } from "convex/httpclient";

const LEXICON_PATH = process.env.LEXICON_PATH || "~/workspace/codes/lexicon";
const CONVEX_URL = process.env.CONVEX_URL || "http://localhost:3000";

interface KnowledgeFile {
  layer: "memory" | "people" | "meeting" | "metadata" | "transcript";
  project: string;
  filePath: string;
  title: string;
  content: string;
  frontmatter: Record<string, unknown>;
}

function getLayerFromPath(filePath: string): KnowledgeFile["layer"] {
  const normalized = filePath.toLowerCase();
  if (normalized.includes("/memory/")) return "memory";
  if (normalized.includes("/people/")) return "people";
  if (normalized.includes("/meetings/")) return "meeting";
  if (normalized.includes("/metadata/")) return "metadata";
  if (normalized.includes("/transcripts/")) return "transcript";
  return "metadata";
}

function getProjectFromPath(filePath: string): string {
  const parts = filePath.split("/");
  const memoryIdx = parts.indexOf("Memory");
  const peopleIdx = parts.indexOf("People");
  const meetingsIdx = parts.indexOf("Meetings");
  const metadataIdx = parts.indexOf("Metadata");
  const transcriptsIdx = parts.indexOf("Transcripts");

  const idx = [memoryIdx, peopleIdx, meetingsIdx, metadataIdx, transcriptsIdx]
    .filter(i => i !== -1)
    .sort((a, b) => b - a)[0];

  if (idx !== undefined && parts[idx + 1]) {
    return parts[idx + 1];
  }
  return "default";
}

async function findMarkdownFiles(basePath: string): Promise<string[]> {
  const patterns = [
    path.join(basePath, "Memory/**/*.md"),
    path.join(basePath, "People/**/*.md"),
    path.join(basePath, "Meetings/**/*.md"),
    path.join(basePath, "Metadata/**/*.md"),
    path.join(basePath, "Transcripts/**/*.md"),
  ];

  const files: string[] = [];
  for (const pattern of patterns) {
    const matches = await glob(pattern, { ignore: "**/.gitkeep" });
    files.push(...matches);
  }
  return files;
}

async function parseFile(filePath: string): Promise<KnowledgeFile | null> {
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    const { data, content: body } = matter(content);

    if (!body.trim()) return null;

    const layer = getLayerFromPath(filePath);
    const project = getProjectFromPath(filePath);
    const title = (data.title as string) || path.basename(filePath, ".md");

    return {
      layer,
      project,
      filePath,
      title,
      content: body,
      frontmatter: data,
    };
  } catch (error) {
    console.error(`Error parsing ${filePath}:`, error);
    return null;
  }
}

async function syncToConvex(files: KnowledgeFile[]): Promise<number> {
  const client = new ConvexHttpClient(CONVEX_URL);

  let synced = 0;
  for (const file of files) {
    try {
      await client.mutation("knowledge:syncFile", file);
      synced++;
      console.log(`Synced: ${file.filePath} (${file.layer}/${file.project})`);
    } catch (error) {
      console.error(`Error syncing ${file.filePath}:`, error);
    }
  }
  return synced;
}

async function main() {
  const basePath = path.expandUser(LEXICON_PATH);
  console.log(`Scanning Lexicon at: ${basePath}`);

  const files = await findMarkdownFiles(basePath);
  console.log(`Found ${files.length} markdown files`);

  const parsed = await Promise.all(files.map(parseFile));
  const validFiles = parsed.filter((f): f is KnowledgeFile => f !== null);
  console.log(`Valid files: ${validFiles.length}`);

  const synced = await syncToConvex(validFiles);
  console.log(`\nSynced ${synced} files to Convex`);
}

main().catch(console.error);
