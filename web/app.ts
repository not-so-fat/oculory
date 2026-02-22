import "dotenv/config";
import { ConvexHttpClient } from "convex/httpclient";
import http from "http";
import url from "url";

const CONVEX_URL = process.env.CONVEX_URL || "http://localhost:3000";
const PORT = process.env.PORT || 8080;

const convex = new ConvexHttpClient(CONVEX_URL);

const HTML = `<!DOCTYPE html>
<html>
<head>
  <title>Oculory - Knowledge Sharing</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    * { box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; background: #f5f5f5; }
    h1 { color: #333; margin-bottom: 20px; }
    h2 { color: #555; margin-top: 30px; }
    
    .card { background: white; border-radius: 12px; padding: 24px; margin-bottom: 20px; box-shadow: 0 2px 8px rgba(0,0,0,0.08); }
    .card h3 { margin-top: 0; color: #333; }
    
    .form-group { margin-bottom: 16px; }
    label { display: block; margin-bottom: 6px; font-weight: 500; color: #555; }
    input[type="text"], input[type="email"], select { width: 100%; padding: 12px; border: 1px solid #ddd; border-radius: 8px; font-size: 16px; }
    input:focus, select:focus { outline: none; border-color: #007AFF; }
    
    .checkbox-group { display: flex; flex-wrap: wrap; gap: 12px; }
    .checkbox-label { display: flex; align-items: center; gap: 6px; font-weight: normal; cursor: pointer; }
    .checkbox-label input { width: auto; }
    
    button { padding: 12px 24px; font-size: 16px; border: none; border-radius: 8px; cursor: pointer; transition: background 0.2s; }
    button.primary { background: #007AFF; color: white; }
    button.primary:hover { background: #0056b3; }
    button.danger { background: #FF3B30; color: white; }
    button.danger:hover { background: #d32f2f; }
    button.secondary { background: #E5E5EA; color: #333; }
    button.secondary:hover { background: #d1d1d6; }
    
    .error { color: #FF3B30; margin-top: 10px; }
    .success { color: #34C759; margin-top: 10px; }
    .info { color: #007AFF; margin-top: 10px; }
    
    .invite-list { list-style: none; padding: 0; }
    .invite-item { display: flex; justify-content: space-between; align-items: center; padding: 16px; border-bottom: 1px solid #eee; }
    .invite-item:last-child { border-bottom: none; }
    .invite-info { flex: 1; }
    .invite-name { font-weight: 600; color: #333; }
    .invite-meta { font-size: 14px; color: #888; margin-top: 4px; }
    .invite-code { font-family: monospace; background: #f0f0f0; padding: 4px 8px; border-radius: 4px; }
    .invite-actions { display: flex; gap: 8px; }
    
    .tab-buttons { display: flex; gap: 8px; margin-bottom: 20px; }
    .tab-btn { padding: 10px 20px; background: #E5E5EA; border: none; border-radius: 8px; cursor: pointer; }
    .tab-btn.active { background: #007AFF; color: white; }
    
    .hidden { display: none; }
    .flex { display: flex; gap: 12px; }
    .flex > * { flex: 1; }
    
    .badge { display: inline-block; padding: 4px 8px; border-radius: 4px; font-size: 12px; font-weight: 600; }
    .badge-active { background: #d4edda; color: #155724; }
    .badge-revoked { background: #f8d7da; color: #721c24; }
    .badge-expired { background: #fff3cd; color: #856404; }
  </style>
</head>
<body>
  <h1>Oculory - Knowledge Sharing</h1>
  
  <!-- Login View -->
  <div id="login-view" class="card">
    <h3>Enter Access Code</h3>
    <p>Enter your invitation code to access the knowledge base:</p>
    <div class="form-group">
      <input type="text" id="code" placeholder="Enter invite code" />
    </div>
    <button class="primary" onclick="joinChat()">Join</button>
    <p id="login-status"></p>
    
    <hr style="margin: 24px 0; border: none; border-top: 1px solid #eee;" />
    
    <h3>Owner Login</h3>
    <p>Manage your friends and their access:</p>
    <div class="form-group">
      <input type="text" id="owner-code" placeholder="Owner code (demo: OWNER2026)" />
    </div>
    <button class="secondary" onclick="ownerLogin()">Owner Login</button>
    <p id="owner-login-status"></p>
  </div>
  
  <!-- Chat View -->
  <div id="chat-view" class="card hidden">
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
      <h3>Knowledge Base Chat</h3>
      <button class="secondary" onclick="showLogin()">Logout</button>
    </div>
    <div id="session-info" style="font-size: 14px; color: #888; margin-bottom: 16px;"></div>
    <div id="chat-messages" style="height: 300px; overflow-y: auto; border: 1px solid #eee; border-radius: 8px; padding: 16px; margin-bottom: 16px;"></div>
    <div class="flex">
      <input type="text" id="chat-input" placeholder="Ask a question..." onkeypress="handleKeyPress(event)" />
      <button class="primary" onclick="sendMessage()">Send</button>
    </div>
  </div>
  
  <!-- Owner Dashboard View -->
  <div id="owner-view" class="hidden">
    <div class="card">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
        <h3>Owner Dashboard</h3>
        <button class="secondary" onclick="showLogin()">Logout</button>
      </div>
      
      <div class="tab-buttons">
        <button class="tab-btn active" onclick="showTab('friends')">Friends</button>
        <button class="tab-btn" onclick="showTab('invite')">Create Invite</button>
      </div>
      
      <!-- Friends Tab -->
      <div id="tab-friends">
        <h4>Your Friends</h4>
        <ul id="invite-list" class="invite-list">
          <li style="color: #888; text-align: center; padding: 20px;">Loading...</li>
        </ul>
      </div>
      
      <!-- Create Invite Tab -->
      <div id="tab-invite" class="hidden">
        <h4>Create New Invite</h4>
        
        <div class="form-group">
          <label>Friend's Name</label>
          <input type="text" id="invitee-name" placeholder="Enter friend's name" />
        </div>
        
        <div class="form-group">
          <label>Allowed Projects</label>
          <div class="checkbox-group">
            <label class="checkbox-label"><input type="checkbox" value="default" checked /> Default</label>
            <label class="checkbox-label"><input type="checkbox" value="personal" /> Personal</label>
            <label class="checkbox-label"><input type="checkbox" value="work" /> Work</label>
          </div>
        </div>
        
        <div class="form-group">
          <label>Allowed Layers</label>
          <div class="checkbox-group">
            <label class="checkbox-label"><input type="checkbox" value="memory" /> Memory</label>
            <label class="checkbox-label"><input type="checkbox" value="people" checked /> People</label>
            <label class="checkbox-label"><input type="checkbox" value="meeting" checked /> Meetings</label>
            <label class="checkbox-label"><input type="checkbox" value="metadata" /> Metadata</label>
            <label class="checkbox-label"><input type="checkbox" value="transcript" /> Transcripts</label>
          </div>
        </div>
        
        <div class="flex">
          <div class="form-group">
            <label>Can Search</label>
            <select id="can-search">
              <option value="true">Yes</option>
              <option value="false">No</option>
            </select>
          </div>
          <div class="form-group">
            <label>Rate Limit (per min)</label>
            <input type="number" id="rate-limit" value="10" min="1" max="100" />
          </div>
        </div>
        
        <button class="primary" onclick="createInvite()">Create Invite</button>
        <p id="create-status"></p>
      </div>
    </div>
  </div>
  
  <script>
    let sessionToken = localStorage.getItem('oculory_session');
    let isOwner = false;
    
    // Check if already logged in
    if (sessionToken) {
      checkSession();
    }
    
    async function checkSession() {
      try {
        const resp = await fetch(\`\${window.location.origin}/api/session\`, {
          headers: { 'Authorization': \`Bearer \${sessionToken}\` }
        });
        const data = await resp.json();
        
        if (data.authenticated) {
          showChat(data);
        } else {
          localStorage.removeItem('oculory_session');
          sessionToken = null;
        }
      } catch(e) {
        console.error('Session check failed:', e);
      }
    }
    
    async function joinChat() {
      const code = document.getElementById('code').value.trim();
      const status = document.getElementById('login-status');
      
      if (!code) {
        status.textContent = 'Please enter a code';
        status.className = 'error';
        return;
      }
      
      try {
        const response = await fetch(\`\${window.location.origin}/api/verify-invite\`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code })
        });
        const data = await response.json();
        
        if (data.valid) {
          sessionToken = data.sessionToken;
          localStorage.setItem('oculory_session', sessionToken);
          showChat(data);
        } else {
          status.textContent = 'Invalid invite code';
          status.className = 'error';
        }
      } catch (e) {
        status.textContent = 'Error verifying code';
        status.className = 'error';
      }
    }
    
    async function ownerLogin() {
      const code = document.getElementById('owner-code').value.trim();
      const status = document.getElementById('owner-login-status');
      
      // Demo: accept OWNER2026
      if (code !== 'OWNER2026') {
        status.textContent = 'Invalid owner code';
        status.className = 'error';
        return;
      }
      
      isOwner = true;
      showOwnerDashboard();
    }
    
    function showChat(data) {
      document.getElementById('login-view').classList.add('hidden');
      document.getElementById('chat-view').classList.remove('hidden');
      
      const info = \`Logged in as: \${data.userId}\\nAccess: \${data.allowedProjects?.join(', ') || 'default'}\\nLayers: \${data.allowedLayers?.join(', ') || 'all'}\`;
      document.getElementById('session-info').textContent = info;
    }
    
    function showOwnerDashboard() {
      document.getElementById('login-view').classList.add('hidden');
      document.getElementById('owner-view').classList.remove('hidden');
      loadInvites();
    }
    
    function showLogin() {
      document.getElementById('login-view').classList.remove('hidden');
      document.getElementById('chat-view').classList.add('hidden');
      document.getElementById('owner-view').classList.add('hidden');
      localStorage.removeItem('oculory_session');
      sessionToken = null;
      isOwner = false;
    }
    
    function showTab(tab) {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      event.target.classList.add('active');
      
      document.getElementById('tab-friends').classList.add('hidden');
      document.getElementById('tab-invite').classList.add('hidden');
      document.getElementById('tab-' + tab).classList.remove('hidden');
      
      if (tab === 'friends') loadInvites();
    }
    
    async function loadInvites() {
      const list = document.getElementById('invite-list');
      list.innerHTML = '<li style="color: #888; text-align: center; padding: 20px;">Loading...</li>';
      
      try {
        const resp = await fetch(\`\${window.location.origin}/api/invites/list\`);
        const data = await resp.json();
        
        if (data.invites && data.invites.length > 0) {
          list.innerHTML = data.invites.map(invite => \`
            <li class="invite-item">
              <div class="invite-info">
                <div class="invite-name">\${invite.inviteeName}</div>
                <div class="invite-meta">
                  <span class="invite-code">\${invite.code}</span> |
                  \${invite.allowedProjects?.join(', ') || 'default'} |
                  \${invite.allowedLayers?.join(', ') || 'all'}
                </div>
              </div>
              <div class="invite-actions">
                <span class="badge badge-\${invite.status}">\${invite.status}</span>
                <button class="danger" onclick="revokeInvite('\${invite.code}')">Revoke</button>
              </div>
            </li>
          \`).join('');
        } else {
          list.innerHTML = '<li style="color: #888; text-align: center; padding: 20px;">No invites yet</li>';
        }
      } catch(e) {
        list.innerHTML = '<li style="color: #888; text-align: center; padding: 20px;">Error loading invites</li>';
      }
    }
    
    async function createInvite() {
      const name = document.getElementById('invitee-name').value.trim();
      const status = document.getElementById('create-status');
      
      if (!name) {
        status.textContent = 'Please enter a name';
        status.className = 'error';
        return;
      }
      
      // Get selected projects
      const projects = [];
      document.querySelectorAll('#tab-invite input[value="default"]:checked').forEach(() => projects.push('default'));
      document.querySelectorAll('#tab-invite input[value="personal"]:checked').forEach(() => projects.push('personal'));
      document.querySelectorAll('#tab-invite input[value="work"]:checked').forEach(() => projects.push('work'));
      
      // Get selected layers
      const layers = [];
      document.querySelectorAll('#tab-invite input[value="memory"]:checked').forEach(() => layers.push('memory'));
      document.querySelectorAll('#tab-invite input[value="people"]:checked').forEach(() => layers.push('people'));
      document.querySelectorAll('#tab-invite input[value="meeting"]:checked').forEach(() => layers.push('meeting'));
      document.querySelectorAll('#tab-invite input[value="metadata"]:checked').forEach(() => layers.push('metadata'));
      document.querySelectorAll('#tab-invite input[value="transcript"]:checked').forEach(() => layers.push('transcript'));
      
      const canSearch = document.getElementById('can-search').value === 'true';
      const rateLimit = parseInt(document.getElementById('rate-limit').value);
      
      try {
        const resp = await fetch(\`\${window.location.origin}/api/invite/create\`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            inviteeName: name,
            allowedProjects: projects,
            allowedLayers: layers,
            canSearch,
            rateLimit
          })
        });
        const data = await resp.json();
        
        if (data.success) {
          status.textContent = \`Invite created! Code: \${data.code}\`;
          status.className = 'success';
          
          // Copy to clipboard
          navigator.clipboard.writeText(data.code);
          
          // Reset form
          document.getElementById('invitee-name').value = '';
          
          // Refresh list
          loadInvites();
        } else {
          status.textContent = 'Error creating invite';
          status.className = 'error';
        }
      } catch(e) {
        status.textContent = 'Error creating invite';
        status.className = 'error';
      }
    }
    
    async function revokeInvite(code) {
      if (!confirm(\`Revoke access for \${code}?\`)) return;
      
      try {
        const resp = await fetch(\`\${window.location.origin}/api/invite/revoke\`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code })
        });
        
        loadInvites();
      } catch(e) {
        alert('Error revoking invite');
      }
    }
    
    async function sendMessage() {
      const input = document.getElementById('chat-input');
      const query = input.value.trim();
      if (!query) return;
      
      // Add user message
      addMessage('user', query);
      input.value = '';
      
      // Show loading
      addMessage('bot', 'Thinking...');
      
      try {
        const resp = await fetch(\`\${window.location.origin}/api/query\`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query, sessionToken })
        });
        const data = await resp.json();
        
        // Remove loading message
        const messages = document.getElementById('chat-messages');
        messages.removeChild(messages.lastChild);
        
        if (data.success) {
          addMessage('bot', data.response);
          
          // Show sources
          if (data.sources && data.sources.length > 0) {
            const sources = data.sources.map(s => s.title).join(', ');
            addMessage('system', 'Sources: ' + sources);
          }
        } else {
          addMessage('bot', 'Error: ' + (data.error || 'Unknown error'));
        }
      } catch(e) {
        addMessage('bot', 'Error: ' + e.message);
      }
    }
    
    function addMessage(type, text) {
      const messages = document.getElementById('chat-messages');
      const div = document.createElement('div');
      div.style.padding = '8px 12px';
      div.style.margin = '8px 0';
      div.style.borderRadius = '8px';
      div.style.maxWidth = '80%';
      
      if (type === 'user') {
        div.style.background = '#007AFF';
        div.style.color = 'white';
        div.style.marginLeft = 'auto';
      } else if (type === 'bot') {
        div.style.background = '#f0f0f0';
        div.style.color = '#333';
      } else {
        div.style.background = '#fff3cd';
        div.style.color = '#856404';
        div.style.fontSize = '14px';
      }
      
      div.textContent = text;
      messages.appendChild(div);
      messages.scrollTop = messages.scrollHeight;
    }
    
    function handleKeyPress(e) {
      if (e.key === 'Enter') sendMessage();
    }
  </script>
</body>
</html>`;

const server = http.createServer(async (req, res) => {
  const parsedUrl = url.parse(req.url || "", true);

  // CORS headers
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") {
    res.writeHead(200);
    res.end();
    return;
  }

  // API endpoints
  if (parsedUrl.pathname === "/api/verify" && req.method === "GET") {
    const code = parsedUrl.query.code as string;

    try {
      const invites = await convex.query("invites:getByCode", { code });
      const valid = invites && invites.length > 0;

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ valid, project: valid ? invites[0].allowedProjects[0] : null }));
    } catch (e) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ valid: false, error: "Convex not connected" }));
    }
    return;
  }

  // Serve HTML
  res.writeHead(200, { "Content-Type": "text/html" });
  res.end(HTML);
});

server.listen(PORT, () => {
  console.log(`Web server running at http://localhost:${PORT}`);
});
