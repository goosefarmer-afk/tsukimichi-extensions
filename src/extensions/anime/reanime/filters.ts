import type { MultiSelectFilter, SelectFilter } from "@tsukimichi/common";

export const SortFilter = {
  key: "sort",
  label: "Sort By",
  type: "select",
  options: [
    { label: "Popularity", value: "popularity_desc" },
    { label: "Score", value: "score_desc" },
    { label: "Year", value: "year_desc" },
  ],
  defaultValue: "popularity_desc",
} as const satisfies SelectFilter;

export const FormatFilter = {
  key: "format",
  label: "Format",
  type: "select",
  options: [
    { label: "Any", value: "any" },
    ...["TV", "Movie", "Special", "OVA", "ONA", "Music"].map((item) => ({
      label: item,
      value: item.toUpperCase(),
    })),
  ],
  defaultValue: "any",
} as const satisfies SelectFilter;

export const StatusFilter = {
  key: "status",
  type: "select",
  label: "Airing Status",
  options: [
    { label: "Any", value: "any" },
    ...["Finished", "Releasing", "Not Yet Released", "Cancelled"].map((item) => ({
      label: item,
      value: item,
    })),
  ],
  defaultValue: "any",
} as const satisfies SelectFilter;

export const SeasonFilter = {
  key: "season",
  label: "Season",
  type: "select",
  options: [
    { label: "Any", value: "any" },
    ...["Winter", "Spring", "Summer", "Fall"].map((item) => ({
      label: item,
      value: item.toUpperCase(),
    })),
  ],
  defaultValue: "any",
} as const satisfies SelectFilter;

export const OriginFilter = {
  key: "country",
  label: "Origin",
  type: "select",
  options: [
    { label: "Any", value: "any" },
    { label: "Japan", value: "JP" },
    { label: "South Korea", value: "KR" },
    { label: "China", value: "CN" },
    { label: "Taiwan", value: "TW" },
  ],
  defaultValue: "any",
} as const satisfies SelectFilter;

export const YearFilter = {
  key: "year",
  label: "Year",
  type: "select",
  options: [
    { label: "Any", value: "any" },
    ...Array.from({ length: new Date().getFullYear() - 1990 + 1 }, (_, i) => ({
      label: String(1980 + i),
      value: String(1980 + i),
    })).toReversed(),
  ],
  defaultValue: "any",
} as const satisfies SelectFilter;

export const GenreFilter = {
  key: "genre",
  label: "Genres",
  type: "multi-select",
  options: [
    "Action",
    "Action & Adventure",
    "Adventure",
    "Animation",
    "Avant Garde",
    "Award Winning",
    "Boys Love",
    "Comedy",
    "Drama",
    "Ecchi",
    "Erotica",
    "Family",
    "Fantasy",
    "Girls Love",
    "Gourmet",
    "Hentai",
    "Horror",
    "Mahou Shoujo",
    "Mecha",
    "Music",
    "Mystery",
    "Psychological",
    "Romance",
    "Sci-Fi",
    "Sci-Fi & Fantasy",
    "Science Fiction",
    "Slice of Life",
    "Sports",
    "Supernatural",
    "Suspense",
    "Thriller",
  ].map((item) => ({ label: item, value: item })),
  renderAs: "checkbox-group",
} as const satisfies MultiSelectFilter;

export const StudioFilter = {
  key: "studio",
  label: "Studios",
  renderAs: "checkbox-group",
  type: "multi-select",
  options: [
    "NHK",
    "Toei Animation",
    "Aniplex",
    "Funimation",
    "Sunrise",
    "Sentai Filmworks",
    "TV Tokyo",
    "Production I.G",
    "Movic",
    "J.C.STAFF",
    "KADOKAWA",
    "Tencent Penguin Pictures",
    "MADHOUSE",
    "Pony Canyon",
    "TMS Entertainment",
    "AT-X",
    "bilibili",
    "Lantis",
    "Kodansha",
    "Studio DEEN",
  ].map((item) => ({ label: item, value: item })),
} as const satisfies MultiSelectFilter;
