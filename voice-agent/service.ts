import "dotenv/config";
import { ConvexHttpClient } from "convex/httpclient";

// Configuration
const CONVEX_URL = process.env.CONVEX_URL || "http://localhost:3000";
const MINIMAX_API_KEY = process.env.MINIMAX_API_KEY || "";
const VAPI_API_KEY = process.env.VAPI_API_KEY || "";

// MiniMax configuration
const MINIMAX_BASE_URL = "https://api.minimax.chat/v1";
const MINIMAX_MODEL = "MiniMax-Text-01";

// System prompt based on Lexicon search rules
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
- "What decisions have we made?" → Check Memory/*/Decisions/decisions.md

## Response Rules

- Always cite sources (file path and layer)
- If information is insufficient, say "I don't have enough context about that"
- Never fabricate - only use provided context
- Start from most distilled layer, drill down only if needed
- Be conversational and helpful`;

interface SearchResult {
  _id: string;
  layer: string;
  project: string;
  title: string;
  content: string;
  filePath: string;
}

class MiniMaxClient {
  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async chat(messages: Array<{ role: string; content: string }>): Promise<string> {
    const response = await fetch(`${MINIMAX_BASE_URL}/text/chatcompletion_v2`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: MINIMAX_MODEL,
        messages,
        temperature: 0.7,
      }),
    });

    if (!response.ok) {
      throw new Error(`MiniMax API error: ${response.statusText}`);
    }

    const data = await response.json();
    return data.choices[0].message.content;
  }
}

class KnowledgeBase {
  private convex: ConvexHttpClient;

  constructor() {
    this.convex = new ConvexHttpClient(CONVEX_URL);
  }

  async search(query: string, project: string = "default"): Promise<SearchResult[]> {
    try {
      // Determine question type for smart routing
      const questionType = this.detectQuestionType(query);

      const results = await this.convex.query("knowledge:searchAllLayers", {
        project,
        query,
        questionType,
        limit: 5,
      });

      return results;
    } catch (error) {
      console.error("Search error:", error);
      return [];
    }
  }

  private detectQuestionType(query: string): "what_know" | "about_person" | "what_happened" | "prepare_meeting" | "decisions" | "general" {
    const q = query.toLowerCase();

    if (q.includes("tell me about") || q.includes("who is") || q.includes("what do we know about")) {
      return "what_know";
    }
    if (q.includes("person") || q.includes("meet with") || q.includes("talk to")) {
      return "about_person";
    }
    if (q.includes("happened") || q.includes("meeting") || q.includes("when")) {
      return "what_happened";
    }
    if (q.includes("prepare") || q.includes("upcoming")) {
      return "prepare_meeting";
    }
    if (q.includes("decision") || q.includes("agreed")) {
      return "decisions";
    }
    return "general";
  }
}

class VoiceAgent {
  private minimax: MiniMaxClient;
  private knowledge: KnowledgeBase;
  private conversationHistory: Array<{ role: string; content: string }> = [];

  constructor() {
    this.minimax = new MiniMaxClient(MINIMAX_API_KEY);
    this.knowledge = new KnowledgeBase();

    // Initialize with system prompt
    this.conversationHistory.push({
      role: "system",
      content: SYSTEM_PROMPT,
    });
  }

  async processMessage(userMessage: string): Promise<string> {
    // Add user message to history
    this.conversationHistory.push({ role: "user", content: userMessage });

    // Search knowledge base for relevant context
    const searchResults = await this.knowledge.search(userMessage);

    // Build context from search results
    let contextSection = "";
    if (searchResults.length > 0) {
      contextSection = "\n\n## Relevant Knowledge:\n";
      for (const result of searchResults) {
        contextSection += `\n### [${result.title}] (${result.layer}/${result.project})\n${result.content.slice(0, 500)}...\n`;
      }
    }

    // Add context to last user message
    const lastUserMsg = this.conversationHistory[this.conversationHistory.length - 1];
    lastUserMsg.content += contextSection;

    // Get response from MiniMax
    try {
      const response = await this.minimax.chat(this.conversationHistory);

      // Add assistant response to history
      this.conversationHistory.push({ role: "assistant", content: response });

      return response;
    } catch (error) {
      console.error("MiniMax error:", error);
      return "I apologize, but I encountered an error processing your request. Please try again.";
    }
  }

  resetConversation(): void {
    this.conversationHistory = [
      {
        role: "system",
        content: SYSTEM_PROMPT,
      },
    ];
  }
}

// Export for use with VAPI
export { VoiceAgent, KnowledgeBase, MiniMaxClient };

// CLI for testing
async function main() {
  if (!MINIMAX_API_KEY) {
    console.error("MINIMAX_API_KEY not set");
    process.exit(1);
  }

  const agent = new VoiceAgent();

  console.log("VoiceAgent ready! (Type 'quit' to exit)");
  console.log("Try asking: 'What do we know about [topic]?' or 'Tell me about [person]'\n");

  // Simple CLI loop
  const readline = await import("readline");
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const ask = () => {
    rl.question("You: ", async (input) => {
      if (input.toLowerCase() === "quit") {
        rl.close();
        return;
      }

      const response = await agent.processMessage(input);
      console.log(`\nAgent: ${response}\n`);
      ask();
    });
  };

  ask();
}

main().catch(console.error);
