import ja from '@/i18n/dictionaries/ja.json';

import { brandTitle } from './title';

/*
 * The page titles, resolved synchronously.
 *
 * A route's `head()` may run before its loader has resolved — TanStack types
 * `loaderData` as optional for exactly that reason — and a document with no
 * `<title>`, even briefly, is not something this contract allows. So the title
 * does not come from the loader at all.
 *
 * Reading the default-locale dictionary statically is safe here rather than a
 * shortcut: `defaultLocale` is a constant, and this unit
 * serves one language and does not negotiate — `<html lang>` is pinned to the
 * same constant — so there was never a request in which the title could have
 * come out in the other language.
 *
 * The page CONTENT still goes through the loader and `getDictionary`, which is
 * what keeps the second dictionary reachable and the locale check exercised.
 * When this unit starts negotiating, this module is the one that has to change,
 * and `test/title-contract.test.tsx` is what will notice.
 */
export const pageTitles = {
  about: brandTitle(ja.about.title),
  configuration: brandTitle(ja.configuration.title),
  configuration_account: brandTitle(ja.configuration_account.title),
  doctor: brandTitle(ja.doctor.title),
  explore: brandTitle(ja.explore.title),
  messages: brandTitle(ja.messages.title),
  notifications: brandTitle(ja.notifications.title),
  publishing: brandTitle(ja.publishing.title),
} as const;
