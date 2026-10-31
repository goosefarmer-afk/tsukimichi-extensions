import type { MultiSelectFilter, SelectFilter, TriStateCheckboxFilter } from "@tsukimichi/common";

const COUNTRY_ORIGIN_OPTIONS = [
  {
    label: "All",
    value: "any",
  },
  {
    label: "Japan",
    value: "JP",
  },
  {
    label: "China",
    value: "CN",
  },
  {
    label: "Korea",
    value: "KR",
  },
];

export const ALL_ANIME_COUNTRY_ORIGIN_FILTER: SelectFilter = {
  key: "countryOrigin",
  label: "Country Origin",
  options: COUNTRY_ORIGIN_OPTIONS,
  type: "select",

  defaultValue: "any",
};

const SEASON_OPTIONS = [
  {
    label: "All",
    value: "any",
  },
  {
    label: "Winter",
    value: "Winter",
  },
  {
    label: "Spring",
    value: "Spring",
  },
  {
    label: "Summer",
    value: "Summer",
  },
  {
    label: "Fall",
    value: "Fall",
  },
];

export const ALL_ANIME_SEASON_FILTER: SelectFilter = {
  key: "season",
  label: "Season",
  options: SEASON_OPTIONS,
  type: "select",

  defaultValue: "any",
};

// 2027 - 1990
const RELEASE_YEAR_OPTIONS = [
  { label: "All", value: "any" },
  ...Array.from({ length: 28 }, (_, i) => {
    const year = 2027 - i;
    return { label: year.toString(), value: year.toString() };
  }),
];

export const ALL_ANIME_RELEASE_YEAR_FILTER: SelectFilter = {
  key: "releaseYear",
  label: "Release Year",
  options: RELEASE_YEAR_OPTIONS,
  type: "select",

  defaultValue: "any",
};

const SORT_BY_OPTIONS = [
  {
    label: "Update",
    value: "update",
  },
  {
    label: "Name Asc",
    value: "Name_ASC",
  },
  {
    label: "Name Desc",
    value: "Name_DESC",
  },
  {
    label: "Ratings",
    value: "Top",
  },
];

export const ALL_ANIME_SORT_BY_FILTER: SelectFilter = {
  key: "sortBy",
  label: "Sort By",
  options: SORT_BY_OPTIONS,
  type: "select",

  defaultValue: "update",
};

const TYPE_OPTIONS = [
  {
    label: "Movie",
    value: "Movie",
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
  {
    label: "Unknown",
    value: "Unknown",
  },
];

export const ALL_ANIME_TYPE_FILTER: MultiSelectFilter = {
  key: "types",
  label: "Types",
  options: TYPE_OPTIONS,
  type: "multi-select",
  renderAs: "select",
};

const GENRE_OPTIONS = [
  { label: "Action", value: "Action" },
  { label: "Adventure", value: "Adventure" },
  { label: "Cars", value: "Cars" },
  { label: "Comedy", value: "Comedy" },
  { label: "Dementia", value: "Dementia" },
  { label: "Demons", value: "Demons" },
  { label: "Drama", value: "Drama" },
  { label: "Ecchi", value: "Ecchi" },
  { label: "Fantasy", value: "Fantasy" },
  { label: "Game", value: "Game" },
  { label: "Harem", value: "Harem" },
  { label: "Historical", value: "Historical" },
  { label: "Horror", value: "Horror" },
  { label: "Isekai", value: "Isekai" },
  { label: "Josei", value: "Josei" },
  { label: "Kids", value: "Kids" },
  { label: "Magic", value: "Magic" },
  { label: "Martial Arts", value: "Martial Arts" },
  { label: "Mecha", value: "Mecha" },
  { label: "Military", value: "Military" },
  { label: "Music", value: "Music" },
  { label: "Mystery", value: "Mystery" },
  { label: "Parody", value: "Parody" },
  { label: "Police", value: "Police" },
  { label: "Psychological", value: "Psychological" },
  { label: "Romance", value: "Romance" },
  { label: "Samurai", value: "Samurai" },
  { label: "School", value: "School" },
  { label: "Sci-Fi", value: "Sci-Fi" },
  { label: "Seinen", value: "Seinen" },
  { label: "Shoujo", value: "Shoujo" },
  { label: "Shoujo Ai", value: "Shoujo Ai" },
  { label: "Shounen", value: "Shounen" },
  { label: "Shounen Ai", value: "Shounen Ai" },
  { label: "Slice of Life", value: "Slice of Life" },
  { label: "Space", value: "Space" },
  { label: "Sports", value: "Sports" },
  { label: "Super Power", value: "Super Power" },
  { label: "Supernatural", value: "Supernatural" },
  { label: "Thriller", value: "Thriller" },
  { label: "Unknown", value: "Unknown" },
  { label: "Vampire", value: "Vampire" },
  { label: "Yaoi", value: "Yaoi" },
  { label: "Yuri", value: "Yuri" },
];

export const ALL_ANIME_GENRE_FILTER: TriStateCheckboxFilter = {
  key: "genres",
  label: "Genres",
  options: GENRE_OPTIONS,
  type: "tri-state-checkbox",
};
