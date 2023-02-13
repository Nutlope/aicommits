#!/usr/bin/env zx
$.verbose = false;

// Add console.log with "no git diff"

console.log(chalk.white("▲ ") + chalk.green("Welcome to AICommit!"));

let { OPENAI_API_KEY } = await fs.readJson(
  "/Users/hassan/dev/ai-commit/.env.json"
);
let diff = await quiet($`git diff --cached`);

let prompt = `I want you to act like a git commit message writer. I will input a git diff and your job is to convert it into a useful commit message. Do not preface the commit with anything, do not repeat yourself, and return a complete sentence: ${diff}`;
// let prompt = `Write one detailed commit message based on the following commit. Do not preface the commit with anything, write it right away: `;

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

console.log(
  chalk.white("▲ ") + chalk.gray("Generating your AI commit message...")
);

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
let cleanedUpAiCommit = aiCommit.replace(/(\r\n|\n|\r)/gm, "");

echo(cleanedUpAiCommit);

let confirmationMessage = await question(
  "\nWould you like to use this commit message? " + chalk.yellow("(Y/n) "),
  {
    choices: ["Y", "n"],
  }
);

$.verbose = true;
echo("\n");

if (confirmationMessage !== "n") {
  await $`git commit -m ${cleanedUpAiCommit}`;
}
