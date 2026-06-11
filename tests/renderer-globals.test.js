"use strict";
/* Regression: contextBridge.exposeInMainWorld("api", …) defines a NON-CONFIGURABLE
   global. A top-level `const api` in the inline script then throws
   "Identifier 'api' has already been declared" at instantiation and the whole
   renderer dies blank. new Function() parse checks can't catch this (function
   scope) — so run the script at REAL global scope in a vm context that has the
   same restricted global. The script must get past instantiation (it will later
   throw a ReferenceError on missing DOM globals — that's fine and expected). */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

test("inline script tolerates the contextBridge-style non-configurable window.api global", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
  const src = html.match(/<script>([\s\S]*)<\/script>/)[1];
  const ctx = vm.createContext({});
  vm.runInContext(
    'Object.defineProperty(globalThis, "api", { value: {}, writable: false, configurable: false });',
    ctx
  );
  let err = null;
  try { vm.runInContext(src, ctx); } catch (e) { err = e; }
  assert.ok(err, "expected the script to stop at missing DOM globals");
  assert.ok(!/already been declared/.test(err.message),
    "global-scope identifier collision with window.api: " + err.message);
});
