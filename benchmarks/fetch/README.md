# Benchmark

Benchmark to compare performance between the published npm version and local development version of @hono/node-server.

This benchmark uses a basic Fetch API-based application without the Hono framework to measure the raw performance of @hono/node-server's adapter.

## Prerequisites

- Node.js
- [bombardier](https://github.com/codesenberg/bombardier) installation

## Usage

```bash
pnpm install
pnpm run -w build
pnpm run benchmark
```

## What's Being Tested

Tests four endpoints:

1. **Ping (GET /)**: Simple response
2. **Query (GET /id/:id)**: Path parameter and query parameter handling
3. **Body (POST /json)**: JSON body processing
4. **Headers (POST /headers)**: JSON body processing plus `request.headers.get()` and response-header creation

Each endpoint is tested with 500 concurrent connections for 10 seconds, measuring requests per second (Reqs/sec).

## Benchmark Environment

- **Machine**: Lenovo LOQ 15IRX9 (83DV)
- **CPU**: Intel Core i5-13450HX (10 cores, 16 threads)
- **Memory**: 24 GB
- **OS**: Arch Linux x86_64 (kernel 7.1.6)
- **Node.js**: 24.19.0

## Understanding Results

Last updated: 2026-08-08

```
| Benchmark         | npm            | dev            | Difference  |
| ----------------- | -------------- | -------------- | ----------- |
| Average           | 80,044.29      | 82,505.86      | +3.08%      |
| Ping (GET /)      | 96,506.07      | 96,795.17      | +0.30%      |
| Query (GET /id)   | 91,878.51      | 91,992.57      | +0.12%      |
| Body (POST /json) | 73,017.98      | 72,329.00      | -0.94%      |
| Headers (POST)    | 58,774.58      | 68,906.70      | +17.24%     |
```

- **npm**: Published npm version (`@hono/node-server`)
- **dev**: Local development version (from repository root `dist/`)
- **Difference**: Performance difference (positive values indicate improvement, negative values indicate regression)

## Reference

This benchmark setup is based on [bun-http-framework-benchmark](https://github.com/SaltyAom/bun-http-framework-benchmark) by @SaltyAom.
