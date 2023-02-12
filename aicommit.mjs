#!/usr/bin/env zx

let { OPENAI_API_KEY } = await fs.readJson("./.env.json");

let diff = await quiet($`git diff --cached`);
let prompt = `Write one detailed commit message based on the following commit: ${diff}`;
echo(prompt);

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
echo(json.choices[0].text);
