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
4. **Headers (GET /headers)**: Isolated `request.headers.get()` access

Each endpoint is tested with 500 concurrent connections for 10 seconds, measuring requests per second (Reqs/sec).

## Benchmark Environment

- **Machine**: Lenovo LOQ 15IRX9 (83DV)
- **CPU**: Intel Core i5-13450HX (10 cores, 16 threads)
- **Memory**: 24 GB
- **OS**: Arch Linux x86_64 (kernel 7.1.6)
- **Node.js**: 24.19.0

## Understanding Results

Last updated: 2026-08-09

```
| Benchmark         | npm            | dev            | Difference  |
| ----------------- | -------------- | -------------- | ----------- |
| Average           | 85,426.86      | 89,117.13      | +4.32%      |
| Ping (GET /)      | 95,338.29      | 97,649.91      | +2.42%      |
| Query (GET /id)   | 91,903.68      | 92,684.33      | +0.85%      |
| Body (POST /json) | 72,924.22      | 73,512.40      | +0.81%      |
| Headers (GET)     | 81,541.25      | 92,621.86      | +13.59%     |
```

- **npm**: Published npm version (`@hono/node-server`)
- **dev**: Local development version (from repository root `dist/`)
- **Difference**: Performance difference (positive values indicate improvement, negative values indicate regression)

## Reference

This benchmark setup is based on [bun-http-framework-benchmark](https://github.com/SaltyAom/bun-http-framework-benchmark) by @SaltyAom.
