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

function failingBlocks(output) {
  const lines = output.split(/\r?\n/u);
  const markers = [];
  for (let index = 0; index < lines.length; index += 1) {
    if (/\bnot ok\b|AssertionError|ERR_(?:ASSERTION|TEST_FAILURE)|failureType:|testCodeFailure/iu.test(lines[index])) {
      markers.push(index);
    }
  }

  const ranges = [];
  for (const marker of markers) {
    const start = Math.max(0, marker - 8);
    const end = Math.min(lines.length, marker + 28);
    const previous = ranges.at(-1);
    if (previous && start <= previous.end + 2) previous.end = Math.max(previous.end, end);
    else ranges.push({ start, end });
  }

  return ranges.slice(0, 12).map(({ start, end }) =>
    lines.slice(start, end).filter(Boolean).join("\n"),
  );
}

const workspaceTests = await run("pnpm", ["exec", "turbo", "run", "test"], { capture: true });
if (workspaceTests.code !== 0) {
  if (process.env.GITHUB_ACTIONS === "true") {
    const blocks = failingBlocks(workspaceTests.output);
    if (blocks.length > 0) {
      for (const block of blocks) {
        console.log(`::error title=Workspace failing test block::${escapeWorkflowCommand(block)}`);
      }
    } else {
      const tail = workspaceTests.output.split(/\r?\n/u).filter(Boolean).slice(-120).join("\n");
      console.log(`::error title=Workspace test failure tail::${escapeWorkflowCommand(tail)}`);
    }
  }
  process.exit(workspaceTests.code);
}

const scriptTests = await run("pnpm", ["test:scripts"]);
process.exit(scriptTests.code);
