import Typo from 'typo-js';

// Loaded once and cached — the .aff/.dic files are a few hundred KB, no
// need to re-fetch on every "Check Spelling" click. See the README note
// in public/dictionaries/ for where these files come from.
let typoInstance: Typo | null = null;
let loadingPromise: Promise<Typo> | null = null;

async function getTypo(): Promise<Typo> {
  if (typoInstance) return typoInstance;
  if (loadingPromise) return loadingPromise;

  loadingPromise = (async () => {
    const [affData, wordsData] = await Promise.all([
      fetch('/dictionaries/en_US.aff').then((r) => {
        if (!r.ok) throw new Error('Could not load spellcheck dictionary (en_US.aff)');
        return r.text();
      }),
      fetch('/dictionaries/en_US.dic').then((r) => {
        if (!r.ok) throw new Error('Could not load spellcheck dictionary (en_US.dic)');
        return r.text();
      }),
    ]);
    typoInstance = new Typo('en_US', affData, wordsData);
    return typoInstance;
  })();

  return loadingPromise;
}

export interface MisspelledWord {
  word: string;
  /** Character offset within the original text this word was found at. */
  index: number;
}

// Tokenizes on word-boundary sequences of letters and internal apostrophes
// (so "don't" stays one token instead of splitting into "don" + "t"), then
// checks each against the dictionary. Numbers, punctuation, and pure
// symbols are skipped entirely -- they're never "misspelled" in the sense
// this feature cares about.
const WORD_PATTERN = /[A-Za-z']+/g;

export async function findMisspelledWords(text: string): Promise<MisspelledWord[]> {
  if (!text.trim()) return [];
  const typo = await getTypo();

  const results: MisspelledWord[] = [];
  let match: RegExpExecArray | null;
  WORD_PATTERN.lastIndex = 0;
  while ((match = WORD_PATTERN.exec(text)) !== null) {
    const word = match[0].replace(/^'+|'+$/g, ''); // strip leading/trailing stray apostrophes
    if (!word || word.length < 2) continue; // skip single letters like "a", "I" -- never worth flagging
    if (!typo.check(word)) {
      results.push({ word, index: match.index });
    }
  }
  return results;
}

export async function getSuggestions(word: string): Promise<string[]> {
  const typo = await getTypo();
  return typo.suggest(word, 5);
}