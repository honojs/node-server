# Benchmark

Benchmark comparing the published npm version and local development version of @hono/node-server with srvx.

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
| Benchmark         | @hono/node-server (2.1.0) | srvx (0.12.5, fast) | @hono/node-server (dev) | dev vs npm | dev vs srvx |
| ----------------- | ------------------------- | ------------------- | ----------------------- | ---------- | ----------- |
| Average           | 83,588.79                 | 89,245.89           | 88,398.73               | +5.75%     | -0.95%      |
| Ping (GET /)      | 87,502.45                 | 97,875.62           | 96,320.69               | +10.08%    | -1.59%      |
| Query (GET /id)   | 92,967.16                 | 89,524.22           | 93,474.95               | +0.55%     | +4.41%      |
| Body (POST /json) | 72,621.78                 | 75,968.80           | 73,823.52               | +1.65%     | -2.82%      |
| Headers (GET)     | 81,263.78                 | 93,614.90           | 89,975.77               | +10.72%    | -3.89%      |
```

- **@hono/node-server (2.1.0)**: Published npm version
- **@hono/node-server (dev)**: Local development version (from repository root `dist/`)
- **srvx (0.12.5, fast)**: Published npm version using its opt-in `FastResponse`
- **dev vs npm**: Development Hono compared with published Hono
- **dev vs srvx**: Development Hono compared with srvx

## Reference

This benchmark setup is based on [bun-http-framework-benchmark](https://github.com/SaltyAom/bun-http-framework-benchmark) by @SaltyAom.
