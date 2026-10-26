import type { Analysis } from '../core/types.ts';
import { countBy, words } from '../core/util.ts';

/**
 * De-domaining: exemplars should teach style, not business logic. Business nouns from the
 * reference project ("invoice", "patient") are replaced with neutral placeholders.
 */

const GENERIC = new Set(`
  use get set is has the and for with from to of on in by app main index root page pages layout route routes router view views
  screen component components ui hook hooks api apis service services client store stores slice slices state context provider
  util utils lib helper helpers type types model models schema schemas config constants const test tests spec mock mocks
  list item items card button form modal dialog table row column header footer nav navbar sidebar menu input field select
  option label icon image avatar badge tag tabs tab panel section container wrapper box grid stack text title link loader
  loading spinner skeleton error errors toast alert empty search filter sort pagination detail details new edit create update
  delete remove add save cancel submit query queries mutation fetch request response data value values props style styles
  theme dark light auth login logout signup register user users account profile settings dashboard home admin common shared
  base core default custom global local public private all one two first last next prev status info summary overview
  chart charts stat stats event events date time calendar file files upload download image images media
`.split(/\s+/).filter(Boolean));

const PLACEHOLDERS = ['item', 'entry', 'record', 'widget', 'thing', 'resource', 'asset', 'note', 'task', 'node', 'unit', 'piece'];

export function domainTerms(analysis: Analysis): string[] {
  const all = analysis.files.flatMap((f) => words(f.path.split('/').pop()!.replace(/\.[a-z]+$/i, '')));
  return countBy(all.filter((w) => w.length >= 4 && !GENERIC.has(w) && !/^\d+$/.test(w)), (w) => w)
    .slice(0, 24)
    .map(([w]) => w);
}

const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

export function dedomain(text: string, terms: string[]): string {
  let out = text;
  terms.forEach((term, i) => {
    const ph = PLACEHOLDERS[i] ?? `item${i}`;
    for (const [from, to] of [[`${term}s`, `${ph}s`], [term, ph]] as const) {
      out = out
        .replace(new RegExp(`${from.toUpperCase()}(?![A-Z])`, 'g'), to.toUpperCase())
        .replace(new RegExp(`${cap(from)}(?![a-z])`, 'g'), cap(to))
        .replace(new RegExp(`(?<![a-zA-Z])${from}(?![a-z])`, 'g'), to);
    }
  });
  return out;
}
