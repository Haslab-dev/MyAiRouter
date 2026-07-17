---
name: myAiRouter Token Saving Instructions
description: Settings and instructions for Bolt (RTK), Headroom context pre-compression, Caveman terse response directives, and Ponytail lazy developer configurations.
---

# myAiRouter Token Saving

Includes several filters and injectors to minimize token volume and cost.

## bolt (RTK)

Intercepts console outputs and strips redundant headers:
- `ls`: formats listings compactly.
- `tree`: caps lines and drops empty glyph paths.
- `git diff`: truncates unified diffs to short edits.
- `grep`: trims matching wraps.

## headroom

Performs context compression check by calling `/v1/compress` on a headroom service.

## caveman & ponytail

Appends system guidelines that bias models toward shorter responses and minimal code architectures.
