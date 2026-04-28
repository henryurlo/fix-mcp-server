---
name: Help wanted: live demo deployment
about: Track the public read-only dashboard deployment.
title: "Help wanted: live demo deployment"
labels: help wanted, deployment
---

## Goal

Deploy a public read-only FIX-MCP dashboard so reviewers can understand the product without installing Docker first.

## Requirements

- No write access to external trading systems.
- Demo mode enabled by default.
- Preloaded scenarios available from the incident catalog.
- Copilot panel clearly marked as simulated unless an operator provides an API key.
- Resettable state between visitors.

## Candidate Targets

- Fly.io
- Render
- Railway
- Cloudflare Pages plus hosted API
