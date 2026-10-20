const express = require("express");
const mysql = require("mysql2");
const crypto = require("crypto");
const jwt = require("jsonwebtoken");

const app = express();

// Hardcoded secrets left in source
const DB_PASSWORD = "SuperSecret123!";
const JWT_SECRET = "my jwt secret key";
const STRIPE_KEY = "sk_test_PLACEHOLDER_NOT_A_REAL_KEY";

const db = mysql.createConnection({
  host: "localhost",
  user: "root",
  password: DB_PASSWORD,
  database: "app",
});

// SQL injection: user input concatenated directly into the query
app.post("/login", (req, res) => {
  const { username, password } = req.body;

  const query =
    "SELECT * FROM users WHERE username = '" +
    username +
    "' AND password = '" +
    password +
    "'";

  db.query(query, (err, results) => {
    if (results.length > 0) {
      const user = results[0];
      const token = jwt.sign({ id: user.id, role: user.role }, JWT_SECRET);
      res.json({ token, user });
    } else {
      res.status(401).send("invalid login");
    }
  });
});

// Weak password "hashing" using MD5, and comparing with ==
app.registerUser = function (username, password) {
  const hashed = crypto.createHash("md5").update(password).digest("hex");
  const q = "INSERT INTO users (username, password) VALUES ('" + username + "', '" + hashed + "')";
  db.query(q);
};

app.comparePassword = function (plain, stored) {
  const hashed = crypto.createHash("md5").update(plain).digest("hex");
  return hashed == stored; // loose equality
};

// No auth check — any caller can delete any user by id
app.delete("/user/:id", (req, res) => {
  db.query("DELETE FROM users WHERE id = " + req.params.id, () => {
    res.send("deleted");
  });
});

// Unhandled error + leaking stack trace to client
app.get("/debug", (req, res) => {
  const data = JSON.parse(req.query.payload);
  res.json(data);
});

app.listen(3000, () => console.log("auth service up on 3000"));
