import "dotenv/config";

const ARMORIQ_API_KEY = process.env.ARMORIQ_API_KEY || "";
const ARMORIQ_API_URL = process.env.ARMORIQ_API_URL || "https://api.armoriq.ai";

export interface ArmorIQRequest {
  intent: string;
  action: string;
  resource?: string;
  user_id?: string;
  metadata?: Record<string, unknown>;
}

export interface ArmorIQResponse {
  allowed: boolean;
  reason?: string;
  policies_checked: string[];
}

export interface AccessPolicy {
  can_read: boolean;
  can_search: boolean;
  rate_limit: number;
  allowed_projects: string[];
}

// Mock implementation for demo (replace with real ArmorIQ SDK when available)
// Always use mock mode for now - real API needs proper setup
class ArmorIQClient {
  private apiKey: string;
  private policies: Map<string, AccessPolicy> = new Map();

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  // Set access policy for a user
  setPolicy(userId: string, policy: AccessPolicy): void {
    this.policies.set(userId, policy);
  }

  // Check if action is allowed
  async checkAccess(request: ArmorIQRequest): Promise<ArmorIQResponse> {
    // Always use mock mode for demo (real ArmorIQ needs proper integration)
    console.log("[ArmorIQ] Mock mode - allowing request");
    return {
      allowed: true,
      policies_checked: ["mock_policy"],
    };
  }

  // Capture intent before action
  async captureIntent(intent: string, userId: string): Promise<boolean> {
    const result = await this.checkAccess({
      intent,
      action: "query",
      user_id: userId,
    });

    return result.allowed;
  }

  // Check rate limit
  async checkRateLimit(userId: string): Promise<boolean> {
    const policy = this.policies.get(userId);
    if (!policy) return true;

    // Simple rate limit check (in production, use proper tracking)
    const now = Date.now();
    const key = `rate_${userId}`;
    const lastRequest = parseInt(process.env[key] || "0");
    
    if (now - lastRequest < 1000 / policy.rate_limit) {
      return false;
    }
    
    return true;
  }
}

// Security wrapper for knowledge base queries
export class KnowledgeBaseSecurity {
  private armoriq: ArmorIQClient;
  private userPolicies: Map<string, AccessPolicy> = new Map();

  constructor() {
    this.armoriq = new ArmorIQClient(ARMORIQ_API_KEY);
  }

  // Initialize user policy (called when user is invited)
  setUserPolicy(userId: string, policy: AccessPolicy): void {
    this.userPolicies.set(userId, policy);
    this.armoriq.setPolicy(userId, policy);
  }

  // Check if user can search
  async canSearch(userId: string, query: string): Promise<ArmorIQResponse> {
    const policy = this.userPolicies.get(userId);

    if (!policy) {
      return { allowed: false, reason: "No policy found for user", policies_checked: [] };
    }

    if (!policy.can_search) {
      return { allowed: false, reason: "User not authorized to search", policies_checked: [] };
    }

    // Check rate limit
    const rateOk = await this.armoriq.checkRateLimit(userId);
    if (!rateOk) {
      return { allowed: false, reason: "Rate limit exceeded", policies_checked: ["rate_limit"] };
    }

    // Capture intent
    return await this.armoriq.checkAccess({
      intent: `search:${query.slice(0, 50)}`,
      action: "search",
      user_id: userId,
    });
  }

  // Check if user can read a document
  async canRead(userId: string, project: string): Promise<ArmorIQResponse> {
    const policy = this.userPolicies.get(userId);

    if (!policy) {
      return { allowed: false, reason: "No policy found for user", policies_checked: [] };
    }

    if (!policy.can_read) {
      return { allowed: false, reason: "User not authorized to read", policies_checked: [] };
    }

    if (!policy.allowed_projects.includes(project)) {
      return { allowed: false, reason: `Project ${project} not authorized`, policies_checked: [] };
    }

    return await this.armoriq.checkAccess({
      intent: `read:${project}`,
      action: "read",
      resource: project,
      user_id: userId,
    });
  }

  // Verify invite code
  verifyInviteCode(code: string, validCodes: string[]): boolean {
    return validCodes.includes(code);
  }
}

// Example usage
async function main() {
  const security = new KnowledgeBaseSecurity();

  // Set policy for a user
  security.setUserPolicy("user_123", {
    can_read: true,
    can_search: true,
    rate_limit: 10, // 10 requests per second
    allowed_projects: ["default", "personal"],
  });

  // Test search access
  const searchResult = await security.canSearch("user_123", "What about the meeting?");
  console.log("Search allowed:", searchResult);

  // Test read access
  const readResult = await security.canRead("user_123", "default");
  console.log("Read allowed:", readResult);

  // Test unauthorized project
  const deniedResult = await security.canRead("user_123", "secret");
  console.log("Secret denied:", deniedResult);
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}
