# Agentic generation benchmark

Last run: 2026-07-23

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

The 2026-07-23 Together catalog contained 22 serverless chat models. Fifteen
completed the streaming two-tool protocol after retrying one transient Qwen
failure. Seven consistently failed and remain on the non-agentic fallback path.

Raw JSON reports are generated locally under `docs/research/`, which is ignored
by Git:

- `2026-07-23-final-small-benchmark-results.json`
- `2026-07-23-final-fair-large-benchmark-results.json`
- `2026-07-23-together-tool-compatibility.json`
- `2026-07-23-together-tool-compatibility-retry.json`
