#!/usr/bin/env node
const { execSync, spawn } = require("child_process");
let OPENAI_API_KEY = process.env.OPENAI_API_KEY;
import inquirer from "inquirer";

export async function main() {
  console.log("Welcome to AICommit!");
  if (!OPENAI_API_KEY) {
    console.error(
      "Please specify an OpenAI key using export OPEN_AI_KEY='YOUR_API_KEY'"
    );
    process.exit(1);
  }
  // Check to see if the user is in a git repo
  try {
    execSync("git rev-parse --is-inside-work-tree", {
      encoding: "utf8",
      stdio: "ignore",
    });
  } catch (e) {
    console.error("This is not a git repository");
    process.exit(1);
  }

  let conventionalCommit = false;

  const diff = execSync("git diff --cached", { encoding: "utf8" });

  if (!diff) {
    console.log(
      "No staged changes found. Make sure there are changes and run `git add .`"
    );
    process.exit(1);
  }

  // Accounting for GPT-3's input req of 4k tokens (approx 8k chars)
  if (diff.length > 8000) {
    console.log("The diff is too large to write a commit message.");
    process.exit(1);
  }

  let prompt = `I want you to act like a git commit message writer. I will input a git diff and your job is to convert it into a useful commit message. ${
    conventionalCommit
      ? "Preface the commit with 'feat:' if it is a feature or 'fix:' if it is a bug."
      : "Do not preface the commit with anything."
  } Return a complete sentence and do not repeat yourself: ${diff}`;

  const aiCommitMessage = await generateCommitMessage(prompt);

  console.log(aiCommitMessage);

  const confirmationMessage = await inquirer.prompt([
    {
      name: "useCommitMessage",
      message: "Would you like to use this commit message? (Y / n)",
      choices: ["Y", "y", "n"],
      default: "y",
    },
  ]);

  if (confirmationMessage !== "n") {
    execSync(`git commit -m "${cleanedUpAiCommit}"`, {
      encoding: "utf8",
    });
  }
}

async function generateCommitMessage(prompt) {
  const payload = {
    model: "text-davinci-003",
    prompt,
    temperature: 0.7,
    top_p: 1,
    frequency_penalty: 0,
    presence_penalty: 0,
    max_tokens: 200,
    stream: false,
    n: 1,
  };
  const response = await fetch("https://api.openai.com/v1/completions", {
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OPENAI_API_KEY ?? ""}`,
    },
    method: "POST",
    body: JSON.stringify(payload),
  });

  const json = await response.json();
  const aiCommit = json.choices[0].text;

  return aiCommit.replace(/(\r\n|\n|\r)/gm, "");
}
