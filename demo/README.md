# Remotion Demo

This folder contains a Remotion project scaffold for the FIX MCP walkthrough.

## Intended render flow

1. Detect the ARCA outage and sequence gap
2. Recover the session with `ResendRequest`
3. Route a replacement order to NYSE
4. Surface the ACME to ACMX corporate-action warning
5. Load an IPO symbol and release blocked orders
6. Close on the pre-market summary dashboard

## Expected commands

Once Node.js is available:

```bash
npm install
npm run dev
npm run render
```

The default output target is `out/fix-mcp-demo.mp4`.
