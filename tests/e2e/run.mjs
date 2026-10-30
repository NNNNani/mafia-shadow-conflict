// Runs every browser test: starts its own servers, runs the tests, stops the servers.
// Works the same on Windows, macOS and Linux:  npm run test:e2e
// Needs Playwright once:  npm i -D playwright  &&  npx playwright install chromium
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

try {
  await import("playwright");
} catch {
  console.error("Playwright n'est pas installé. Lance d'abord :");
  console.error("  npm i -D playwright");
  console.error("  npx playwright install chromium");
  process.exit(1);
}

const SUITES = [
  { file: "fullGame.mjs", port: 3100, env: { TIME_SCALE: "0.25" } },
  { file: "protocol.mjs", port: 3101, env: { MIN_PLAYERS: "3" } },
  { file: "bigGame.mjs", port: 3102, env: { TIME_SCALE: "0.1" } },
];

/** Starts `node server.js` with extra environment variables. */
function startServer(port, env) {
  const child = spawn(process.execPath, ["server.js"], {
    cwd: root,
    env: { ...process.env, ...env, PORT: String(port) },
    stdio: ["ignore", "ignore", "inherit"],
  });
  return child;
}

/** Waits until the server answers HTTP requests. */
async function waitForServer(url, timeoutMs = 10_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      /* not ready yet */
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`Le serveur ${url} n'a pas démarré.`);
}

function runTest(file, baseUrl) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(root, "tests/e2e", file)], {
      cwd: root,
      env: { ...process.env, BASE_URL: baseUrl },
      stdio: "inherit",
    });
    child.on("exit", (code) => resolve(code === 0));
  });
}

const only = process.argv[2]; // e.g. "npm run test:e2e -- fullGame"
const results = [];
for (const suite of SUITES.filter((s) => !only || s.file.startsWith(only))) {
  const baseUrl = `http://localhost:${suite.port}`;
  console.log(`\n=== ${suite.file} ===`);
  const server = startServer(suite.port, suite.env);
  try {
    await waitForServer(baseUrl);
    results.push([suite.file, await runTest(suite.file, baseUrl)]);
  } catch (error) {
    console.error(error.message);
    results.push([suite.file, false]);
  } finally {
    server.kill();
  }
}

console.log("\n=== Résumé ===");
results.forEach(([file, ok]) => console.log(`${ok ? "✓" : "✗"} ${file}`));
process.exitCode = results.every(([, ok]) => ok) ? 0 : 1;
