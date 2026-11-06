import { test } from "node:test";
import assert from "node:assert/strict";
import { decide } from "./router";
import type { JevResponse } from "./jev";

const res = (jailbreak: number, hijack: number, inScope: number, chitchat: number): JevResponse => ({
  answers: {
    jailbreak: { type: "noul", noul: jailbreak },
    hijack: { type: "noul", noul: hijack },
    in_scope: { type: "noul", noul: inScope },
    route: {
      type: "choice",
      choice: chitchat > 0.5 ? "chitchat" : "task",
      probabilities: { chitchat, task: 1 - chitchat },
      confidence: 1,
    },
  },
});

test("jailbreak is blocked", () => {
  const d = decide(res(0.99, 0, 1, 0), "understand");
  assert.equal(d.action, "block");
  assert.equal(d.reason, "jailbreak");
});

test("hijack is blocked", () => assert.equal(decide(res(0, 0.8, 1, 0), "understand").reason, "hijack"));

test("out of scope is blocked when no task is running", () => {
  assert.equal(decide(res(0, 0, 0.1, 0), "understand").reason, "out_of_scope");
});

test("a short reply mid-task is not blocked as out of scope", () => {
  const d = decide(res(0, 0, 0.1, 0), "choose");
  assert.equal(d.action, "allow");
  assert.equal(d.model, "heavy");
});

test("small talk uses the instant model", () => {
  const d = decide(res(0, 0, 0.95, 0.95), "understand");
  assert.equal(d.model, "instant");
  assert.equal(d.hardened, false);
});

test("a task uses the heavy model", () => assert.equal(decide(res(0, 0, 1, 0.02), "understand").model, "heavy"));

test("suspicious band is allowed but hardened on the heavy model", () => {
  const d = decide(res(0.5, 0, 1, 0.9), "understand");
  assert.deepEqual([d.action, d.model, d.hardened], ["allow", "heavy", true]);
});

test("small talk never uses the instant model mid-task", () => {
  assert.equal(decide(res(0, 0, 1, 0.99), "confirm").model, "heavy");
});

test("Jev failure fails closed", () => {
  const d = decide(null, "understand");
  assert.deepEqual([d.action, d.model, d.hardened, d.reason], ["allow", "heavy", true, "jev_unavailable"]);
});
