const fs = require('node:fs');
const path = require('node:path');

const rootDir = path.resolve(__dirname, '..');
const releaseDir = path.join(rootDir, 'release');

const copies = [
  {
    continueWhenLocked: true,
    from: path.join(rootDir, '.venv-rubai'),
    optional: true,
    to: path.join(releaseDir, '.venv-rubai'),
  },
  {
    from: path.join(rootDir, 'scripts', 'rubai_worker.py'),
    to: path.join(releaseDir, 'scripts', 'rubai_worker.py'),
  },
];

function assertInsideRelease(targetPath) {
  const resolvedRelease = path.resolve(releaseDir);
  const resolvedTarget = path.resolve(targetPath);
  if (resolvedTarget !== resolvedRelease && !resolvedTarget.startsWith(`${resolvedRelease}${path.sep}`)) {
    throw new Error(`Refusing to write outside release directory: ${resolvedTarget}`);
  }
}

function isRecoverableWindowsLockError(error) {
  return error
    && typeof error === 'object'
    && ['EBUSY', 'ENOTEMPTY', 'EPERM'].includes(error.code);
}

function removeExistingTarget(targetPath) {
  try {
    fs.rmSync(targetPath, {
      force: true,
      maxRetries: 10,
      recursive: true,
      retryDelay: 250,
    });
    return true;
  } catch (error) {
    if (!isRecoverableWindowsLockError(error)) {
      throw error;
    }

    console.warn(`Could not fully clean ${targetPath} before copying. Continuing with overwrite mode.`, error.message);
    return false;
  }
}

for (const copy of copies) {
  if (!fs.existsSync(copy.from)) {
    if (copy.optional) {
      console.warn(`Optional portable runtime source is missing, skipping: ${copy.from}`);
      continue;
    }

    throw new Error(`Portable runtime source is missing: ${copy.from}`);
  }

  assertInsideRelease(copy.to);
  if (copy.continueWhenLocked && fs.existsSync(copy.to)) {
    console.warn(`Keeping existing runtime at ${copy.to}.`);
    continue;
  }

  const removedCleanly = removeExistingTarget(copy.to);
  if (!removedCleanly && copy.continueWhenLocked) {
    console.warn(`Keeping existing runtime at ${copy.to} because Windows is locking one or more files.`);
    continue;
  }

  fs.mkdirSync(path.dirname(copy.to), { recursive: true });
  fs.cpSync(copy.from, copy.to, { recursive: true, force: true });
}

console.log(`Prepared portable Rubai runtime in ${releaseDir}`);
