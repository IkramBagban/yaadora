// Metro config for the Yaadora monorepo (Expo SDK 54 + Bun workspaces).
// Without this, Metro's hierarchical lookup can resolve a SECOND copy of React
// (packages/ui pulls 19.2.x) and the app + RN renderer end up on different
// Reacts → "Invalid hook call". We watch the workspace, order resolution
// project-first, and pin react/react-native to the app's own copy.
//
// IMPORTANT: deep imports like `react-native/Libraries/Core/InitializeCore`
// must resolve via Node's require.resolve against the app package, NOT via
// path.join + re-resolve (absolute paths + Bun's .bun layout break on EAS).
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');
const fs = require('fs');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];
// NOTE: do NOT disableHierarchicalLookup — Bun's isolated linker (.bun store)
// relies on walking up to resolve nested deps like @expo/metro-runtime.

/**
 * Resolve a package (or subpath) from the mobile app's dependency tree.
 * Follows Bun/npm symlinks so Libraries/* files are found on EAS too.
 */
function resolveFromApp(moduleName) {
  return require.resolve(moduleName, { paths: [projectRoot] });
}

/** True if this import must be forced onto the app's single react / RN copy. */
function isSingletonModule(moduleName) {
  return (
    moduleName === 'react' ||
    moduleName === 'react-native' ||
    moduleName.startsWith('react/') ||
    moduleName.startsWith('react-native/')
  );
}

const defaultResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (isSingletonModule(moduleName)) {
    try {
      const filePath = resolveFromApp(moduleName);
      // Prefer realpath so Metro opens the file under .bun store, not a
      // broken symlink in a partial node_modules layout.
      const realPath = fs.existsSync(filePath)
        ? fs.realpathSync(filePath)
        : filePath;
      return { type: 'sourceFile', filePath: realPath };
    } catch {
      // Fall through to default Metro resolution.
    }
  }

  if (defaultResolveRequest) {
    return defaultResolveRequest(context, moduleName, platform);
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
