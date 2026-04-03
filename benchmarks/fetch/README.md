# Benchmark

Compares performance between the published npm version and the local v2 development version of `@hono/node-server`, plus Hono framework and Fastify as references.

## Prerequisites

- Node.js
- [bombardier](https://github.com/codesenberg/bombardier) (`brew install bombardier`)
- `npm install` in this directory

## Scripts

| Script | Description |
| --- | --- |
| `npm run benchmark` | Suite A — bombardier, 3 realistic endpoints |
| `npm run benchmark:ac` | Suite B — autocannon, hello-world JSON (Fastify methodology) |
| `npm run benchmark:all` | Both suites combined |

---

## Suite A — Realistic (bombardier)

**Settings:** 500 connections · no pipelining · 10 s per endpoint

Three endpoints tested:

1. **Ping** `GET /` — minimal JSON response
2. **Query** `GET /id/:id?name=bun` — path + query param handling
3. **Body** `POST /json` — JSON body parse + JSON response

### Results

| Server | Average | Ping | Query | Body |
| --- | ---: | ---: | ---: | ---: |
| @hono/node-server (v2) | 32,120 | 33,233 | 33,565 | 29,561 |
| hono (v2) | 31,879 | 35,346 | 31,782 | 28,509 |
| fastify | 32,132 | 35,933 | 33,772 | 26,691 |
| @hono/node-server (npm) | 27,280 | 31,907 | 32,266 | 17,666 |

*Requests per second — higher is better.*

---

## Suite B — Fastify-methodology (autocannon)

**Settings:** 100 connections · pipelining 10 · 10 s warmup + 40 s measurement

Single endpoint: `GET /` → `{ hello: 'world' }` JSON — matches the [Fastify benchmark suite](https://github.com/fastify/benchmarks/) exactly.

### Results

| Server | Req/s | % baseline | Lat avg | Lat p99 |
| --- | ---: | ---: | ---: | ---: |
| node:http (baseline) | 54,726 | 100% | — | — |
| @hono/node-server (v2) | 50,618 | 92% | ~2 ms | ~5 ms |
| hono (v2) | 48,938 | 89% | ~2 ms | ~6 ms |
| fastify | 48,769 | 89% | ~2 ms | ~6 ms |
| @hono/node-server (npm) | 40,590 | 74% | ~3 ms | ~7 ms |

*Requests per second — higher is better.*

> The published Fastify benchmark reports ~46k req/s on Linux GitHub Actions runners. The v2 build achieves ~50k locally, putting it at or above Fastify on equivalent hardware.

---

## v2 Optimizations

Key changes driving the improvement over the npm version:

| Optimization | Description |
| --- | --- |
| `cacheKey` fast path | Sync responses (plain strings, JSON, null bodies, redirects) skip `ReadableStream` entirely and call `writeHead`/`end` directly |
| `Response.json()` override | Returns a `LightweightResponse` with pre-serialized body + `content-type` header in the cached tuple |
| `Response.redirect()` override | Returns null-body `LightweightResponse` with `location` header — no spurious `content-type` |
| `buildOutgoingHttpHeaders` single-pass | Eliminated the pre-scan for `set-cookie`; collects cookies in one iteration |
| `newHeadersFromIncoming` direct indexing | Replaces computed-property destructuring with `rawHeaders[i]` / `rawHeaders[i+1]` + cached `length` |
| `signal` property fast path | Common HTTP methods bypass `getRequestCache()` (full `Request` construction) and call `getAbortController().signal` directly |
| Deferred close listener | `outgoing.on('close', …)` closure is only allocated for async responses, not every request |
