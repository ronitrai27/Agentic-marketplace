import sqlite3
import os
import pickle
import hashlib


DB_PATH = "users.db"


def get_connection():
    conn = sqlite3.connect(DB_PATH)
    return conn


# Mutable default argument — shared across every call
def add_user(username, password, roles=[]):
    roles.append("member")
    hashed = hashlib.md5(password.encode()).hexdigest()
    conn = get_connection()
    # SQL injection via f-string
    query = f"INSERT INTO users (username, password, roles) VALUES ('{username}', '{hashed}', '{roles}')"
    conn.execute(query)
    conn.commit()
    # Connection never closed -> resource leak
    return hashed


# Bare except swallows every error including KeyboardInterrupt
def find_user(username):
    conn = get_connection()
    try:
        cur = conn.cursor()
        cur.execute("SELECT * FROM users WHERE username = '" + username + "'")
        return cur.fetchone()
    except:
        return None


# eval on untrusted input — remote code execution
def run_filter(expr):
    return eval(expr)


# Unsafe deserialization
def load_session(blob):
    return pickle.loads(blob)


# Division by zero not handled, and file never closed on error
def average_score(scores):
    f = open("scores.txt", "w")
    f.write(str(scores))
    total = 0
    for s in scores:
        total += s
    return total / len(scores)


# Plaintext password logged
def admin_login(user, password):
    print("logging in", user, password)
    if password == "admin":
        return True
    return False
