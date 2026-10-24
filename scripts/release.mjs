// Release helpers. All packages share one version.
//
//   node scripts/release.mjs version <version>   sets the version of every package
//   node scripts/release.mjs check <tag>         checks a tag against the packages and changelog
//   node scripts/release.mjs notes <version>     prints the changelog section of a version
//   node scripts/release.mjs publish             publishes the packages not on npm yet
import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const PACKAGES = ['core', 'vue', 'react'];
const SCOPE = '@kumochart-sdk/';
const VERSION = /^\d+\.\d+\.\d+(-[0-9A-Za-z.]+)?$/;

function fail(message) {
  console.error(message);
  process.exit(1);
}

async function readJson(path) {
  return JSON.parse(await readFile(join(root, path), 'utf8'));
}

async function writeJson(path, value) {
  await writeFile(join(root, path), `${JSON.stringify(value, null, 2)}\n`);
}

/** Points every dependency on a package of the workspace at `version`. */
function pinWorkspace(dependencies, version) {
  for (const name of Object.keys(dependencies ?? {})) {
    if (name.startsWith(SCOPE)) {
      dependencies[name] = version;
    }
  }
}

async function setVersion(version) {
  if (!VERSION.test(version ?? '')) {
    fail(`"${version}" is not a version such as 0.3.0 or 0.3.0-beta.1.`);
  }

  for (const name of PACKAGES) {
    const path = `packages/${name}/package.json`;
    const manifest = await readJson(path);
    manifest.version = version;
    pinWorkspace(manifest.peerDependencies, version);
    pinWorkspace(manifest.dependencies, version);
    await writeJson(path, manifest);
  }

  // The examples and the documentation site build on the packages of the workspace.
  for (const path of ['examples/package.json', 'site/package.json']) {
    const manifest = await readJson(path);
    pinWorkspace(manifest.dependencies, version);
    await writeJson(path, manifest);
  }

  execFileSync('npm', ['install', '--package-lock-only', '--ignore-scripts'], {
    cwd: root,
    stdio: 'inherit'
  });
  console.log(`Every package is at ${version}. Update the changelog and the README badge.`);
}

/** The changelog section of `version`, without its heading. */
async function notes(version) {
  const changelog = await readFile(join(root, 'CHANGELOG.md'), 'utf8');
  const heading = `## ${version}\n`;
  const start = changelog.indexOf(heading);

  if (start < 0) {
    fail(`CHANGELOG.md has no "## ${version}" section.`);
  }

  const rest = changelog.slice(start + heading.length);
  const end = rest.search(/^## /m);
  return (end < 0 ? rest : rest.slice(0, end)).trim();
}

async function check(tag) {
  const version = (tag ?? '').replace(/^v/, '');

  if (!VERSION.test(version) || tag !== `v${version}`) {
    fail(`"${tag}" is not a release tag such as v0.3.0.`);
  }

  for (const name of PACKAGES) {
    const manifest = await readJson(`packages/${name}/package.json`);
    const peers = Object.entries(manifest.peerDependencies ?? {}).filter(([peer]) =>
      peer.startsWith(SCOPE)
    );

    if (manifest.version !== version) {
      fail(`${manifest.name} is at ${manifest.version}, not ${version}.`);
    }

    for (const [peer, range] of peers) {
      if (range !== version) {
        fail(`${manifest.name} needs ${peer}@${range}, not ${version}.`);
      }
    }
  }

  await notes(version);
  console.log(`${tag} matches every package and has release notes.`);
}

/** Publishes every package whose version is not on npm yet, so a failed run can be repeated. */
async function publish() {
  for (const name of PACKAGES) {
    const manifest = await readJson(`packages/${name}/package.json`);
    const spec = `${manifest.name}@${manifest.version}`;
    let published = false;

    try {
      published =
        execFileSync('npm', ['view', spec, 'version'], { encoding: 'utf8' }).trim() ===
        manifest.version;
    } catch {
      // npm view fails for versions (and packages) that do not exist yet.
    }

    if (published) {
      console.log(`${spec} is already published.`);
      continue;
    }

    // Prereleases are published as `latest` too: the project keeps a single dist-tag.
    execFileSync('npm', ['publish', '--workspace', `packages/${name}`, '--tag', 'latest'], {
      cwd: root,
      stdio: 'inherit'
    });
  }
}

const [command, argument] = process.argv.slice(2);

switch (command) {
  case 'version':
    await setVersion(argument);
    break;
  case 'check':
    await check(argument);
    break;
  case 'notes':
    console.log(await notes(argument));
    break;
  case 'publish':
    await publish();
    break;
  default:
    fail(
      'Usage: node scripts/release.mjs version <version> | check <tag> | notes <version> | publish'
    );
}
