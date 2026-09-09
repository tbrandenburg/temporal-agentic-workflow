# Phase 4 fixture repository

A tiny, dependency-free Node project used as the target of the deterministic
validation gate (`validatePatch`, PLAN §7). It is **not** a pnpm workspace
member and is **not** a real `.git` repository on disk — `agent-tools`'
`workspace.ts` copies this directory into an ephemeral temp dir and runs
`git init` + an initial commit there, so every validation run starts from an
identical, disposable git history without nesting a `.git` inside this repo.
