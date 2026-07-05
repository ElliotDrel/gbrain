import test from 'node:test';
import assert from 'node:assert/strict';

import { parseAliasPairs } from '../src/commands/tags.ts';

test('parseAliasPairs extracts approved alias lines from markdown bullets', () => {
  const text = [
    '# Convention: Approved Semantic Tag Aliases',
    '',
    '- `founders` -> `founder`',
    '- `books` -> `book`',
    '- not an alias line',
    '- `yc` -> `y-combinator`',
  ].join('\n');

  assert.deepEqual(parseAliasPairs(text), [
    { from: 'founders', to: 'founder' },
    { from: 'books', to: 'book' },
    { from: 'yc', to: 'y-combinator' },
  ]);
});

test('parseAliasPairs dedupes repeated lines and skips self-maps', () => {
  const text = [
    '- `founders` -> `founder`',
    '- `founders` -> `founder`',
    '- `same` -> `same`',
  ].join('\n');

  assert.deepEqual(parseAliasPairs(text), [
    { from: 'founders', to: 'founder' },
  ]);
});
