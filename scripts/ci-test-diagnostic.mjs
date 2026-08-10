import { spawn } from "node:child_process";

function escapeWorkflowCommand(value) {
  return value.replaceAll("%", "%25").replaceAll("\r", "%0D").replaceAll("\n", "%0A");
}

function run(command, args, { capture = false } = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      env: process.env,
      stdio: capture ? ["inherit", "pipe", "pipe"] : "inherit",
    });
    let output = "";
    if (capture) {
      for (const stream of [child.stdout, child.stderr]) {
        stream.on("data", (chunk) => {
          const text = chunk.toString();
          output += text;
          process.stdout.write(text);
        });
      }
    }
    child.on("exit", (code, signal) => {
      resolve({ code: code ?? (signal ? 1 : 0), output });
    });
  });
}

const workspaceTests = await run("pnpm", ["exec", "turbo", "run", "test"], { capture: true });
if (workspaceTests.code !== 0) {
  if (process.env.GITHUB_ACTIONS === "true") {
    const tail = workspaceTests.output.split(/\r?\n/u).filter(Boolean).slice(-80);
    for (const line of tail) {
      console.log(`::error title=Workspace test failure::${escapeWorkflowCommand(line)}`);
    }
  }
  process.exit(workspaceTests.code);
}

const scriptTests = await run("pnpm", ["test:scripts"]);
process.exit(scriptTests.code);
