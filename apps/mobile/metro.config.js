// Metro config for the Yaadora monorepo (Expo SDK 54 + Bun workspaces).
// Without this, Metro's hierarchical lookup can resolve a SECOND copy of React
// (packages/ui pulls 19.2.x) and the app + RN renderer end up on different
// Reacts → "Invalid hook call". We watch the workspace, order resolution
// project-first, and pin react/react-native to the app's own copy.
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];
// NOTE: do NOT disableHierarchicalLookup here — Bun's isolated linker (.bun
// store) relies on walking up to resolve nested deps like @expo/metro-runtime.

// Force a SINGLE instance of React / React Native. extraNodeModules is only a
// fallback; Bun's isolated linker still gives react-native its own react copy,
// so we hard-redirect every react / react-native import (and their subpaths) to
// the app's copy via resolveRequest.
const singletons = {
  react: path.resolve(projectRoot, 'node_modules/react'),
  'react-native': path.resolve(projectRoot, 'node_modules/react-native'),
};

const defaultResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  for (const [name, dir] of Object.entries(singletons)) {
    if (moduleName === name || moduleName.startsWith(name + '/')) {
      const rest = moduleName.slice(name.length); // '' or '/sub/path'
      return context.resolveRequest(
        context,
        rest ? path.join(dir, rest) : dir,
        platform,
      );
    }
  }
  return defaultResolveRequest
    ? defaultResolveRequest(context, moduleName, platform)
    : context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
