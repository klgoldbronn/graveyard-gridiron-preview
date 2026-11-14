# ARCHIVE — state of this repo when shelved

- **Shelved:** Nov 14, 2026, under the donor & archive policy (game-kit ADR-002).
- **What this is:** the PUBLIC playtest mirror of the private repo `klgoldbronn/graveyard-gridiron`. It exists because the game itself lives in a private repo and GitHub Pages needs a public one. It contains only the playable build files (index + src) — no spec, no tests.
- **State:** `main` @ 6e04e7d = the private repo's `feature-v1-build` @ 12de5d1 (v1.1: Legacy Gold meta-progression, massacre run-end, Comeback Floor; Tuning Pass 1 included).
- **Live at:** https://klgoldbronn.github.io/graveyard-gridiron-preview/
- **Kurt's standing ruling:** this repo can be deleted once the playtest era is over. Nothing unique lives here — the private repo is the source of truth.
- **How to resume / refresh:** in the private repo, check out `feature-v1-build`, copy its build files over this repo's `main`, push; Pages redeploys automatically.
