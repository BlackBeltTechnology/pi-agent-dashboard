## MODIFIED Requirements

### Requirement: Query matching, tokenization, and empty results
The store SHALL build a full-text match by OR-ing the query's tokenized terms and SHALL return an empty result set when the query yields no usable terms. Tokenization lowercases the query, keeps runs of Unicode letters and numbers of length ≥ 2, and drops a fixed stopword set (e.g. the, for, and, how, what, with, use, using) from the match terms. Tokenization SHALL case-fold and diacritic-fold Latin, Greek and Cyrillic text exactly as the index tokenizer's normalization step (`unicode61`, `remove_diacritics=1`, before stemming) does, so a query term and the pre-stemming indexed form of the same word are identical. A precomposed letter that is an ASCII letter plus one diacritic folds to that ASCII letter; nonspacing combining marks in decomposed text are dropped; letters the index does not fold (e.g. `ß`, `ø`, `ł`, Greek tonos, Latin letters with several diacritics) are kept as-is. Stemming is applied by the index on both the query and the document side, never by tokenization. All ranking stages that compare query terms with chunk text (coverage rerank, pseudo-relevance feedback, synonym expansion, proximity boost, lexical diversity) SHALL use this same tokenization. If stopword filtering removes every term, the store falls back to the raw (folded, unfiltered) terms so a stopword-only query still matches.

#### Scenario: Multi-term query broadens recall
- **WHEN** the query contains several words
- **THEN** the store matches chunks containing any of the tokenized (stopword-filtered) terms
- **AND** BM25 ranks chunks matching more/rarer terms higher

#### Scenario: Stopwords excluded from match terms
- **WHEN** the query contains stopwords (e.g. "what is the for")
- **THEN** those stopwords are dropped from the OR-ed match terms
- **AND** only the surviving content terms drive the search

#### Scenario: Stopword-only query falls back to raw terms
- **WHEN** every tokenized term is a stopword and would otherwise leave no terms
- **THEN** the store falls back to the raw terms (length ≥ 2) so the query still executes

#### Scenario: Query with no usable terms
- **WHEN** the query produces no letter/digit terms of length ≥ 2
- **THEN** the store returns an empty list without executing a search

#### Scenario: Result count bounded
- **WHEN** a search runs without an explicit limit
- **THEN** at most 10 hits are returned
- **AND** an explicit limit is clamped to the range 1..1000

#### Scenario: Accented word is one term, not ASCII fragments
- **WHEN** the query is `közzétételek` and the corpus holds a `Közzétételek` document and an unrelated document containing the word `telek`
- **THEN** the `Közzétételek` document ranks first
- **AND** the `telek` document is not returned

#### Scenario: Word starting with an accented letter is not truncated
- **WHEN** the query is `árfolyamriasztás` or `Győr`
- **THEN** the document containing that word is returned first

#### Scenario: Accented and unaccented input are equivalent for single-diacritic Latin letters
- **WHEN** the query is `Ügyfélszolgálat`, `ügyfélszolgálat` or `ugyfelszolgalat`
- **THEN** each returns the same top document

#### Scenario: Dotted capital I folds like the index
- **WHEN** the query is `İstanbul` and a document contains `İstanbul`
- **THEN** that document is returned first

#### Scenario: Scripts the index does not fold stay searchable
- **WHEN** the query is `Ελληνικά` or `tiếng` and a document contains that exact word
- **THEN** that document is returned
- **AND** the accent is not stripped from the query term

#### Scenario: Query tokens agree with the index tokenizer's normalization
- **WHEN** any letter or digit from the Latin, Greek or Cyrillic Unicode blocks, embedded in a word, is tokenized by the store and by the index tokenizer without stemming
- **THEN** both yield the same terms (ignoring terms shorter than 2 characters)
- **AND** the only exception is U+037F (GREEK CAPITAL LETTER YOT); any further exception requires amending this scenario

#### Scenario: Decomposed input folds like precomposed input
- **WHEN** the query contains decomposed text (a base letter followed by nonspacing combining marks, e.g. `Ko` + U+0308 + `zze` + U+0301 + `telek`)
- **THEN** it yields the same terms as the index tokenizer produces for that text

#### Scenario: ASCII queries tokenize as before
- **WHEN** the query is pure ASCII (e.g. `how does pairing work`, `kb_search v2`)
- **THEN** the terms are identical to the previous ASCII tokenizer (`pairing`, `work`; `kb`, `search`, `v2`)
