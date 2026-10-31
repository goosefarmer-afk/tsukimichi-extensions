import type { MultiSelectFilter, SelectFilter, TriStateCheckboxFilter } from "@tsukimichi/common";

const STATUS_OPTIONS = [
  {
    label: "Finished Airing",
    value: "finished-airing",
  },
  {
    label: "Currently Airing",
    value: "currently-airing",
  },
  {
    label: "Not yet aired",
    value: "not-yet-aired",
  },
];

const STATUS_FILTER: MultiSelectFilter = {
  key: "status[]",
  label: "Status",
  options: STATUS_OPTIONS,
  type: "multi-select",
  renderAs: "select",
};

const SEASON_OPTIONS = [
  {
    label: "Fall",
    value: "fall",
  },
  {
    label: "Summer",
    value: "summer",
  },
  {
    label: "Spring",
    value: "spring",
  },
  {
    label: "Winter",
    value: "winter",
  },
];

const SEASON_FILTER: MultiSelectFilter = {
  key: "season[]",
  label: "Seasons",
  options: SEASON_OPTIONS,
  type: "multi-select",
  renderAs: "select",
};

const currentYear = new Date().getFullYear();

const YEAR_FILTER: MultiSelectFilter = {
  key: "year[]",
  label: "Years",
  options: Array.from({ length: currentYear + 1 - 1990 + 1 }, (_, i) => {
    const year = currentYear - i;
    return {
      label: year.toString(),
      value: year.toString(),
    };
  }),
  renderAs: "checkbox-group",
  type: "multi-select",
};

const TERM_TYPE_OPTIONS = [
  {
    label: "Movie",
    value: "Movie",
  },
  {
    label: "Music",
    value: "Music",
  },
  {
    label: "ONA",
    value: "ONA",
  },
  {
    label: "OVA",
    value: "OVA",
  },
  {
    label: "Special",
    value: "Special",
  },
  {
    label: "TV",
    value: "TV",
  },
];

const TERM_TYPE_FILTER: MultiSelectFilter = {
  key: "term_type[]",
  label: "Series Type",
  options: TERM_TYPE_OPTIONS,
  type: "multi-select",
  renderAs: "select",
};

const LANGUAGE_OPTIONS = [
  {
    label: "Sub",
    value: "sub",
  },
  {
    label: "Dub",
    value: "dub",
  },
];

const LANGUAGE_FILTER: MultiSelectFilter = {
  key: "language[]",
  label: "Language",
  options: LANGUAGE_OPTIONS,
  type: "multi-select",
  renderAs: "select",
};

const CONTENT_RATING_OPTIONS = [
  {
    label: "G - All Ages",
    value: "G",
  },
  {
    label: "PG - Children",
    value: "PG",
  },
  {
    label: "PG-13 - Teens 13 or older",
    value: "PG-13",
  },
  {
    label: "R - Violence & Profanity",
    value: "R",
  },
  {
    label: "R+ - Mild Nudity",
    value: "R+",
  },
  {
    label: "Rx - Hentai",
    value: "Rx",
  },
];

const CONTENT_RATING_FILTER: MultiSelectFilter = {
  key: "rating[]",
  label: "Content Rating",
  options: CONTENT_RATING_OPTIONS,
  type: "multi-select",
  renderAs: "select",
};

const GENRE_OPTIONS = [
  { label: "Action", value: "1" },
  { label: "Adventure", value: "2" },
  { label: "Cars", value: "538" },
  { label: "Comedy", value: "8" },
  { label: "Dementia", value: "453" },
  { label: "Demons", value: "119" },
  { label: "Drama", value: "62" },
  { label: "Ecchi", value: "214" },
  { label: "Fantasy", value: "3" },
  { label: "Game", value: "180" },
  { label: "Harem", value: "215" },
  { label: "Historical", value: "70" },
  { label: "Horror", value: "222" },
  { label: "Isekai", value: "74" },
  { label: "Josei", value: "404" },
  { label: "Kids", value: "46" },
  { label: "Magic", value: "203" },
  { label: "Martial Arts", value: "114" },
  { label: "Mecha", value: "123" },
  { label: "Military", value: "125" },
  { label: "Music", value: "242" },
  { label: "Mystery", value: "57" },
  { label: "Parody", value: "162" },
  { label: "Police", value: "136" },
  { label: "Psychological", value: "73" },
  { label: "Romance", value: "28" },
  { label: "Samurai", value: "163" },
  { label: "School", value: "14" },
  { label: "Sci-Fi", value: "12" },
  { label: "Seinen", value: "50" },
  { label: "Shoujo", value: "252" },
  { label: "Shoujo Ai", value: "235" },
  { label: "Shounen", value: "15" },
  { label: "Shounen Ai", value: "233" },
  { label: "Slice of Life", value: "35" },
  { label: "Space", value: "124" },
  { label: "Sports", value: "29" },
  { label: "Super Power", value: "16" },
  { label: "Supernatural", value: "9" },
  { label: "Thriller", value: "54" },
  { label: "unknown", value: "32" },
  { label: "Vampire", value: "58" },
];

const GENRE_FILTER: TriStateCheckboxFilter = {
  key: "genre[]",
  label: "Genre",
  options: GENRE_OPTIONS,
  type: "tri-state-checkbox",
};

const SORT_OPTIONS = [
  {
    label: "Default",
    value: "default",
  },
  {
    label: "Last updated",
    value: "last-updated",
  },
  {
    label: "Last added",
    value: "last-added",
  },
  {
    label: "Score",
    value: "score",
  },
  {
    label: "Name A-Z",
    value: "name-az",
  },
  {
    label: "Release date",
    value: "release-date",
  },
  {
    label: "Number of episodes",
    value: "number_of_episodes",
  },
];

const SORT_FILTER: SelectFilter = {
  key: "sort",
  label: "Sort",
  options: SORT_OPTIONS,
  type: "select",
  defaultValue: "default",
};

export const ANIKOTO_THEME_FILTERS = [
  SORT_FILTER,
  STATUS_FILTER,
  CONTENT_RATING_FILTER,
  SEASON_FILTER,
  TERM_TYPE_FILTER,
  LANGUAGE_FILTER,
  YEAR_FILTER,
  GENRE_FILTER,
];

export {
  SORT_FILTER,
  STATUS_FILTER,
  CONTENT_RATING_FILTER,
  SEASON_FILTER,
  TERM_TYPE_FILTER,
  LANGUAGE_FILTER,
  YEAR_FILTER,
  GENRE_FILTER,
};
