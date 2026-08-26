const { getDefaultConfig } = require('expo/metro-config');
const { withNativeWind } = require('nativewind/metro');
const path = require('path');

/**
 * Workspace-aware Metro config (build-plan.md S3 Decision 1).
 *
 * `apps/mobile` imports `@fantasyguru/contracts`, a workspace package. pnpm links it directly
 * into `apps/mobile/node_modules/@fantasyguru/contracts` as a symlink to the real package
 * directory under `packages/contracts` -- so Metro's DEFAULT per-file hierarchical resolution
 * (which walks up from each importing file, same as Node's own algorithm) already finds it
 * correctly with no extra resolver config. The one thing that default does NOT cover is
 * Metro's file WATCHER: `packages/contracts`'s real files live outside `apps/mobile`'s own
 * directory tree, so `watchFolders` has to name the workspace root explicitly or Metro never
 * notices that directory exists to crawl and bundle through the symlink.
 *
 * Do NOT add `disableHierarchicalLookup: true` here, and do not add extra
 * `resolver.nodeModulesPaths` entries -- both were tried and both broke the build. pnpm's
 * strict, non-flat layout puts a package's OWN transitive dependencies inside that package's
 * private `node_modules/.pnpm/<pkg>/node_modules/` scope (e.g. `expo-router` importing its
 * own `@expo/metro-runtime`), and that is exactly what Metro's default hierarchical walk-up
 * is built to find, the same way Node's resolver finds it. Disabling that lookup to add a
 * flat list of extra search paths is the right fix for npm/Yarn's HOISTED trees -- most
 * Expo-monorepo guides assume one of those -- and actively wrong for pnpm's un-hoisted one:
 * it breaks precisely the per-package scoping pnpm exists to enforce. Confirmed by running
 * the actual dev server: with both settings, `expo-router`'s internal import of
 * `@expo/metro-runtime` failed to resolve; removing them fixed it immediately.
 */

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

config.watchFolders = [workspaceRoot];

module.exports = withNativeWind(config, { input: './global.css' });
