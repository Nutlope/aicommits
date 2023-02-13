#!/usr/bin/env zx

void (async function () {
  $.verbose = false;

  let conventionalCommit = false;

  console.log(chalk.white("▲ ") + chalk.green("Welcome to AICommit!"));

  let pwd = await $`cd ~ && pwd;`;

  let { OPENAI_API_KEY } = await fs.readJson(
    `${pwd.stdout.trim()}/ai-commit/.env.json`
  );
  let diff = await $`git diff --cached`;

  // Accounting for GPT-3's input req of 4k tokens (approx 8k chars)
  if (diff.stdout.length > 8000) {
    console.log("The diff is too large to write a commit message.");
    await $`exit 1`;
  }

  if (diff.stdout.length === 0) {
    console.log(
      "No staged changes found. Make sure there are changes and run `git add .`"
    );
    await $`exit 1`;
  }

  let prompt = `I want you to act like a git commit message writer. I will input a git diff and your job is to convert it into a useful commit message. ${
    conventionalCommit
      ? "Preface the commit with 'feat:' if it is a feature or 'fix:' if it is a bug."
      : "Do not preface the commit with anything."
  } Return a complete sentence and do not repeat yourself: ${diff}`;

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
})();
