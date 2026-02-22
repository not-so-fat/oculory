import "dotenv/config";
import express from "express";

const app = express();
app.use(express.json());

const HTML = `<!DOCTYPE html>
<html>
<head>
  <title>Oculory</title>
</head>
<body>
  <h1>Oculory</h1>
  <p>Enter invite code:</p>
  <input type="text" id="code" placeholder="Enter code" />
  <button onclick="join()">Join</button>
  <p id="msg"></p>
  <hr />
  <p>Owner? <a href="#" onclick="showOwner()">Login</a></p>
  <div id="owner" style="display:none;">
    <input type="password" id="owner-code" placeholder="Owner code" />
    <button onclick="ownerLogin()">Login</button>
  </div>
  <script>
    async function join() {
      const code = document.getElementById('code').value;
      const res = await fetch('/api/verify-invite', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({code})
      });
      const data = await res.json();
      document.getElementById('msg').textContent = data.valid ? 'Welcome!' : 'Invalid code';
    }
    function showOwner() {
      document.getElementById('owner').style.display = 'block';
    }
    async function ownerLogin() {
      const code = document.getElementById('owner-code').value;
      if (code === 'OWNER2026') {
        document.body.innerHTML = '<h1>Owner Dashboard</h1><p>Welcome, Owner!</p>';
      } else {
        alert('Invalid');
      }
    }
  </script>
</body>
</html>`;

app.get("/", (req, res) => {
  res.send(HTML);
});

app.post("/api/verify-invite", (req, res) => {
  const { code } = req.body;
  if (code === "HACK2026") {
    res.json({ valid: true });
  } else {
    res.json({ valid: false });
  }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
