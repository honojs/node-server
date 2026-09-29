# Content-Length benchmarks

Compare the original caller-header mutation, a copy of plain header records, and
an HTTP/1 `_contentLength` candidate with compatibility guards. Dependencies are
resolved from the repository's frozen lockfile (currently Hono 4.13.9).
The harness records the installed Hono version without requiring a particular
release.

Use the same Node.js release and frozen dependencies for all variants in a
comparison. Repeat the measurements with other Node releases as needed.
The existing Node 20.x, 22.x and 24.x CI matrix runs the compatibility tests
as part of the full suite, checking native serialization and fallback paths.

```sh
pnpm install --frozen-lockfile
node benchmarks/content-length/prepare.mjs 82ba34e6b19da49ca500d4cac95b5fb25ee48cc8
node benchmarks/content-length/run.mjs micro
node benchmarks/content-length/run.mjs pipeline
BENCH_BOMBARDIER=/path/to/bombardier node benchmarks/content-length/run.mjs http
node benchmarks/content-length/summarize.mjs benchmarks/content-length/.work/{micro,pipeline,http}-v*.jsonl
```

Run each measurement with the desired Node executable, sequentially on an idle
machine. Build preparation uses the current working tree for the candidate and
Git snapshots for the baseline/copy, without changing the checkout. Rebuild after
changing the candidate. Generated snapshots, bundles, metadata and results go in
`.work/`. Choose a new `BENCH_RESULTS` path when repeating a run; existing results are
never overwritten.
Preparation records the candidate commit, uncommitted source diff and bundle
hashes. Each result includes the commit and measured bundle hash so committed
and experimental candidates remain identifiable. The runner verifies these
hashes before timing and rejects missing or modified prepared variants, or a
Hono version changed since preparation.

To compare against a baseline that already uses native length, set
`BENCH_SKIP_COPY=1` for both preparation and measurement. This omits the
historical copy variant, which requires the original mutation implementation:

```sh
BENCH_SKIP_COPY=1 node benchmarks/content-length/prepare.mjs BASE_REF
BENCH_SKIP_COPY=1 node benchmarks/content-length/run.mjs pipeline
```

- `micro`: lightweight Response creation, native ServerResponse creation, cache
  handling and Node's real header serializer; `end()` is a no-op. Each process
  warms up for 300,000 iterations, then reports the median of five 200,000-iteration
  samples. Natural GC is included; forced GC is disabled by default because it
  can invalidate optimized code before a timed sample.
- `pipeline`: the same, including the incoming request adapter, Hono dispatch,
  context creation and `c.json()`/`c.text()`. Awaits each listener call so
  resolved Promise adoption jobs are included and do not accumulate between samples.
- `http`: real TCP keep-alive traffic using Bombardier v2.0.2, 64 connections,
  `GOMAXPROCS=2`, one second of warm-up and four seconds measured per process.
  Records the server's user + system CPU time as well as RPS. Client and server
  share the same machine. CPU timing includes client startup/shutdown boundaries.

Each mode defaults to five rounds and rotates variant order. `BENCH_ROUNDS` and
`BENCH_SECONDS` override those settings. HTTP cases are a small `c.json()` response,
JSON with seven additional headers, and `c.text()` with no custom headers as
controls. Pipeline and HTTP results record the actual header representation
before timing, without materializing `response.headers`. Ordinary `c.json()`
uses `Headers` in Hono 4.12.8 and a plain record in 4.13.8/4.13.9, so these versions
exercise different adapter paths. The `micro` cases exercise plain records
directly, independently of Hono's response construction. Summaries separate
results by Hono version and recorded header representation.
Validate response status/body before loading the endpoint; failures in load
generation are errors, not successful benchmark samples.

For nanoseconds lower is better; for RPS higher is better. The reported ranges
are observed run-to-run ranges, not confidence intervals. Microbenchmarks cannot
establish end-to-end throughput. Small RPS differences on a shared machine do
not establish either a speedup or an absence of regression.

The GC mode and warm-up count are recorded in each microbenchmark row.
`BENCH_GC=forced BENCH_WARMUP=100000` reproduces the original exploratory method;
use it only for comparison, since forced GC can invalidate optimized code.

For the one-variable-at-a-time investigation (after preparation):

```sh
ABLATION_NODE=/path/to/node node benchmarks/content-length/ablation.mjs
ABLATION_GC=natural ABLATION_NODE=/path/to/node node benchmarks/content-length/ablation.mjs
```

The first command reproduces the forced-GC experiment and compares isolated
`json8` with `json` followed by `json8`. The second measures both cases with
natural GC and longer warm-up. Both default to five process-level rounds and
refuse to overwrite previous output.

To compare cloning with property addition in isolation:

```sh
BENCH_RESULTS=/tmp/clone-cost.jsonl node benchmarks/content-length/clone-cost.mjs /path/to/node20 /path/to/node24
```
