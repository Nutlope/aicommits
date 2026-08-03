# Agentic generation benchmark

Comparative benchmark: 2026-07-23. Tool-compatibility refresh: 2026-07-31.

The benchmark runner and GitHub PR fixtures live in
`scripts/benchmark-together-models.ts`. It checks the current generator against
the CLI behavior at commit `8a4d231`.

The legacy side reproduces the old CLI's real behavior:

- diffs longer than 30,000 characters are truncated;
- changes with more than 50 files are split into ten-file chunks;
- chunk messages are generated sequentially and then combined.

This matters because calling the old low-level generator once with the complete
diff makes large-diff comparisons invalid.

## Fixtures

The small suite contains three real PRs with 3-4 files and 4,031-7,425 diff
characters. The large suite contains three Vercel AI PRs:

| PR | Files | Diff characters |
| --- | ---: | ---: |
| `vercel/ai#5700` | 21 | 18,566 |
| `vercel/ai#5882` | 47 | 69,556 |
| `vercel/ai#5759` | 95 | 271,334 |

Each model ran once per fixture. Timings are useful for directional comparisons,
not stable percentiles. Runs were sequential to avoid provider load affecting
the result.

## Results

Paired speed compares only fixtures where both generators returned a usable
message.

| Model | Mode | Legacy usable | Candidate usable | Candidate average | Paired speed |
| --- | --- | ---: | ---: | ---: | ---: |
| Kimi K2.7 Code | agentic | 5/6 | 6/6 | 1.05s | 4.45x faster |
| GLM 5.2 | agentic | 5/6 | 6/6 | 2.31s | 2.08x faster |
| Kimi K2.6 | agentic | 2/6 | 6/6 | 1.50s | 10.23x faster |
| MiniMax M3 | agentic | 5/6 | 5/6 | 13.69s | 5.25x faster |
| MiniMax M2.7 | agentic | 6/6 | 6/6 | 2.17s | 4.61x faster |
| Gemma 4 31B | agentic | 4/6 | 6/6 | 2.48s | 22.53x faster |
| Qwen 3.5 9B | agentic | 0/6 | 6/6 | 2.97s | no usable legacy pair |
| GPT-OSS 20B | fallback | 4/6 | 5/6 | 11.67s | 1.38x faster |
| Llama 3.3 70B | fallback | 6/6 | 6/6 | 4.31s | 1.37x slower |
| GPT-OSS 120B | fallback | 5/6 | 5/6 | 6.21s | 2.79x faster |

Across tool-compatible models, the candidate returned 41/42 usable messages
versus 27/42 for the legacy CLI. On the 26 paired successes, it was 8.24x
faster.

Across fallback models, the candidate returned 16/18 usable messages versus
15/18 for the legacy CLI. On paired successes, it was 1.24x faster.

## Quality assessment

The highlighted Together models are:

1. `moonshotai/Kimi-K2.7-Code`
2. `zai-org/GLM-5.2`
3. `moonshotai/Kimi-K2.6`
4. `MiniMaxAI/MiniMax-M2.7`

Kimi K2.7 produced the best overall combination of accuracy, latency, and
consistency. GLM 5.2, Kimi K2.6, and MiniMax M2.7 also remained accurate on the
95-file fixture.

MiniMax M3 timed out once. Qwen completed all fixtures, but its 95-file message
described an unrelated RAI-rules migration. Both remain supported but are not
highlighted.

Removing the hard subject-length schema fixed clipped endings without causing
runaway titles. The prompt now treats the configured length as a preference.
Agent submissions also accept an empty or omitted body when descriptions are
disabled and retry once after a completed invalid submission.

## Tool compatibility

The 2026-07-31 authenticated Together catalog contained 23 serverless chat
models. Fourteen completed the streaming two-tool protocol on the first pass.
`thinkingmachines/Inkling` passed its retry, five subsequent protocol repeats,
and all six real-PR generator runs with accurate subjects at a 1.91-second
average. A fresh 2026-08-03 built-CLI check exposed a 512-token output-budget
failure: Inkling sometimes spent 511 tokens reasoning and reached
`finish_reason: length` before producing final text or a tool call. Its provider
policy now allows 2,048 output tokens; five subsequent built-CLI agentic runs
all passed in 1.88-6.22 seconds. Inkling remains agentic. The eight fallback
models are:

- `arize-ai/qwen-2-1.5b-instruct`
- `deepcogito/cogito-v2-1-671b`
- `google/gemma-3n-E4B-it`
- `meta-llama/Llama-3.3-70B-Instruct-Turbo`
- `openai/gpt-oss-120b`
- `openai/gpt-oss-20b`
- `pearl-ai/gemma-4-31b-it`
- `Qwen/Qwen2.5-7B-Instruct-Turbo`

`MiniMaxAI/MiniMax-M3` and the newly available `moonshotai/Kimi-K3` each passed
all six focused two-tool checks. On the real three-PR small suite, repeated
twice, both produced accurate commit subjects in all six runs. MiniMax M3
averaged 2.69 seconds; Kimi K3 averaged 6.39 seconds and had more variable
latency. `MiniMaxAI/MiniMax-M2.7` was no longer present in the live serverless
chat catalog.

The same 2026-08-03 built-CLI check exposed a separate timeout issue. Together
requests now default to 60 seconds instead of the generic 10 seconds. GLM 5.2
completed 3/3 runs (2.46-8.19s), Kimi K3 completed 3/3 runs
(2.69-16.38s), MiniMax M3 completed its focused run in 1.98s, and the Qwen 2.5
fallback completed in 1.71s. Kimi K3's 16.38-second success directly exercises
the longer provider timeout.

The bounded full-coverage path was also rerun against the 95-file,
271,334-character `vercel/ai#5759` fixture with Kimi K2.7 Code. It completed in
12.96 seconds and produced `refactor(ai): rename text stream part from
text-delta to text and generated text to typed object shape`, covering both
major changes without silently truncating the diff. The historical prefix-only
path took 71.51 seconds on the same run.

Raw JSON reports are generated locally under `docs/research/`, which is ignored
by Git:

- `2026-07-23-final-small-benchmark-results.json`
- `2026-07-23-final-fair-large-benchmark-results.json`
- `2026-07-23-together-tool-compatibility.json`
- `2026-07-23-together-tool-compatibility-retry.json`
- `2026-07-31-together-tool-compatibility.json`
- `2026-07-31-together-tool-compatibility-retry.json`
- `2026-07-31-targeted-agentic-repeat-{1..5}.json`
- `2026-07-31-minimax-m3-kimi-k3-small-benchmark.json`
- `2026-07-31-inkling-small-benchmark.json`
- `2026-08-03-large-covered-benchmark.json`
