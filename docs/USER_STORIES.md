# Oculory User Stories

## Overview

This document outlines the user stories for Oculory's friend access control system. The system allows an owner to share their Lexicon knowledge base with friends in a secure, controlled manner.

## Terminology

- **Owner**: The primary user who owns the knowledge base and manages friend access
- **Friend**: A user who has been invited by the owner to access specific portions of the knowledge base
- **Project**: A separate knowledge base (e.g., "personal", "work", "shared")
- **Layer**: A category within a project (e.g., "memory", "people", "meeting", "metadata", "transcript")

---

## Owner User Stories

### US1: Invite Friends with Unique Code

**As an** owner,
**I want** to invite friends with a unique code,
**So that** they can access my knowledge base

**Acceptance Criteria:**
- [ ] Owner can generate a unique invite code
- [ ] Invite code contains 8 alphanumeric characters
- [ ] Invite code is displayed to the owner for sharing
- [ ] Invite code can be copied to clipboard

---

### US2: Set Per-Project Access

**As an** owner,
**I want** to set which projects each friend can access,
**So that** I can share only specific knowledge bases with specific friends

**Acceptance Criteria:**
- [ ] Owner can select one or more projects when creating an invite
- [ ] Available projects are displayed as checkboxes or multi-select
- [ ] Friend can only see documents from their allowed projects
- [ ] Friend cannot access projects they weren't invited to

---

### US3: Set Per-Layer Access

**As an** owner,
**I want** to set which layers each friend can access,
**So that** I can control what types of information friends can see

**Acceptance Criteria:**
- [ ] Owner can select one or more layers when creating an invite
- [ ] Available layers are displayed: memory, people, meeting, metadata, transcript
- [ ] Owner can grant full access (all layers) or limited access (specific layers)
- [ ] Friend search results only include documents from allowed layers
- [ ] Friend cannot see documents from disallowed layers even if they guess the content exists

---

### US4: Revoke Friend Access

**As an** owner,
**I want** to revoke a friend's access instantly,
**So that** I can cut off access when needed

**Acceptance Criteria:**
- [ ] Owner can see a list of all active invites
- [ ] Owner can click "Revoke" on any friend's access
- [ ] Revoked friend loses access immediately
- [ ] Revoked friend sees an error when trying to use the system
- [ ] Revoked invite code cannot be reused

---

### US5: View All Friends and Access Levels

**As an** owner,
**I want** to see all my friends and their access levels,
**So that** I can understand who has access to what

**Acceptance Criteria:**
- [ ] Owner sees a list of all friends with invites
- [ ] List shows: friend name, invite code, allowed projects, allowed layers, invite status, last accessed
- [ ] List is sortable by name, date created, last accessed
- [ ] Owner can search/filter the friend list

---

### US6: Update Friend Permissions

**As an** owner,
**I want** to update a friend's permissions after inviting them,
**So that** I can adjust access as needs change

**Acceptance Criteria:**
- [ ] Owner can modify allowed projects for existing invites
- [ ] Owner can modify allowed layers for existing invites
- [ ] Changes take effect immediately
- [ ] Friend is notified of permission changes (optional)

---

### US7: Set Rate Limits

**As an** owner,
**I want** to set rate limits for each friend,
**So that** I can prevent abuse of the system

**Acceptance Criteria:**
- [ ] Owner can set queries per minute limit per friend
- [ ] Default rate limit is 10 queries per minute
- [ ] Friend receives error when rate limit is exceeded
- [ ] Rate limit is enforced per user, not globally

---

## Friend User Stories

### US8: Join Using Invite Code

**As a** friend,
**I want** to join using an invitation code,
**So that** I can access the knowledge base I've been invited to

**Acceptance Criteria:**
- [ ] Friend can enter invite code on the login page
- [ ] Valid code redirects to the chat interface
- [ ] Invalid code shows error message
- [ ] Expired code shows error message
- [ ] Revoked code shows error message

---

### US9: Search Knowledge Base

**As a** friend,
**I want** to search the knowledge base,
**So that** I can find information I'm looking for

**Acceptance Criteria:**
- [ ] Friend can type a query in the search box
- [ ] Results are returned in markdown format
- [ ] Results only include documents from allowed projects
- [ ] Results only include documents from allowed layers
- [ ] Results show source title and layer

---

### US10: View Document Details

**As a** friend,
**I want** to view full document content,
**So that** I can read the complete information

**Acceptance Criteria:**
- [ ] Friend can click on a source to see full content
- [ ] Document is displayed in a readable format
- [ ] Friend cannot access documents from disallowed projects
- [ ] Friend cannot access documents from disallowed layers

---

### US11: See My Access Level

**As a** friend,
**I want** to see what I have access to,
**So that** I know the scope of my permissions

**Acceptance Criteria:**
- [ ] Friend can see their allowed projects
- [ ] Friend can see their allowed layers
- [ ] Friend cannot request access to additional projects/layers (owner must grant)

---

## Security User Stories

### US12: Verify Every Query

**As the** system,
**I want** to verify every query against ArmorIQ before executing,
**So that** unauthorized access is prevented

**Acceptance Criteria:**
- [ ] Every search request goes through ArmorIQ verification
- [ ] Invalid requests are rejected with clear error message
- [ ] Verification happens before any search operation

---

### US13: Log Access Attempts

**As the** system,
**I want** to log all access attempts for audit,
**So that** the owner can review who accessed what

**Acceptance Criteria:**
- [ ] All login attempts are logged (success/failure)
- [ ] All search queries are logged
- [ ] Logs include: timestamp, user, action, result
- [ ] Owner can view access logs

---

### US14: Prevent Prompt Injection

**As the** system,
**I want** to prevent prompt injection attacks via ArmorIQ plan verification,
**So that** malicious prompts cannot execute unplanned actions

**Acceptance Criteria:**
- [ ] Search intent is captured as a plan upfront
- [ ] Plan is verified cryptographically by ArmorIQ
- [ ] Queries that deviate from the captured plan are rejected
- [ ] Common injection patterns are blocked

---

## Technical Implementation Notes

### Access Control Matrix

| Layer | Default Owner Access | Default Friend Access |
|-------|---------------------|----------------------|
| memory | Full | None (most sensitive) |
| people | Full | Configurable |
| meeting | Full | Configurable |
| metadata | Full | Configurable |
| transcript | Full | Configurable |

### Invite Code Flow

1. Owner creates invite → generates unique code + permissions
2. Code stored in Convex with permissions
3. Friend enters code → system verifies against Convex
4. System creates session with permissions
5. Every query filters by session permissions

### ArmorIQ Integration Points

1. **Intent Capture** - When friend submits search, capture intent
2. **Plan Verification** - Verify search matches captured intent
3. **Rate Limiting** - Enforce per-user rate limits
4. **Audit Logging** - Log all access decisions
