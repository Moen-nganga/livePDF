/**
 * Basic client-side spell checker with no external dependency.
 *
 * IMPORTANT — accuracy trade-offs, please read before relying on this:
 * There's no library installed in this project (typo-js, nspell, etc.),
 * and browsers don't expose their own native spellcheck results to
 * JavaScript at all (by design — no DOM/canvas API can ask "is this word
 * misspelled"). So this is a small hand-built checker, not a real
 * dictionary:
 *
 *  - COMMON_WORDS below is a few hundred common English words, nowhere
 *    near a full dictionary. Plenty of legitimate but less common or
 *    technical words WILL be flagged as "misspelled" (false positives).
 *  - Any capitalized word is treated as a likely proper noun/name and
 *    skipped entirely (see isLikelyCorrect) — this cuts down false
 *    positives on names/places/brands a lot, but as a side effect it also
 *    means a genuine misspelling at the START of a sentence (which is
 *    capitalized) won't be caught.
 *  - candidateStems() is a lightweight suffix-stripping heuristic (walks
 *    -> walk, running -> run), not real morphological analysis — it won't
 *    catch every inflected form correctly.
 *
 * If you want meaningfully better accuracy later, install a real
 * dictionary library (e.g. `npm install typo-js` plus an en_US .aff/.dic
 * pair, or `nspell` + `dictionary-en`) and swap out isLikelyCorrect's body
 * for a real lookup — findMisspellings() itself (the tokenizing/offset
 * logic that Toolbar.tsx and PdfCanvas.tsx depend on) doesn't need to
 * change at all.
 */

export interface SpellError {
  start: number;
  end: number;
  word: string;
}

// Deliberately not exhaustive — see file header. Covers common function
// words (articles/pronouns/prepositions/conjunctions), common irregular
// verb forms (which the suffix-stripping heuristic below can't derive),
// and a broad set of everyday nouns/adjectives/adverbs.
const COMMON_WORDS = new Set<string>([
  // articles, pronouns, conjunctions, prepositions
  'a','an','the','and','or','but','nor','so','yet','if','then','than','that','this','these','those',
  'i','me','my','mine','you','your','yours','he','him','his','she','her','hers','it','its','we','us','our','ours',
  'they','them','their','theirs','who','whom','whose','which','what','whoever','whatever',
  'to','of','in','on','at','by','for','with','about','against','between','into','through','during',
  'before','after','above','below','from','up','down','out','off','over','under','again','further',
  'once','here','there','when','where','why','how','all','any','both','each','few','more','most',
  'other','some','such','no','not','only','own','same','as','because','while','although','though',
  'until','unless','since','whether','either','neither',
  // be / have / do / modal forms
  'am','is','are','was','were','be','been','being','have','has','had','having','do','does','did','doing',
  'can','could','will','would','shall','should','may','might','must','ought',
  // common verbs (base + inflections)
  'go','goes','went','gone','going','get','gets','got','gotten','getting','make','makes','made','making',
  'know','knows','knew','known','knowing','think','thinks','thought','thinking','take','takes','took','taken','taking',
  'see','sees','saw','seen','seeing','come','comes','came','coming','want','wants','wanted','wanting',
  'look','looks','looked','looking','use','uses','used','using','find','finds','found','finding',
  'give','gives','gave','given','giving','tell','tells','told','telling','work','works','worked','working',
  'call','calls','called','calling','try','tries','tried','trying','ask','asks','asked','asking',
  'need','needs','needed','needing','feel','feels','felt','feeling','become','becomes','became','becoming',
  'leave','leaves','left','leaving','put','puts','putting','mean','means','meant','meaning',
  'keep','keeps','kept','keeping','let','lets','letting','begin','begins','began','begun','beginning',
  'seem','seems','seemed','seeming','help','helps','helped','helping','talk','talks','talked','talking',
  'turn','turns','turned','turning','start','starts','started','starting','show','shows','showed','shown','showing',
  'hear','hears','heard','hearing','play','plays','played','playing','run','runs','ran','running',
  'move','moves','moved','moving','like','likes','liked','liking','live','lives','lived','living',
  'believe','believes','believed','believing','bring','brings','brought','bringing','happen','happens','happened','happening',
  'write','writes','wrote','written','writing','provide','provides','provided','providing','sit','sits','sat','sitting',
  'stand','stands','stood','standing','lose','loses','lost','losing','pay','pays','paid','paying',
  'meet','meets','met','meeting','include','includes','included','including','continue','continues','continued','continuing',
  'set','sets','setting','learn','learns','learned','learnt','learning','change','changes','changed','changing',
  'lead','leads','led','leading','understand','understands','understood','understanding',
  'watch','watches','watched','watching','follow','follows','followed','following','stop','stops','stopped','stopping',
  'create','creates','created','creating','speak','speaks','spoke','spoken','speaking','read','reads','reading',
  'allow','allows','allowed','allowing','add','adds','added','adding','spend','spends','spent','spending',
  'grow','grows','grew','grown','growing','open','opens','opened','opening','walk','walks','walked','walking',
  'win','wins','won','winning','offer','offers','offered','offering','remember','remembers','remembered','remembering',
  'love','loves','loved','loving','consider','considers','considered','considering','appear','appears','appeared','appearing',
  'buy','buys','bought','buying','wait','waits','waited','waiting','serve','serves','served','serving',
  'die','dies','died','dying','send','sends','sent','sending','expect','expects','expected','expecting',
  'build','builds','built','building','stay','stays','stayed','staying','fall','falls','fell','fallen','falling',
  'cut','cuts','cutting','reach','reaches','reached','reaching','kill','kills','killed','killing',
  'remain','remains','remained','remaining','draw','draws','drew','drawn','drawing','choose','chooses','chose','chosen','choosing',
  'eat','eats','ate','eaten','eating','sleep','sleeps','slept','sleeping','drive','drives','drove','driven','driving',
  'break','breaks','broke','broken','breaking','sell','sells','sold','selling','forget','forgets','forgot','forgotten','forgetting',
  // common nouns
  'time','year','years','people','way','day','days','man','men','woman','women','child','children','world','life',
  'hand','hands','part','parts','place','places','case','cases','week','weeks','company','companies','system','systems',
  'program','programs','question','questions','work','works','number','numbers','night','nights','point','points',
  'home','homes','water','room','rooms','mother','area','areas','money','story','stories','fact','facts',
  'month','months','lot','lots','right','study','studies','book','books','eye','eyes','job','jobs',
  'word','words','business','businesses','issue','issues','side','sides','kind','kinds','head','heads',
  'house','houses','service','services','friend','friends','father','power','hour','hours','game','games',
  'line','lines','end','ends','member','members','law','laws','car','cars','city','cities','community','communities',
  'name','names','president','team','teams','minute','minutes','idea','ideas','body','bodies','information',
  'back','parent','parents','face','faces','others','level','levels','office','offices','door','doors',
  'health','person','art','arts','war','history','party','parties','result','results','change','morning',
  'reason','reasons','research','girl','girls','guy','guys','moment','moments','air','teacher','teachers',
  'force','forces','education','document','documents','page','pages','pdf','text','image','images','table','tables',
  'font','fonts','color','colors','size','sizes','border','borders','shape','shapes','file','files','folder','folders',
  'link','links','comment','comments','share','shares','watermark','highlight','date','dates','print','printer',
  // common adjectives / adverbs
  'good','new','first','last','long','great','little','own','other','old','right','big','high','different',
  'small','large','next','early','young','important','few','public','bad','same','able','sure','best','better',
  'true','false','free','full','main','only','real','same','simple','special','strong','weak','wrong',
  'easy','hard','light','dark','high','low','fast','slow','clear','clean','close','open','sharp','soft',
  'very','really','also','just','still','even','back','well','never','always','often','sometimes','usually',
  'today','yesterday','tomorrow','now','later','soon','already','again','together','almost','enough','quite',
  'more','most','less','least','much','many','several','little','something','anything','nothing','everything',
  'someone','anyone','everyone','somewhere','anywhere','everywhere',
  // days / months / numbers
  'monday','tuesday','wednesday','thursday','friday','saturday','sunday',
  'january','february','march','april','may','june','july','august','september','october','november','december',
  'one','two','three','four','five','six','seven','eight','nine','ten','eleven','twelve','hundred','thousand','million',
  'zero','first','second','third','fourth','fifth',
  // common contractions (kept with their apostrophe, since the word
  // tokenizer below matches apostrophes as part of a word)
  "don't","can't","won't","isn't","aren't","wasn't","weren't","hasn't","haven't","hadn't",
  "wouldn't","shouldn't","couldn't","it's","that's","there's","here's","what's","who's","let's",
  "i'm","you're","we're","they're","i've","you've","we've","they've","i'll","you'll","he'll","she'll",
  "we'll","they'll","i'd","you'd","he'd","she'd","we'd","they'd",
]);

/**
 * Very light suffix-stripping so common inflected forms of a dictionary
 * word aren't flagged just because the exact inflected spelling isn't
 * itself in COMMON_WORDS (e.g. "documents" -> "document"). Not real
 * morphology — see file header.
 */
function candidateStems(lower: string): string[] {
  const candidates = [lower];
  if (lower.endsWith("'s") && lower.length > 3) candidates.push(lower.slice(0, -2));
  if (lower.endsWith('es') && lower.length > 4) candidates.push(lower.slice(0, -2));
  if (lower.endsWith('s') && !lower.endsWith('ss') && lower.length > 3) candidates.push(lower.slice(0, -1));
  if (lower.endsWith('ing') && lower.length > 5) {
    const stem = lower.slice(0, -3);
    candidates.push(stem, stem + 'e');
  }
  if (lower.endsWith('ed') && lower.length > 4) {
    const stem = lower.slice(0, -2);
    candidates.push(stem, stem + 'e');
  }
  if (lower.endsWith('ly') && lower.length > 4) candidates.push(lower.slice(0, -2));
  if (lower.endsWith('er') && lower.length > 4) candidates.push(lower.slice(0, -2));
  if (lower.endsWith('est') && lower.length > 5) candidates.push(lower.slice(0, -3));
  return candidates;
}

function isLikelyCorrect(word: string): boolean {
  if (word.length <= 1) return true; // stray single letters aren't worth flagging
  if (/\d/.test(word)) return true; // e.g. "3rd", "2024" — skip anything with a digit
  if (word === word.toUpperCase()) return true; // acronym (PDF, NASA, ...)
  if (/^[A-Z]/.test(word)) return true; // treated as a likely proper noun — see file header caveat
  const lower = word.toLowerCase();
  return candidateStems(lower).some((c) => COMMON_WORDS.has(c));
}

/**
 * Scans free text and returns the character ranges of words that don't
 * look correct, with offsets relative to the start of `text` — callers
 * (Toolbar.tsx for scanning, PdfCanvas.tsx for drawing underlines) use
 * these offsets directly against the PageObject's own `text` string.
 */
export function findMisspellings(text: string): SpellError[] {
  const errors: SpellError[] = [];
  const wordPattern = /[A-Za-z]+(?:'[A-Za-z]+)?/g;
  let match: RegExpExecArray | null;
  while ((match = wordPattern.exec(text)) !== null) {
    const word = match[0];
    if (isLikelyCorrect(word)) continue;
    errors.push({ start: match.index, end: match.index + word.length, word });
  }
  return errors;
}