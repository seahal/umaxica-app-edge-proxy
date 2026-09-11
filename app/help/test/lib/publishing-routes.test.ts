import { describe, expect, it } from 'vitest';

import {
  aboutPath,
  entriesPath,
  entryPath,
  homePath,
  localelessPath,
  parsePageParam,
  searchPath,
} from '../../src/lib/publishing-routes';

describe('public URL contract', () => {
  it('prefixes every path with the locale and ends it with a slash', () => {
    expect(homePath('ja')).toBe('/ja/');
    expect(homePath('en')).toBe('/en/');
    expect(aboutPath('en')).toBe('/en/about/');
    expect(searchPath('ja')).toBe('/ja/search/');
    expect(searchPath('ja', '')).toBe('/ja/search/');
    expect(searchPath('en', 'a b')).toBe('/en/search/?q=a+b');
  });

  it('never produces /page/1/ — page 1 is the collection itself', () => {
    expect(entriesPath('ja')).toBe('/ja/entries/');
    expect(entriesPath('ja', 1)).toBe('/ja/entries/');
    expect(entriesPath('ja', 2)).toBe('/ja/entries/page/2/');
    expect(entriesPath('en', 3)).toBe('/en/entries/page/3/');
  });

  it('addresses an Entry by encoded public_id', () => {
    expect(entryPath('ja', '01ABC')).toBe('/ja/entries/01ABC/');
    expect(entryPath('en', 'a/b c')).toBe('/en/entries/a%2Fb%20c/');
  });

  it('strips only its own locale prefix', () => {
    expect(localelessPath('ja', '/ja/entries/page/2/')).toBe('/entries/page/2/');
    expect(localelessPath('en', '/en/')).toBe('/');
    expect(localelessPath('en', '/ja/x/')).toBe('/ja/x/');
  });
});

describe('page parameter', () => {
  it('accepts canonical integers >= 2 and reports 1 as the first page', () => {
    expect(parsePageParam('2')).toEqual({ kind: 'page', page: 2 });
    expect(parsePageParam('123456789')).toEqual({ kind: 'page', page: 123456789 });
    expect(parsePageParam('1')).toEqual({ kind: 'first' });
  });

  it.each(['0', '-1', '01', '1.5', 'foo', '', '2a', ' 2', '1234567890', '1e3'])(
    'rejects %j without turning it into page 1',
    (raw) => {
      expect(parsePageParam(raw)).toEqual({ kind: 'invalid' });
    },
  );
});
