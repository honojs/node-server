# Benchmark

Benchmark to compare performance between the published npm version and local development version of @hono/node-server.

This benchmark uses a basic Fetch API-based application without the Hono framework to measure the raw performance of @hono/node-server's adapter.

## Prerequisites

- Node.js
- [bombardier](https://github.com/codesenberg/bombardier) installation

## Usage

```bash
npm install
npm run benchmark
```

## What's Being Tested

Tests three endpoints:

1. **Ping (GET /)**: Simple response
2. **Query (GET /id/:id)**: Path parameter and query parameter handling
3. **Body (POST /json)**: JSON body processing

Each endpoint is tested with 500 concurrent connections for 10 seconds, measuring requests per second (Reqs/sec).

## Understanding Results

```
| Benchmark         | npm            | dev            | Difference  |
| ----------------- | -------------- | -------------- | ----------- |
| Average           | 111,514.97     | 115,234.56     | +3.34%      |
| Ping (GET /)      | 122,207.70     | 125,678.90     | +2.84%      |
| Query (GET /id)   | 106,624.16     | 110,123.45     | +3.28%      |
| Body (POST /json) | 105,713.04     | 109,901.23     | +3.96%      |
```

- **npm**: Published npm version (`@hono/node-server`)
- **dev**: Local development version (from repository root `dist/`)
- **Difference**: Performance difference (positive values indicate improvement, negative values indicate regression)

## Reference

This benchmark setup is based on [bun-http-framework-benchmark](https://github.com/SaltyAom/bun-http-framework-benchmark) by @SaltyAom.
