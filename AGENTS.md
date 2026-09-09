# AGENTS.md

This file provides project guidance to Codex.

## Project

Homebridge plugin (`homebridge-kasa`) for TP-Link Kasa smart home devices. Supports three protocols: Legacy XOR (port 9999, via `tplink-smarthome-api`), KLAP v2, and AES (both port 80, implemented in `src/klap/`).

## Commands

```bash
pnpm run build         # Compile TypeScript (tsc)
pnpm run lint          # oxlint check
pnpm run check:write   # oxlint fixes + oxfmt
pnpm run format        # oxfmt format check
pnpm run typecheck     # Type check without emitting
pnpm run test          # Full check: lint + typecheck + vitest
pnpm run test:only     # Vitest only
```

Run a single test file:
```bash
pnpm vitest run test/config.spec.ts
```

Run tests matching a name pattern:
```bash
pnpm vitest run -t "parseConfig"
```

## Architecture

**Entry point:** `src/index.ts` registers the platform with Homebridge.

**TplinkSmarthomePlatform** (`src/platform.ts`) is the dynamic platform plugin. It runs two parallel discovery mechanisms:
- Legacy XOR discovery via `tplink-smarthome-api` Client (port 9999)
- KLAP/AES HTTP discovery via `KlapDiscovery` (`src/klap/discovery.ts`, port 80, requires Kasa credentials)

Both emit discovered devices to `foundDevice()`, which creates/restores HomeKit accessories.

**HomeKit device layer** (`src/homekit-device/`):
- `index.ts` - Abstract `HomekitDevice` base class managing services and characteristics
- `plug.ts` / `bulb.ts` - Concrete implementations for outlets/switches/dimmers and lights
- `create.ts` - Factory that picks the right class based on `deviceType`

**KLAP/AES protocol** (`src/klap/`):
- `adapter.ts` - `KlapPlug`/`KlapBulb` adapter classes that match the `tplink-smarthome-api` `Plug`/`Bulb` interface, so the HomeKit device layer can treat all devices uniformly
- `transport.ts` - KLAP v2 and AES transport implementations
- `crypto.ts` - Handshake and encryption
- `discovery.ts` - HTTP-based device discovery

**TplinkDevice** (`src/utils.ts`) is the union type `Bulb | Plug | KlapPlug | KlapBulb` used throughout.

**Config** (`src/config.ts`) validates user config with AJV against `config.schema.json`.

**Custom characteristics** (`src/characteristics/`) add Eve app energy monitoring (Watts, Volts, Amperes, etc.).

## Key Patterns

- Adapter pattern: KLAP devices wrap a different protocol but expose the same interface as legacy devices
- Event-driven: devices emit `power-update`, `lightstate-update`, `emeter-realtime-update` events consumed by HomeKit device classes
- `deferAndCombine` utility (`src/utils.ts`): batches rapid characteristic updates into single device commands

## Workflow

- Always work directly on `main` by default
- Prefer not to use worktrees unless isolation is necessary; always clean them up after

## Releases

When the user says "do a release":

1. Review commits since the last git tag (`git log $(git describe --tags --abbrev=0)..HEAD --oneline`)
2. Choose **patch** or **minor** version (default to patch; only minor for new features; never major unless explicitly asked)
3. Bump `version` in `package.json`
4. Commit with message: `chore: release vX.Y.Z`
5. Tag the commit: `git tag vX.Y.Z`
6. Push the commit and tag: `git push && git push --tags`
7. Create a GitHub Release: `gh release create vX.Y.Z --title "vX.Y.Z" --notes-file - <<< "notes"`
   - Group entries under `### Bug Fixes`, `### Features`, etc.
   - Keep it concise, focused on what changed and why

Tag format: `v{major}.{minor}.{patch}` (e.g., `v9.1.0`)

## Tooling

- **Package manager:** pnpm
- **TypeScript:** strict mode, ES2022 target, Node16 modules
- **Linter/formatter:** oxlint and oxfmt (project-local configuration)
- **Tests:** Vitest. Tests live in `test/`, integration tests in `test/integration/`
- **Build output:** `lib/` directory (compiled JS + declarations + source maps)
- **After any code changes**, run `pnpm run check:write` to auto-fix formatting/import ordering before running lint or typecheck

## mitools (`@micthiesen/mitools`)

Personal utility library used as both a build-time and runtime dependency. Prefer mitools utilities over writing custom helpers when a good fit exists. Check what's available at `../mitools/src/` before reinventing. Good candidates: async patterns (retry, timeout, sleep, Result type), collection helpers (DefaultMap, BetterMap), and similar general-purpose utilities. Don't force usage where the built-in or existing code is already clear and concise.

## Error Handling Preferences

- Prefer `withRetry` from mitools for retry-with-backoff patterns. Use `shouldRetry` to scope retries to specific error types and `baseDelayMs: 0` when immediate retry is appropriate (e.g. re-handshake then retry).
- Prefer `tryCatch` / `Result` from mitools when a function tries multiple fallback strategies (try A, fall back to B). This makes "expected failure" paths visually distinct from unexpected errors, avoiding bare `catch {}` blocks.
- Use `withTimeout` from mitools to cap operation-level time on composed async work (e.g. a probe that makes several sequential HTTP requests), not just individual requests.
