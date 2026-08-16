# Fetch server benchmark

This suite measures the raw HTTP-to-Fetch adapter cost of the published and development versions of `@hono/node-server`. A native `node:http` implementation is the performance floor, while srvx with `FastResponse` is another Fetch-compatible adapter for comparison.

The benchmark intentionally avoids Hono routing so application-framework work does not obscure adapter work.

## Prerequisites

- Node.js
- [oha](https://github.com/hatoo/oha)

## Usage

```bash
pnpm install
pnpm run -w build
pnpm run benchmark
```

To replace the results below after a full successful run:

```bash
pnpm run benchmark --update
```

Quick smoke run:

```bash
BENCH_CONNECTIONS=10 BENCH_WARMUP=1s BENCH_DURATION=1s BENCH_TRIES=1 pnpm run benchmark
```

The defaults are 100 concurrent connections, a discarded two-second warmup, and the median of three five-second measurements. The server order is randomized to reduce systematic thermal or background-load bias.

## Scenarios

The suite validates every response before measuring it, rejects load-generator errors or unexpected status classes, and reports request rate, mean latency, response throughput, and isolated server peak RSS.

It covers:

1. A bodyless `204` response to `HEAD`
2. A small text response
3. URL and query-string parsing
4. Incoming header reads and outgoing headers
5. JSON serialization
6. JSON request parsing and response serialization
7. A 64 KiB request body
8. A fixed 64 KiB response body
9. A chunked `ReadableStream` response

These are synthetic microbenchmarks. They are useful for finding adapter regressions, not for predicting application throughput in production.

## Credits

The benchmark methodology and reporting are inspired by the [srvx Node.js compatibility benchmarks](https://github.com/h3js/srvx/tree/main/test/bench-node). The endpoint suite builds on ideas from [bun-http-framework-benchmark](https://github.com/SaltyAom/bun-http-framework-benchmark).

## Results

<!-- automd:bench -->

```text
CPU:        13th Gen Intel(R) Core(TM) i5-13450HX
Node.js:    v24.19.0
OS:         linux x64
OHA:        oha 1.15.0
Config:     100 connections, 2s warmup, 3 × 5s
```

### JSON round trip

| Rank | Server                  | Requests/sec | vs node:http |
| ---: | ----------------------- | -----------: | -----------: |
|    1 | node:http               |       81,818 |            — |
|    2 | srvx (fast)             |       74,833 |        -8.5% |
|    3 | @hono/node-server (dev) |       71,683 |       -12.4% |
|    4 | @hono/node-server (npm) |       70,050 |       -14.4% |

### All scenarios

| Scenario          | node:http | @hono/node-server (npm) |     srvx (fast) | @hono/node-server (dev) |
| ----------------- | --------: | ----------------------: | --------------: | ----------------------: |
| empty response    |   117,877 |        105,569 (-10.4%) | 108,464 (-8.0%) |        105,096 (-10.8%) |
| small text        |   107,385 |         95,037 (-11.5%) | 94,733 (-11.8%) |         93,184 (-13.2%) |
| URL + query       |   102,987 |         90,440 (-12.2%) | 90,044 (-12.6%) |         89,240 (-13.3%) |
| headers           |    96,469 |         75,109 (-22.1%) |  87,595 (-9.2%) |          87,909 (-8.9%) |
| JSON response     |    97,773 |          90,378 (-7.6%) |  91,174 (-6.8%) |          91,514 (-6.4%) |
| JSON round trip   |    81,818 |         70,050 (-14.4%) |  74,833 (-8.5%) |         71,683 (-12.4%) |
| 64 KiB upload     |    29,078 |         20,101 (-30.9%) | 12,812 (-55.9%) |         20,268 (-30.3%) |
| 64 KiB fixed body |    60,324 |          55,822 (-7.5%) |  56,836 (-5.8%) |          56,384 (-6.5%) |
| 64 KiB stream     |    46,091 |         31,166 (-32.4%) | 33,847 (-26.6%) |         30,866 (-33.0%) |
| peak RSS (MiB)    |     349.7 |                   364.4 |           330.7 |                   366.1 |

<!-- /automd -->
