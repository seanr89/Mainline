#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

const PATHS = {
  packageJson: path.join(ROOT_DIR, 'package.json'),
  tauriConf: path.join(ROOT_DIR, 'src-tauri', 'tauri.conf.json'),
  cargoToml: path.join(ROOT_DIR, 'src-tauri', 'Cargo.toml'),
  cargoLock: path.join(ROOT_DIR, 'src-tauri', 'Cargo.lock'),
  changelog: path.join(ROOT_DIR, 'CHANGELOG.md'),
};

const SEMVER_RE = /^(\d+)\.(\d+)\.(\d+)$/;
const CONVENTIONAL_RE = /^([a-zA-Z]+)(?:\(([^)]+)\))?(!)?:\s*(.+)$/;
const CATEGORY_ORDER = [
  'Features',
  'Bug Fixes',
  'Performance',
  'Maintenance & Docs',
  'Other Changes',
];

function parseArgs(argv) {
  const opts = {
    bump: null,
    version: null,
    dryRun: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--dry-run') {
      opts.dryRun = true;
    } else if (arg === '--bump') {
      opts.bump = argv[++i] ?? null;
    } else if (arg.startsWith('--bump=')) {
      opts.bump = arg.slice('--bump='.length);
    } else if (arg === '--version') {
      opts.version = argv[++i] ?? null;
    } else if (arg.startsWith('--version=')) {
      opts.version = arg.slice('--version='.length);
    } else if (arg === '--help' || arg === '-h') {
      console.log(
        'Usage: node scripts/bump-version.mjs [--bump patch|minor|major] [--version X.Y.Z] [--dry-run]'
      );
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (opts.bump && !['patch', 'minor', 'major'].includes(opts.bump)) {
    throw new Error(`Invalid --bump value "${opts.bump}". Expected patch, minor, or major.`);
  }
  if (opts.version && !SEMVER_RE.test(opts.version)) {
    throw new Error(`Invalid --version value "${opts.version}". Expected X.Y.Z SemVer.`);
  }

  return opts;
}

function runGit(args, allowFailure = false) {
  try {
    return execFileSync('git', args, {
      cwd: ROOT_DIR,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  } catch (err) {
    if (allowFailure) return null;
    const stderr = err && typeof err === 'object' && 'stderr' in err ? String(err.stderr) : '';
    throw new Error(`git ${args.join(' ')} failed: ${stderr || err}`);
  }
}

function resolveCommitRange() {
  const lastTag = runGit(['describe', '--tags', '--abbrev=0', '--match', 'v*'], true);
  if (lastTag) {
    return { range: `${lastTag}..HEAD`, baseRef: lastTag };
  }

  const hasSecondParent = runGit(['rev-parse', '--verify', 'HEAD^2'], true);
  if (hasSecondParent) {
    return { range: 'HEAD^1..HEAD', baseRef: 'HEAD^1' };
  }

  const hasPrev = runGit(['rev-parse', '--verify', 'HEAD~1'], true);
  if (hasPrev) {
    return { range: 'HEAD~1..HEAD', baseRef: 'HEAD~1' };
  }

  return { range: 'HEAD', baseRef: null };
}

function parseGitLog(range, noMerges) {
  const args = ['log', range];
  if (noMerges) args.push('--no-merges');
  args.push('--format=%H%x1f%h%x1f%s%x1f%b%x1e');

  const raw = runGit(args, true);
  if (!raw) return [];

  return raw
    .split('\x1e')
    .map((record) => record.trim())
    .filter(Boolean)
    .map((record) => {
      const [hash = '', shortHash = '', subject = '', body = ''] = record.split('\x1f');
      return {
        hash: hash.trim(),
        shortHash: shortHash.trim(),
        subject: subject.trim(),
        body: body.trim(),
      };
    })
    .filter((c) => {
      if (!c.subject) return false;
      if (c.subject.startsWith('chore(release):')) return false;
      if (c.subject.includes('[skip ci]')) return false;
      return true;
    });
}

function collectCommits(range) {
  const direct = parseGitLog(range, true);
  if (direct.length > 0) return direct;
  return parseGitLog(range, false);
}

function detectBumpLevel(commits) {
  let level = 'patch';

  for (const commit of commits) {
    if (
      commit.body.includes('BREAKING CHANGE') ||
      commit.subject.includes('BREAKING CHANGE')
    ) {
      return 'major';
    }

    const match = CONVENTIONAL_RE.exec(commit.subject);
    if (match) {
      const [, type, , breaking] = match;
      if (breaking === '!') {
        return 'major';
      }
      if (type.toLowerCase() === 'feat') {
        level = 'minor';
      }
    }
  }

  return level;
}

function incrementSemver(current, level) {
  const match = SEMVER_RE.exec(current);
  if (!match) {
    throw new Error(`Current version "${current}" is not valid X.Y.Z SemVer.`);
  }
  const major = Number(match[1]);
  const minor = Number(match[2]);
  const patch = Number(match[3]);

  switch (level) {
    case 'major':
      return `${major + 1}.0.0`;
    case 'minor':
      return `${major}.${minor + 1}.0`;
    case 'patch':
      return `${major}.${minor}.${patch + 1}`;
    default:
      throw new Error(`Unsupported bump level: ${level}`);
  }
}

function mapCategory(type) {
  switch (type.toLowerCase()) {
    case 'feat':
      return 'Features';
    case 'fix':
      return 'Bug Fixes';
    case 'perf':
      return 'Performance';
    case 'chore':
    case 'docs':
    case 'build':
    case 'ci':
    case 'refactor':
    case 'style':
    case 'test':
      return 'Maintenance & Docs';
    default:
      return 'Other Changes';
  }
}

function formatReleaseNotes(commits, nextVersion, dateStr) {
  const grouped = new Map(CATEGORY_ORDER.map((cat) => [cat, []]));

  for (const commit of commits) {
    const match = CONVENTIONAL_RE.exec(commit.subject);
    const isBreaking =
      commit.body.includes('BREAKING CHANGE') ||
      commit.subject.includes('BREAKING CHANGE') ||
      Boolean(match && match[3] === '!');
    const breakingPrefix = isBreaking ? '**BREAKING:** ' : '';

    if (match) {
      const [, type, scope, , desc] = match;
      const category = mapCategory(type);
      const scopePrefix = scope ? `**${scope}**: ` : '';
      grouped
        .get(category)
        .push(`- ${breakingPrefix}${scopePrefix}${desc} (${commit.shortHash})`);
    } else {
      grouped
        .get('Other Changes')
        .push(`- ${breakingPrefix}${commit.subject} (${commit.shortHash})`);
    }
  }

  const totalItems = Array.from(grouped.values()).reduce((sum, items) => sum + items.length, 0);
  if (totalItems === 0) {
    const headShort = runGit(['rev-parse', '--short', 'HEAD'], true) || 'HEAD';
    grouped.get('Maintenance & Docs').push(`- Automated version release (${headShort})`);
  }

  const lines = [`## [${nextVersion}] - ${dateStr}`, ''];
  for (const category of CATEGORY_ORDER) {
    const items = grouped.get(category);
    if (!items || items.length === 0) continue;
    lines.push(`### ${category}`);
    lines.push(...items);
    lines.push('');
  }

  return lines.join('\n').trimEnd() + '\n';
}

function updateJsonVersion(filePath, nextVersion) {
  const raw = fs.readFileSync(filePath, 'utf8');
  const parsed = JSON.parse(raw);
  parsed.version = nextVersion;
  return `${JSON.stringify(parsed, null, 2)}\n`;
}

function updateCargoTomlVersion(filePath, nextVersion) {
  const raw = fs.readFileSync(filePath, 'utf8');
  const pkgIdx = raw.indexOf('[package]');
  if (pkgIdx === -1) {
    throw new Error(`Could not find [package] section in ${filePath}`);
  }

  const afterPkg = raw.slice(pkgIdx);
  const nextSectionMatch = /\r?\n\[[^\]]+\]/.exec(afterPkg.slice('[package]'.length));
  const pkgEnd = nextSectionMatch
    ? pkgIdx + '[package]'.length + nextSectionMatch.index
    : raw.length;

  const pkgBlock = raw.slice(pkgIdx, pkgEnd);
  const versionRe = /^(version\s*=\s*")[^"]+(")/m;
  if (!versionRe.test(pkgBlock)) {
    throw new Error(`Could not find version field in [package] section of ${filePath}`);
  }

  const updatedBlock = pkgBlock.replace(versionRe, `$1${nextVersion}$2`);
  return raw.slice(0, pkgIdx) + updatedBlock + raw.slice(pkgEnd);
}

function updateCargoLockVersion(filePath, nextVersion) {
  const raw = fs.readFileSync(filePath, 'utf8');
  const lockRe =
    /(^\[\[package\]\]\r?\nname\s*=\s*"git-workspace-manager"\r?\nversion\s*=\s*")[^"]+(")/m;
  if (!lockRe.test(raw)) {
    throw new Error(`Could not find git-workspace-manager package version in ${filePath}`);
  }
  return raw.replace(lockRe, `$1${nextVersion}$2`);
}

function updateChangelogContent(filePath, releaseBlock, nextVersion) {
  const existing = fs.existsSync(filePath)
    ? fs.readFileSync(filePath, 'utf8')
    : '# Changelog\n\nAll notable changes to **Mainline** will be documented in this file.\n';

  if (existing.includes(`## [${nextVersion}]`)) {
    throw new Error(`CHANGELOG.md already contains an entry for version ${nextVersion}.`);
  }

  const firstReleaseIdx = existing.search(/^## \[/m);
  if (firstReleaseIdx === -1) {
    const trimmed = existing.trimEnd();
    return `${trimmed}\n\n${releaseBlock}`;
  }

  const header = existing.slice(0, firstReleaseIdx).trimEnd();
  const rest = existing.slice(firstReleaseIdx).replace(/^\n+/, '');
  return `${header}\n\n${releaseBlock}\n${rest}`;
}

function writeGitHubOutput(values) {
  const outputPath = process.env.GITHUB_OUTPUT;
  if (!outputPath) return;
  const lines = Object.entries(values).map(([k, v]) => `${k}=${v}`);
  fs.appendFileSync(outputPath, `${lines.join('\n')}\n`, 'utf8');
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const pkg = JSON.parse(fs.readFileSync(PATHS.packageJson, 'utf8'));
  const currentVersion = pkg.version;

  const { range, baseRef } = resolveCommitRange();
  const commits = collectCommits(range);

  if (commits.length === 0 && !opts.bump && !opts.version && !opts.dryRun) {
    console.log(`No new non-release commits found in range "${range}". Skipping version bump.`);
    writeGitHubOutput({ bumped: 'false', version: currentVersion, tag: `v${currentVersion}` });
    return;
  }

  const bumpLevel = opts.bump ?? detectBumpLevel(commits);
  const nextVersion = opts.version ?? incrementSemver(currentVersion, bumpLevel);
  const dateStr = new Date().toISOString().slice(0, 10);
  const releaseBlock = formatReleaseNotes(commits, nextVersion, dateStr);

  const nextPkg = updateJsonVersion(PATHS.packageJson, nextVersion);
  const nextTauriConf = updateJsonVersion(PATHS.tauriConf, nextVersion);
  const nextCargoToml = updateCargoTomlVersion(PATHS.cargoToml, nextVersion);
  const nextCargoLock = updateCargoLockVersion(PATHS.cargoLock, nextVersion);
  const nextChangelog = updateChangelogContent(PATHS.changelog, releaseBlock, nextVersion);

  console.log(`Current version : ${currentVersion}`);
  console.log(`Commit range    : ${range}${baseRef ? '' : ' (initial)'}`);
  console.log(`Commits matched : ${commits.length}`);
  console.log(`Bump level      : ${opts.version ? 'explicit' : bumpLevel}`);
  console.log(`Next version    : ${nextVersion}`);
  console.log(`Tag             : v${nextVersion}`);
  console.log('');
  console.log('--- Generated Changelog Entry ---');
  console.log(releaseBlock.trimEnd());
  console.log('---------------------------------');

  if (opts.dryRun) {
    console.log('[dry-run] No files modified.');
    return;
  }

  fs.writeFileSync(PATHS.packageJson, nextPkg, 'utf8');
  fs.writeFileSync(PATHS.tauriConf, nextTauriConf, 'utf8');
  fs.writeFileSync(PATHS.cargoToml, nextCargoToml, 'utf8');
  fs.writeFileSync(PATHS.cargoLock, nextCargoLock, 'utf8');
  fs.writeFileSync(PATHS.changelog, nextChangelog, 'utf8');

  writeGitHubOutput({
    bumped: 'true',
    version: nextVersion,
    tag: `v${nextVersion}`,
  });

  console.log(
    'Updated package.json, src-tauri/tauri.conf.json, src-tauri/Cargo.toml, src-tauri/Cargo.lock, and CHANGELOG.md.'
  );
}

main();
