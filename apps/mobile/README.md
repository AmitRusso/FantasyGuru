# FantasyGuru mobile

Expo Router app: username in, your leagues out. See [`docs/build-plan.md`](../../docs/build-plan.md)
Stage 3 for the design.

## Before the first EAS build

- **`app.json`'s `android.package` is a placeholder** (`com.fantasyguru.app`). It must match
  whatever is reserved in Play Console exactly, and **cannot be changed after first upload**
  without creating a different app. Confirm the real value before running `eas build`.
- A 512×512 icon is a Play submission requirement, not a polish item — the current assets are
  Expo's default template placeholders.

## Local development

```bash
pnpm install
```

Copy `.env.example` to `.env` to point the app at a local API instance (defaults to the
deployed Fly service otherwise):

```bash
cp .env.example .env
```

```bash
pnpm web
```

```bash
pnpm android
```

```bash
pnpm ios
```

## Everyday commands

```bash
pnpm typecheck
```

Deliberately outside this repo's composite `tsc --build` graph — Expo's bundler-mode
`tsconfig` (no `"type": "module"`, `moduleResolution: "bundler"`) and the rest of the repo's
Node-oriented one disagree about module-ness, and mixing them is the wrong fix in either
direction (build-plan.md S3 §3.9). `pnpm typecheck` at the repo root runs this too.

## Metro and pnpm

`metro.config.js` sets `watchFolders` to the workspace root, which is required for Metro to
see `packages/contracts` at all. It deliberately does **not** set
`resolver.disableHierarchicalLookup` or extra `nodeModulesPaths` — both were tried while
building this app and both broke module resolution for `expo-router`'s own internal
dependencies. See the comment in `metro.config.js` for why, if this ever needs revisiting.

## The Sleeper deep-link probe

The cold-open screen has a dev-only ("Dev: probe Sleeper deep link") button, visible only in
`__DEV__`. It answers design-brief.md §4.2's open question — whether a `sleeper://` scheme
exists — and needs a physical Android device with Sleeper installed to mean anything. Record
the result in `docs/build-plan.md` Stage 3 §3.8 once run for real.
