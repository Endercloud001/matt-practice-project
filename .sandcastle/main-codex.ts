import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { codex, run } from "@ai-hero/sandcastle";
import { docker } from "@ai-hero/sandcastle/sandboxes/docker";

const [issueText, branch = "codex/ralph-trial", iterationText = "1"] =
  process.argv.slice(2);
const issueNumber = Number(issueText);
const maxIterations = Number(iterationText);

if (
  !Number.isSafeInteger(issueNumber) ||
  issueNumber < 1 ||
  !Number.isSafeInteger(maxIterations) ||
  maxIterations < 1 ||
  !branch.startsWith("codex/")
) {
  throw new Error(
    "Usage: main-codex.ts <issue-number> <codex/branch> <iterations>"
  );
}

const issueFile = `.sandcastle/tasks/issue-${issueNumber}.json`;
if (!existsSync(issueFile)) {
  throw new Error(`Missing Issue snapshot: ${issueFile}`);
}

const codexHome =
  process.env.SANDCASTLE_CODEX_HOME ??
  join(homedir(), ".local/share/sandcastle/codex-home");
const pnpmStore = join(homedir(), ".local/share/sandcastle/pnpm-store");
const capturedSessions = join(
  homedir(),
  ".local/share/sandcastle/captured-sessions"
);
mkdirSync(codexHome, { recursive: true, mode: 0o700 });
mkdirSync(pnpmStore, { recursive: true });
mkdirSync(capturedSessions, { recursive: true, mode: 0o700 });

const controller = new AbortController();
const abort = () => controller.abort(new Error("用户中断 Ralph Loop"));
process.once("SIGINT", abort);
process.once("SIGTERM", abort);

try {
  const result = await run({
    agent: codex(process.env.SANDCASTLE_MODEL ?? "gpt-6.1-sol", {
      effort: "medium",
      sessionStorage: {
        hostSessionsDir: capturedSessions,
        sandboxSessionsDir: "/home/agent/.codex/sessions",
      },
    }),
    sandbox: docker({
      imageName: "sandcastle:cohort004-codex",
      mounts: [
        { hostPath: codexHome, sandboxPath: "/home/agent/.codex" },
        {
          hostPath: pnpmStore,
          sandboxPath: "/home/agent/.local/share/pnpm/store",
        },
      ],
      env: { CODEX_HOME: "/home/agent/.codex" },
    }),
    branchStrategy: { type: "branch", branch },
    promptFile: ".sandcastle/prompt-codex.md",
    promptArgs: { ISSUE_FILE: issueFile },
    maxIterations,
    completionSignal: [
      "<promise>COMPLETE</promise>",
      "<promise>BLOCKED</promise>",
    ],
    idleTimeoutSeconds: 600,
    signal: controller.signal,
    hooks: {
      sandbox: {
        onSandboxReady: [
          {
            command: `test -f AGENTS.md && test -f ${issueFile} && codex login status && pnpm install --frozen-lockfile --store-dir /home/agent/.local/share/pnpm/store`,
            timeoutMs: 900_000,
          },
        ],
      },
    },
  });

  console.log(
    JSON.stringify(
      {
        branch: result.branch,
        iterations: result.iterations.length,
        completionSignal: result.completionSignal ?? "ITERATION_LIMIT",
        commits: result.commits,
        logFilePath: result.logFilePath,
        preservedWorktreePath: result.preservedWorktreePath,
      },
      null,
      2
    )
  );

  // 这是循环控制结果；完成后仍需人工核对需求与测试证据。
  if (result.completionSignal === "<promise>BLOCKED</promise>") {
    process.exitCode = 2;
  } else if (result.completionSignal !== "<promise>COMPLETE</promise>") {
    process.exitCode = 3;
  }
} finally {
  process.removeListener("SIGINT", abort);
  process.removeListener("SIGTERM", abort);
}
