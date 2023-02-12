#!/usr/bin/env zx

let { OPENAI_API_KEY } = await fs.readJson("./.env.json");

let diff = await $`git diff --cached`;

// echo("Current branch is", branch);
// console.log(branch);
echo(diff);
