import { resolve, sep } from 'node:path';

function normalizePathForComparison(filePath: string): string {
  const resolvedPath = resolve(filePath);
  return process.platform === 'win32' ? resolvedPath.toLowerCase() : resolvedPath;
}

export function assertPathInsideBaseFolder(targetPath: string, basePath: string, errorMessage: string): string {
  const resolvedTarget = resolve(targetPath);
  const resolvedBase = resolve(basePath);
  const comparisonTarget = normalizePathForComparison(resolvedTarget);
  const comparisonBase = normalizePathForComparison(resolvedBase);
  const basePrefix = comparisonBase.endsWith(sep) ? comparisonBase : `${comparisonBase}${sep}`;

  if (comparisonTarget !== comparisonBase && !comparisonTarget.startsWith(basePrefix)) {
    throw new Error(errorMessage);
  }

  return resolvedTarget;
}
