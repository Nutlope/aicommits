#!/usr/bin/env node
import { execa } from 'execa';
import { bgCyan, black, green, red } from 'kolorist';
import { intro, spinner, confirm, isCancel, outro } from '@clack/prompts';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import ini from 'ini';
import { OpenAIApi, Configuration } from 'openai';

const fileExists = (filePath) => fs.access(filePath).then(() => true, () => false);
const getConfig = async () => {
  const configPath = path.join(os.homedir(), ".aicommits");
  const configExists = await fileExists(configPath);
  if (!configExists) {
    return {};
  }
  const configString = await fs.readFile(configPath, "utf8");
  return ini.parse(configString);
};
const assertGitRepo = async () => {
  const { stdout } = await execa("git", ["rev-parse", "--is-inside-work-tree"], { reject: false });
  if (stdout !== "true") {
    throw new Error("The current directory must be a Git repository!");
  }
};
const excludeFromDiff = [
  "package-lock.json",
  "yarn.lock",
  "pnpm-lock.yaml"
].map((file) => `:(exclude)${file}`);
const getStagedDiff = async () => {
  const diffCached = ["diff", "--cached"];
  const { stdout: files } = await execa(
    "git",
    [...diffCached, "--name-only", ...excludeFromDiff]
  );
  if (!files) {
    return;
  }
  const { stdout: diff } = await execa(
    "git",
    [...diffCached, ...excludeFromDiff]
  );
  return {
    files: files.split("\n"),
    diff
  };
};
const getDetectedMessage = (files) => `Detected ${files.length.toLocaleString()} staged file${files.length > 1 ? "s" : ""}`;
const promptTemplate = "Write an insightful but concise Git commit message in a complete sentence in present tense for the following diff without prefacing it with anything:";
const generateCommitMessage = async (apiKey, diff) => {
  const prompt = `${promptTemplate}
${diff}`;
  if (prompt.length > 8e3) {
    throw new Error("The diff is too large for the OpenAI API");
  }
  const openai = new OpenAIApi(new Configuration({ apiKey }));
  try {
    const completion = await openai.createCompletion({
      model: "text-davinci-003",
      prompt,
      temperature: 0.7,
      top_p: 1,
      frequency_penalty: 0,
      presence_penalty: 0,
      max_tokens: 200,
      stream: false,
      n: 1
    });
    return completion.data.choices[0].text.trim().replace(/[\n\r]/g, "");
  } catch (error) {
    const errorAsAny = error;
    errorAsAny.message = `OpenAI API Error: ${errorAsAny.message} - ${errorAsAny.response.statusText}`;
    throw errorAsAny;
  }
};

(async () => {
  intro(bgCyan(black(" aicommits ")));
  await assertGitRepo();
  const detectingFiles = spinner();
  detectingFiles.start("Detecting staged files");
  const staged = await getStagedDiff();
  if (!staged) {
    throw new Error("No staged changes found. Make sure to stage your changes with `git add`.");
  }
  detectingFiles.stop(`${getDetectedMessage(staged.files)}:
${staged.files.map((file) => `     ${file}`).join("\n")}`);
  const config = await getConfig();
  const OPENAI_KEY = process.env.OPENAI_KEY ?? process.env.OPENAI_API_KEY ?? config.OPENAI_KEY;
  if (!OPENAI_KEY) {
    throw new Error("Please set your OpenAI API key in ~/.aicommits");
  }
  const s = spinner();
  s.start("The AI is analyzing your changes");
  const message = await generateCommitMessage(OPENAI_KEY, staged.diff);
  s.stop("The commit message is ready for review");
  const confirmed = await confirm({
    message: `Would you like to commit with this message:

   ${message}
`
  });
  if (!confirmed || isCancel(confirmed)) {
    outro("Commit cancelled");
    return;
  }
  await execa("git", ["commit", "-m", message]);
  outro(`${green("\u2714")} Successfully committed!`);
})().catch((error) => {
  outro(`${red("\u2716")} ${error.message}`);
  process.exit(1);
});
