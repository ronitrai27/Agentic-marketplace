const express = require("express");
const fs = require("fs");
const path = require("path");
const { exec } = require("child_process");

const app = express();
const UPLOAD_DIR = "./uploads";

// Path traversal: user-controlled filename joined with no sanitization
app.post("/upload", (req, res) => {
  const filename = req.body.filename;
  const content = req.body.content;

  // No check for "../" — attacker can write outside UPLOAD_DIR
  const target = path.join(UPLOAD_DIR, filename);

  // Missing encoding / error handling; writeFileSync blocks the event loop
  fs.writeFileSync(target, content);

  res.send("uploaded " + target);
});

// Command injection: user input interpolated straight into a shell command
app.post("/resize", (req, res) => {
  const image = req.body.image;
  const width = req.body.width;

  exec("convert " + image + " -resize " + width + " output.png", (err, stdout) => {
    if (err) {
      res.status(500).send(err.message);
    } else {
      res.send(stdout);
    }
  });
});

// Reads arbitrary file via traversal, returns contents to attacker (LFI)
app.get("/download", (req, res) => {
  const name = req.query.file;
  const full = UPLOAD_DIR + "/" + name;
  const data = fs.readFileSync(full);
  res.send(data);
});

// No auth, no size limit, no type check — unrestricted file delete
app.post("/delete", (req, res) => {
  const file = req.body.file;
  fs.unlinkSync(UPLOAD_DIR + "/" + file);
  res.send("deleted");
});

// Regex DoS + no timeout on external call
app.post("/process", (req, res) => {
  const pattern = req.body.pattern;
  const input = req.body.input;
  const re = new RegExp(pattern);
  if (re.test(input)) {
    res.send("match");
  } else {
    res.send("no match");
  }
});

app.listen(4000, () => console.log("upload service on 4000"));
