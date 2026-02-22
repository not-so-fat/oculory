import "dotenv/config";
import express from "express";

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 8080;

// Demo invites
const invites = new Map([
  ["HACK2026", { name: "Demo User", projects: ["default", "personal"], layers: ["memory", "people", "meeting", "metadata", "transcript"] }]
]);

const HTML = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Oculory</title>
  <style>
    body { font-family: -apple-system, sans-serif; max-width: 500px; margin: 50px auto; padding: 20px; background: #0A0A07; color: #92E4DD; }
    .container { background: rgba(146,228,221,0.05); border: 1px solid #92E4DD; border-radius: 12px; padding: 30px; }
    h1 { color: #C4B643; text-align: center; }
    input { width: 100%; padding: 15px; margin: 10px 0; border: 1px solid #92E4DD; border-radius: 8px; background: transparent; color: #92E4DD; font-size: 16px; }
    input::placeholder { color: #888; }
    button { width: 100%; padding: 15px; background: #92E4DD; color: #0A0A07; border: none; border-radius: 8px; font-size: 16px; font-weight: bold; cursor: pointer; margin: 5px 0; }
    button:hover { background: #C4B643; }
    .error { color: #F9386D; margin: 10px 0; }
    a { color: #C4B643; }
  </style>
</head>
<body>
  <div class="container">
    <h1>Oculory</h1>
    <div id="login-view">
      <p>Enter invite code:</p>
      <input type="text" id="code" placeholder="Enter code" />
      <button onclick="join()">Join Chat</button>
      <p class="error" id="msg"></p>
      <p style="margin-top:20px"><a href="#" onclick="showOwner()">Owner login</a></p>
    </div>
    <div id="owner-view" style="display:none">
      <p>Owner code:</p>
      <input type="password" id="owner-code" placeholder="Enter owner code" />
      <button onclick="ownerLogin()">Login</button>
      <p class="error" id="owner-msg"></p>
      <p style="margin-top:20px"><a href="#" onclick="showLogin()">Back to login</a></p>
    </div>
    <div id="chat-view" style="display:none">
      <h2>Welcome!</h2>
      <p>Ask anything about the knowledge base.</p>
      <input type="text" id="query" placeholder="Ask a question..." />
      <button onclick="ask()">Ask</button>
      <div id="response" style="margin-top:20px"></div>
    </div>
  </div>
  <script>
    function join() {
      var code = document.getElementById('code').value;
      fetch('/api/verify', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({code:code}) })
        .then(function(r) { return r.json(); })
        .then(function(d) {
          if (d.valid) {
            document.getElementById('login-view').style.display = 'none';
            document.getElementById('chat-view').style.display = 'block';
          } else {
            document.getElementById('msg').textContent = 'Invalid code';
          }
        });
    }
    function showOwner() {
      document.getElementById('login-view').style.display = 'none';
      document.getElementById('owner-view').style.display = 'block';
    }
    function showLogin() {
      document.getElementById('owner-view').style.display = 'none';
      document.getElementById('login-view').style.display = 'block';
    }
    function ownerLogin() {
      var code = document.getElementById('owner-code').value;
      if (code === 'OWNER2026') {
        document.getElementById('owner-view').style.display = 'none';
        document.body.innerHTML = '<div class="container"><h1>Owner Dashboard</h1><p>Owner mode active.</p></div>';
      } else {
        document.getElementById('owner-msg').textContent = 'Invalid code';
      }
    }
    function ask() {
      var q = document.getElementById('query').value;
      fetch('/api/query', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({query:q}) })
        .then(function(r) { return r.json(); })
        .then(function(d) {
          document.getElementById('response').innerHTML = '<p>' + (d.response || d.error) + '</p>';
        });
    }
  </script>
</body>
</html>`;

app.get("/", function(req, res) { res.send(HTML); });

app.post("/api/verify", express.json(), function(req, res) {
  var code = req.body.code;
  if (invites.has(code)) {
    res.json({ valid: true });
  } else {
    res.json({ valid: false });
  }
});

app.post("/api/query", express.json(), function(req, res) {
  res.json({ response: "Demo response. Configure GIST_URL to load knowledge base." });
});

app.listen(PORT, function() {
  console.log("Server running on port " + PORT);
});
