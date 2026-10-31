import type { MultiSelectFilter, TriStateCheckboxFilter } from "@tsukimichi/common";
import {
  GENRE_FILTER as G_FILTER,
  SEASON_FILTER,
} from "@/lib/multi-src/anime/anikoto-theme/filters";

const GENRE_OPTIONS = [
  { label: "Action", value: "1" },
  { label: "Adult Cast", value: "15" },
  { label: "Adventure", value: "10" },
  { label: "Anthropomorphic", value: "9" },
  { label: "Avant Garde", value: "396" },
  { label: "Award Winning", value: "2035" },
  { label: "CGDCT", value: "20" },
  { label: "Childcare", value: "863" },
  { label: "Combat Sports", value: "1143" },
  { label: "Comedy", value: "4" },
  { label: "Delinquents", value: "307" },
  { label: "Detective", value: "593" },
  { label: "Drama", value: "30" },
  { label: "Ecchi", value: "77" },
  { label: "Educational", value: "1571" },
  { label: "Erotica", value: "4721" },
  { label: "Fantasy", value: "5" },
  { label: "Gag Humor", value: "444" },
  { label: "Gore", value: "190" },
  { label: "Gourmet", value: "90" },
  { label: "Harem", value: "78" },
  { label: "High Stakes Game", value: "395" },
  { label: "Historical", value: "180" },
  { label: "Horror", value: "188" },
  { label: "Idols (Female)", value: "316" },
  { label: "Idols (Male)", value: "972" },
  { label: "Isekai", value: "12" },
  { label: "Iyashikei", value: "133" },
  { label: "Josei", value: "298" },
  { label: "Kids", value: "93" },
  { label: "Love Polygon", value: "1982" },
  { label: "Mahou Shoujo", value: "241" },
  { label: "Martial Arts", value: "209" },
  { label: "Mecha", value: "45" },
  { label: "Medical", value: "289" },
  { label: "Military", value: "55" },
  { label: "Music", value: "317" },
  { label: "Mystery", value: "272" },
  { label: "Mythology", value: "24" },
  { label: "Organized Crime", value: "391" },
  { label: "Otaku Culture", value: "1567" },
  { label: "Parody", value: "748" },
  { label: "Performing Arts", value: "1011" },
  { label: "Pets", value: "296" },
  { label: "Psychological", value: "139" },
  { label: "Racing", value: "1162" },
  { label: "Reincarnation", value: "13" },
  { label: "Reverse Harem", value: "1124" },
  { label: "Romance", value: "23" },
  { label: "Romantic Subtext", value: "157" },
  { label: "Samurai", value: "181" },
  { label: "School", value: "106" },
  { label: "Sci-Fi", value: "44" },
  { label: "Seinen", value: "17" },
  { label: "Shoujo", value: "25" },
  { label: "Shounen", value: "7" },
  { label: "Showbiz", value: "3022" },
  { label: "Slice of Life", value: "8" },
  { label: "Space", value: "869" },
  { label: "Sports", value: "96" },
  { label: "Strategy Game", value: "2" },
  { label: "Super Power", value: "6" },
  { label: "Supernatural", value: "19" },
  { label: "Survival", value: "677" },
  { label: "Suspense", value: "138" },
  { label: "Team Sports", value: "463" },
  { label: "Time Travel", value: "470" },
  { label: "Urban Fantasy", value: "586648" },
  { label: "Vampire", value: "934" },
  { label: "Video Game", value: "94" },
  { label: "Villainess", value: "359345" },
  { label: "Visual Arts", value: "780" },
  { label: "Workplace", value: "16" },
];

const GENRE_FILTER: TriStateCheckboxFilter = {
  ...G_FILTER,
  options: GENRE_OPTIONS,
};

const COUNTRY_OPTIONS = [
  {
    label: "China",
    value: "cn",
  },
  {
    label: "Japan",
    value: "jp",
  },
  {
    label: "Korea",
    value: "kr",
  },
];

const COUNTRY_FILTER: MultiSelectFilter = {
  key: "country[]",
  label: "Country",
  options: COUNTRY_OPTIONS,
  type: "multi-select",
  renderAs: "select",
};

const YEAR_OPTIONS = [
  { label: "2026", value: "2026" },
  { label: "2025", value: "2025" },
  { label: "2024", value: "2024" },
  { label: "2023", value: "2023" },
  { label: "2022", value: "2022" },
  { label: "2021", value: "2021" },
  { label: "2020", value: "2020" },
  { label: "2019", value: "2019" },
  { label: "2018", value: "2018" },
  { label: "2017", value: "2017" },
  { label: "2016", value: "2016" },
  { label: "2015", value: "2015" },
  { label: "2014", value: "2014" },
  { label: "2013", value: "2013" },
  { label: "2012", value: "2012" },
  { label: "2011", value: "2011" },
  { label: "2010", value: "2010" },
  { label: "2009", value: "2009" },
  { label: "2008", value: "2008" },
  { label: "2007", value: "2007" },
  { label: "2006", value: "2006" },
  { label: "2005", value: "2005" },
  { label: "2004", value: "2004" },
  { label: "2000s", value: "2000s" },
  { label: "1990s", value: "1990s" },
  { label: "1980s", value: "1980s" },
];

const YEAR_FILTER: MultiSelectFilter = {
  key: "year[]",
  label: "Year",
  options: YEAR_OPTIONS,
  renderAs: "checkbox-group",
  type: "multi-select",
};

const SERIES_TYPE_OPTIONS = [
  { label: "Movie", value: "movie" },
  { label: "TV", value: "tv" },
  { label: "OVA", value: "ova" },
  { label: "ONA", value: "ona" },
  { label: "Special", value: "special" },
  { label: "TV Special", value: "tv-special" },
  { label: "CM", value: "cm" },
  { label: "Music", value: "music" },
];

const SERIES_TYPE_FILTER: MultiSelectFilter = {
  key: "type[]",
  label: "Type",
  options: SERIES_TYPE_OPTIONS,
  renderAs: "checkbox-group",
  type: "multi-select",
};

const STATUS_OPTIONS = [
  {
    label: "Currently Airing",
    value: "0",
  },
  {
    label: "Finished Airing",
    value: "1",
  },
];

const STATUS_FILTER: MultiSelectFilter = {
  key: "status[]",
  label: "Status",
  options: STATUS_OPTIONS,
  renderAs: "select",
  type: "multi-select",
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
  {
    label: "Sub & Dub",
    value: "subdub",
  },
];

const LANGUAGE_FILTER: MultiSelectFilter = {
  key: "language[]",
  label: "Language",
  options: LANGUAGE_OPTIONS,
  renderAs: "select",
  type: "multi-select",
};

const CONTENT_RATING_OPTIONS = [
  {
    label: "G",
    value: "g",
  },
  {
    label: "PG",
    value: "pg",
  },
  {
    label: "PG-13",
    value: "pg13",
  },
  {
    label: "R",
    value: "r17",
  },
  {
    label: "R+",
    value: "r",
  },
];

const CONTENT_RATING_FILTER: MultiSelectFilter = {
  key: "rating[]",
  label: "Content Rating",
  options: CONTENT_RATING_OPTIONS,
  type: "multi-select",
  renderAs: "select",
};

export const FILTERS = [
  STATUS_FILTER,
  SEASON_FILTER,
  COUNTRY_FILTER,
  CONTENT_RATING_FILTER,
  SERIES_TYPE_FILTER,
  LANGUAGE_FILTER,
  YEAR_FILTER,
  GENRE_FILTER,
];
