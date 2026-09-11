import { describe, expect, it } from 'vitest';

import { parseRailsOrigin } from '../../src/lib/rails-origin';

describe('parseRailsOrigin', () => {
  it.each([
    ['https://rails.example', 'https://rails.example'],
    ['https://rails.example/', 'https://rails.example'],
    ['https://rails.example:8443', 'https://rails.example:8443'],
    ['http://localhost:3000', 'http://localhost:3000'],
    ['http://core.org.localhost:3000', 'http://core.org.localhost:3000'],
  ])('accepts %s', (value, expected) => {
    expect(parseRailsOrigin(value)).toBe(expected);
  });

  it.each([
    ['undefined', undefined],
    ['a number', 3000],
    ['an empty string', ''],
    ['not a URL', 'rails.example'],
    // The browser's cookies ride this hop; cleartext is for the dev container only.
    ['plain http to a public host', 'http://rails.example'],
    ['plain http to a lookalike of localhost', 'http://localhost.rails.example'],
    ['another scheme', 'ftp://rails.example'],
    ['credentials', 'https://user:secret@rails.example'],
    ['a path', 'https://rails.example/api'],
    ['a query', 'https://rails.example/?next=/'],
    ['a fragment', 'https://rails.example/#top'],
  ])('rejects %s', (_label, value) => {
    expect(parseRailsOrigin(value)).toBeNull();
  });
});
