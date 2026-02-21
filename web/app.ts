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
  <title>Oculory - Voice Agent</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 50px auto; padding: 20px; }
    h1 { color: #333; }
    .invite-form { background: #f5f5f5; padding: 20px; border-radius: 8px; }
    input, button { padding: 12px; font-size: 16px; margin: 5px 0; width: 100%; box-sizing: border-box; }
    button { background: #007AFF; color: white; border: none; border-radius: 8px; cursor: pointer; }
    button:hover { background: #0056b3; }
    .error { color: red; margin-top: 10px; }
    .success { color: green; margin-top: 10px; }
  </style>
</head>
<body>
  <h1>Oculory Voice Agent</h1>
  <div class="invite-form">
    <p>Enter your invitation code to chat with the knowledge base:</p>
    <input type="text" id="code" placeholder="Enter invite code" />
    <button onclick="joinChat()">Join Chat</button>
    <p id="status"></p>
  </div>
  <script>
    async function joinChat() {
      const code = document.getElementById('code').value;
      const status = document.getElementById('status');
      
      if (!code) {
        status.textContent = 'Please enter a code';
        status.className = 'error';
        return;
      }
      
      try {
        // Verify invite code with Convex
        const response = await fetch(\`\${window.location.origin}/api/verify?code=\${code}\`);
        const data = await response.json();
        
        if (data.valid) {
          status.textContent = 'Valid invite! Starting voice chat...';
          status.className = 'success';
          // TODO: Initialize VAPI voice call here
        } else {
          status.textContent = 'Invalid invite code';
          status.className = 'error';
        }
      } catch (e) {
        status.textContent = 'Error verifying code';
        status.className = 'error';
      }
    }
  </script>
</body>
</html>`;

const server = http.createServer(async (req, res) => {
  const parsedUrl = url.parse(req.url || "", true);

  // CORS headers
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

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
