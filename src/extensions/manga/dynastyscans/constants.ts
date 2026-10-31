export const SERIES_TYPE = "Series";
export const CHAPTER_TYPE = "Chapter";
export const ANTHOLOGY_TYPE = "Anthology";
export const DOUJIN_TYPE = "Doujin";
export const ISSUE_TYPE = "Issue";

export const MANGA_TYPES = [SERIES_TYPE, CHAPTER_TYPE, ANTHOLOGY_TYPE, DOUJIN_TYPE, ISSUE_TYPE];

export const SERIES_DIR = "series";
export const CHAPTERS_DIR = "chapters";
export const ANTHOLOGIES_DIR = "anthologies";
export const DOUJINS_DIR = "doujins";
export const ISSUES_DIR = "issues";

export const MANGA_DIRS = [SERIES_DIR, CHAPTERS_DIR, ANTHOLOGIES_DIR, DOUJINS_DIR, ISSUES_DIR];

export const COVER_URL_FRAGMENT = "thumbnail";

export const AUTHORS_UPPER_LIMIT = 10;

export const CHAPTER_FETCH_LIMIT_PREF_KEY = "chapterFetchLimit";
export const CHAPTERS_FETCH_LIMITS = ["2", "5", "10", "all"] as const;

export const CHAPTER_SLUG_REGEX = /(.*?)_(ch[0-9_]+|volume_[0-9_\w]+)/;

// Sort
export const SMART_SORT = "_smart_";
export const BEST_MATCH = "best_match";
export const RELEASED_ON = "released_on";

export const SCANLATOR_FILTER_KEY = "scanlator";
export const AUTHOR_FILTER_KEY = "author";
export const SORT_FILTER_KEY = "sort";
export const TYPE_FILTER_KEY = "type";
export const PAIRING_FILTER_KEY = "pairing";

export const SEARCH_SERIES_SELECTOR_REGEX = new RegExp(
  `/(?:${SERIES_DIR}|${ANTHOLOGIES_DIR}|${CHAPTERS_DIR}|${DOUJINS_DIR}|${ISSUES_DIR})/`,
);
