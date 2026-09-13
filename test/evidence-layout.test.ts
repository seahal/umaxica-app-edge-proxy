import { type Dirent, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const repoRoot = join(import.meta.dirname, '..');
const evidenceDir = join(repoRoot, 'evidence');

/**
 * `evidence/` holds the repository's audit trail of verification that was
 * actually performed — what was checked, how, what was observed, what was
 * concluded. Whether a record is honest is a human question and no test can
 * answer it. Its layout is not, and layout is the half that rots silently.
 *
 * Three rules, and each one fails in a way that is invisible until it is
 * expensive:
 *
 * - Flat. The first `evidence/2026-q3/` looks tidy and quietly ends the one
 *   property the convention exists for: `ls` is chronological, so a reader
 *   finds the most recent check on a subject without knowing how anyone
 *   before them chose to file it.
 * - `.md` only. Raw logs, screenshots, profiler output and coverage dumps are
 *   what an evidence record is a summary OF. Committing them instead grows the
 *   repository without making anything findable, and the measurement that
 *   mattered stays buried in a 40 MB file nobody opens.
 * - `YYYY-MM-DD-<topic>.md`. An ISO date is what makes lexicographic order
 *   chronological. `sep-02-2026` sorts under "s", between two unrelated
 *   subjects.
 *
 * A missing `evidence/` directory passes. The convention is opt-in per
 * repository, the directory appears on first real use, and an empty one would
 * otherwise have to be held open by a `.gitkeep` that breaks the `.md` rule it
 * exists to serve.
 */

// Anchored, and the month/day alternations are spelled out rather than \d{2}:
// `2026-13-45-x.md` is exactly the kind of typo a lazier pattern lets through.
const EVIDENCE_NAME = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])-[a-z0-9]+(-[a-z0-9]+)*\.md$/u;

function evidenceEntries(): { name: string; isDirectory: boolean; isFile: boolean }[] {
  let entries: Dirent[];
  try {
    entries = readdirSync(evidenceDir, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
  return entries.map((entry) => {
    // A symlink to a directory is a subdirectory for every purpose that matters
    // here, so resolve before deciding.
    const resolved = entry.isSymbolicLink() ? statSync(join(evidenceDir, entry.name)) : entry;
    return { name: entry.name, isDirectory: resolved.isDirectory(), isFile: resolved.isFile() };
  });
}

describe('evidence/ layout', () => {
  it('is flat', () => {
    const directories = evidenceEntries()
      .filter((entry) => entry.isDirectory)
      .map((entry) => `evidence/${entry.name}/`);
    expect(directories, 'evidence/ must be flat; no subdirectories').toEqual([]);
  });

  it('holds only Markdown files', () => {
    const foreign = evidenceEntries()
      .filter((entry) => !entry.isDirectory && !entry.name.endsWith('.md'))
      .map((entry) => `evidence/${entry.name}`);
    expect(
      foreign,
      'only .md files are allowed; summarize the artifact in a record instead of committing it',
    ).toEqual([]);
  });

  it('names every record YYYY-MM-DD-<topic>.md', () => {
    const misnamed = evidenceEntries()
      .filter((entry) => entry.isFile && entry.name.endsWith('.md'))
      .filter((entry) => !EVIDENCE_NAME.test(entry.name))
      .map((entry) => `evidence/${entry.name}`);
    expect(misnamed, 'expected YYYY-MM-DD-<topic>.md with a lowercase hyphenated topic').toEqual(
      [],
    );
  });
});
