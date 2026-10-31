import type { MultiSelectFilter, SelectFilter, TriStateCheckboxFilter } from "@tsukimichi/common";

export const SortFilter: SelectFilter = {
  key: "sortBy",
  label: "Sort By",
  type: "select",
  options: [
    { label: "Best Score", value: "score_desc" },
    { label: "Worst Score", value: "score_asc" },
    { label: "A-Z", value: "name_asc" },
    { label: "Z-A", value: "name_desc" },
    { label: "Latest Release", value: "recent" },
  ],
  defaultValue: "score_desc",
};

export const FormatFilter: MultiSelectFilter = {
  key: "format",
  label: "Format",
  type: "multi-select",
  renderAs: "select",
  options: [
    { label: "TV", value: "tv" },
    { label: "Movie", value: "movie" },
    { label: "OVA", value: "ova" },
    { label: "ONA", value: "ona" },
    { label: "Special", value: "special" },
    { label: "Music", value: "music" },
  ],
};

export const StatusFilter: MultiSelectFilter = {
  key: "status",
  label: "Status",
  type: "multi-select",
  renderAs: "select",
  options: [
    { label: "Releasing", value: "releasing" },
    { label: "Completed", value: "completed" },
    { label: "Note Yet Aired", value: "not_yet_aired" },
  ],
};

export const LanguageFilter: MultiSelectFilter = {
  key: "language",
  label: "Language",
  type: "multi-select",
  renderAs: "select",
  options: [
    { label: "Subbed", value: "HardSub" },
    { label: "Dubbed", value: "Dub" },
  ],
};

export const SeasonFilter: MultiSelectFilter = {
  key: "season",
  label: "Season",
  type: "multi-select",
  renderAs: "select",
  options: [
    { label: "Winter", value: "winter" },
    { label: "Spring", value: "spring" },
    { label: "Summer", value: "summer" },
    { label: "Fall", value: "fall" },
  ],
};

export const YearFilter: SelectFilter = {
  key: "year",
  label: "Year",
  type: "select",
  options: [
    { label: "Any", value: "any" },
    ...Array.from({ length: new Date().getFullYear() - 1980 + 1 }, (_, i) => {
      const year = 1980 + i;
      return { label: String(year), value: String(year) };
    }).toReversed(),
  ],
  defaultValue: "any",
};

export const GenreFilter: TriStateCheckboxFilter = {
  key: "genre",
  label: "Genres",
  type: "tri-state-checkbox",
  options: [
    "Action",
    "Adventure",
    "Avant Garde",
    "Boys Love",
    "Comedy",
    "Demons",
    "Drama",
    "Ecchi",
    "Fantasy",
    "Girls Love",
    "Gourmet",
    "Harem",
    "Horror",
    "Isekai",
    "Iyashikei",
    "Josei",
    "Kids",
    "Magic",
    "Mahou Shoujo",
    "Martial Arts",
    "Mecha",
    "Military",
    "Music",
    "Mystery",
    "Parody",
    "Psychological",
    "Reverse Harem",
    "Romance",
    "School",
    "Sci-Fi",
    "Seinen",
    "Slice of Life",
    "Space",
    "Sports",
    "Shounen",
    "Super Power",
    "Supernatural",
    "Suspense",
    "Thriller",
    "Vampire",
  ].map((genre) => ({ label: genre, value: genre })),
};
