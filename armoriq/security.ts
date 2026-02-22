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
  intent_token?: string;
}

export interface AccessPolicy {
  can_read: boolean;
  can_search: boolean;
  rate_limit: number;
  allowed_projects: string[];
  allowed_layers: string[];
}

export interface SearchPlan {
  goal: string;
  steps: {
    action: string;
    mcp: string;
    params: Record<string, unknown>;
  }[];
}

// ArmorIQ Client using intent-based execution
class ArmorIQClient {
  private apiKey: string;
  private policies: Map<string, AccessPolicy> = new Map();
  private mockMode: boolean;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
    // Use mock mode if no API key is provided
    this.mockMode = !apiKey;
  }

  // Set access policy for a user
  setPolicy(userId: string, policy: AccessPolicy): void {
    this.policies.set(userId, policy);
  }

  // Capture intent before action (ArmorIQ core feature)
  async captureIntent(
    userId: string,
    intent: string,
    plan: SearchPlan
  ): Promise<ArmorIQResponse> {
    if (this.mockMode) {
      console.log("[ArmorIQ] Mock mode - capturing intent:", intent);
      return {
        allowed: true,
        policies_checked: ["mock_policy"],
        intent_token: `mock_token_${Date.now()}`,
      };
    }

    try {
      const response = await fetch(`${ARMORIQ_API_URL}/v1/intent/capture`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          user_id: userId,
          intent,
          plan,
          timestamp: Date.now(),
        }),
      });

      const data = await response.json();
      
      if (!response.ok) {
        return {
          allowed: false,
          reason: data.error || "Intent capture failed",
          policies_checked: [],
        };
      }

      return {
        allowed: true,
        policies_checked: data.policies_checked || [],
        intent_token: data.intent_token,
      };
    } catch (e) {
      console.error("[ArmorIQ] Intent capture error:", e);
      // Fail closed - deny on error
      return {
        allowed: false,
        reason: "ArmorIQ service unavailable",
        policies_checked: [],
      };
    }
  }

  // Verify intent token against requested action
  async verifyIntent(
    intentToken: string,
    action: string,
    params?: Record<string, unknown>
  ): Promise<ArmorIQResponse> {
    if (this.mockMode) {
      console.log("[ArmorIQ] Mock mode - verifying intent:", action);
      return {
        allowed: true,
        policies_checked: ["mock_policy"],
      };
    }

    try {
      const response = await fetch(`${ARMORIQ_API_URL}/v1/intent/verify`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          intent_token: intentToken,
          action,
          params,
          timestamp: Date.now(),
        }),
      });

      const data = await response.json();
      
      if (!response.ok) {
        return {
          allowed: false,
          reason: data.error || "Intent verification failed",
          policies_checked: [],
        };
      }

      return {
        allowed: data.allowed,
        reason: data.reason,
        policies_checked: data.policies_checked || [],
      };
    } catch (e) {
      console.error("[ArmorIQ] Intent verification error:", e);
      // Fail closed
      return {
        allowed: false,
        reason: "ArmorIQ service unavailable",
        policies_checked: [],
      };
    }
  }

  // Check if action is allowed (legacy method)
  async checkAccess(request: ArmorIQRequest): Promise<ArmorIQResponse> {
    if (this.mockMode) {
      console.log("[ArmorIQ] Mock mode - allowing request:", request.action);
      return {
        allowed: true,
        policies_checked: ["mock_policy"],
      };
    }

    try {
      const response = await fetch(`${ARMORIQ_API_URL}/v1/access/check`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(request),
      });

      const data = await response.json();
      
      return {
        allowed: data.allowed ?? false,
        reason: data.reason,
        policies_checked: data.policies_checked || [],
      };
    } catch (e) {
      console.error("[ArmorIQ] Access check error:", e);
      return {
        allowed: false,
        reason: "ArmorIQ service unavailable",
        policies_checked: [],
      };
    }
  }

  // Check rate limit for user
  async checkRateLimit(userId: string): Promise<boolean> {
    const policy = this.policies.get(userId);
    if (!policy) return true;

    const now = Date.now();
    const key = `rate_${userId}`;
    const lastRequest = parseInt(process.env[key] || "0");
    
    if (now - lastRequest < 1000 / policy.rate_limit) {
      return false;
    }
    
    return true;
  }
}

// Security wrapper for knowledge base queries with access control
export class KnowledgeBaseSecurity {
  private armoriq: ArmorIQClient;
  private userPolicies: Map<string, AccessPolicy> = new Map();
  private userPermissions: Map<string, {
    allowedProjects: string[];
    allowedLayers: string[];
  }> = new Map();

  constructor() {
    this.armoriq = new ArmorIQClient(ARMORIQ_API_KEY);
  }

  // Initialize user policy (called when user is invited)
  setUserPolicy(userId: string, policy: AccessPolicy): void {
    this.userPolicies.set(userId, policy);
    this.armoriq.setPolicy(userId, policy);
  }

  // Set user's allowed projects and layers from Convex
  setUserPermissions(
    userId: string,
    permissions: {
      allowedProjects: string[];
      allowedLayers: string[];
    }
  ): void {
    this.userPermissions.set(userId, permissions);
  }

  // Capture search intent before executing search
  async captureSearchIntent(
    userId: string,
    query: string
  ): Promise<ArmorIQResponse> {
    const permissions = this.userPermissions.get(userId);

    const plan: SearchPlan = {
      goal: `Search knowledge base for: ${query.slice(0, 100)}`,
      steps: [
        {
          action: "search",
          mcp: "knowledge-base",
          params: {
            query,
            allowedProjects: permissions?.allowedProjects || [],
            allowedLayers: permissions?.allowedLayers || [],
          },
        },
      ],
    };

    return await this.armoriq.captureIntent(userId, `search:${query.slice(0, 50)}`, plan);
  }

  // Verify search intent after getting results
  async verifySearchIntent(
    intentToken: string,
    query: string,
    results: unknown[]
  ): Promise<ArmorIQResponse> {
    return await this.armoriq.verifyIntent(intentToken, "search", {
      query,
      resultCount: results.length,
    });
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

    // Capture intent for the search
    return await this.captureSearchIntent(userId, query);
  }

  // Check if user can read a document
  async canRead(userId: string, project: string, layer: string): Promise<ArmorIQResponse> {
    const policy = this.userPolicies.get(userId);
    const permissions = this.userPermissions.get(userId);

    if (!policy) {
      return { allowed: false, reason: "No policy found for user", policies_checked: [] };
    }

    if (!policy.can_read) {
      return { allowed: false, reason: "User not authorized to read", policies_checked: [] };
    }

    // Check project access
    if (!policy.allowed_projects.includes(project)) {
      return { allowed: false, reason: `Project ${project} not authorized`, policies_checked: [] };
    }

    // Check layer access
    if (permissions && !permissions.allowedLayers.includes(layer)) {
      return { allowed: false, reason: `Layer ${layer} not authorized`, policies_checked: [] };
    }

    return await this.armoriq.checkAccess({
      intent: `read:${project}/${layer}`,
      action: "read",
      resource: `${project}/${layer}`,
      user_id: userId,
    });
  }

  // Verify invite code
  verifyInviteCode(code: string, validCodes: string[]): boolean {
    return validCodes.includes(code);
  }

  // Get user's allowed filters for search
  getSearchFilters(userId: string): { allowedProjects: string[]; allowedLayers: string[] } {
    const permissions = this.userPermissions.get(userId);
    return permissions || { allowedProjects: [], allowedLayers: [] };
  }
}

// Example usage
async function main() {
  const security = new KnowledgeBaseSecurity();

  // Set policy for a user
  security.setUserPolicy("user_123", {
    can_read: true,
    can_search: true,
    rate_limit: 10,
    allowed_projects: ["default", "personal"],
    allowed_layers: ["people", "meeting"],
  });

  // Set permissions from Convex
  security.setUserPermissions("user_123", {
    allowedProjects: ["default", "personal"],
    allowedLayers: ["people", "meeting"],
  });

  // Test search access with intent capture
  const searchResult = await security.canSearch("user_123", "What about the meeting?");
  console.log("Search allowed:", searchResult);

  // Test read access
  const readResult = await security.canRead("user_123", "default", "people");
  console.log("Read allowed:", readResult);

  // Test unauthorized project
  const deniedResult = await security.canRead("user_123", "secret", "memory");
  console.log("Secret denied:", deniedResult);

  // Test unauthorized layer
  const layerDenied = await security.canRead("user_123", "default", "memory");
  console.log("Memory layer denied:", layerDenied);
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}
