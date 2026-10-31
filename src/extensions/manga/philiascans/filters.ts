import type { MultiSelectFilter, SelectFilter } from "@tsukimichi/common";

const SortOptions = [
  { label: "Recently Updated", value: "any" },
  { label: "Trending", value: "trending" },
  { label: "Most Viewed", value: "views" },
  { label: "Highest Rated", value: "rating" },
  { label: "Alphabetical", value: "title" },
  { label: "New Manga", value: "added" },
];

const SortFilter: SelectFilter = {
  key: "orderby",
  label: "Sort",
  type: "select",
  options: SortOptions,
};

const OrderByOptions = [
  { label: "Descending", value: "desc" },
  { label: "Ascending", value: "asc" },
];

const OrderByFilter: SelectFilter = {
  key: "order",
  label: "Order By",
  type: "select",
  options: OrderByOptions,
};

const TypeOptions = ["Manga", "Manhwa", "Manhua", "Webtoon", "Comic"].map((item) => ({
  label: item,
  value: item.toLowerCase(),
}));

const TypeFilter: MultiSelectFilter = {
  key: "types",
  label: "Type",
  type: "multi-select",
  options: TypeOptions,
  renderAs: "select",
};

const StatusOptions = [
  {
    label: "On Going",
    value: "on_going",
  },
  {
    label: "Completed",
    value: "completed",
  },
  {
    label: "On Hold",
    value: "on_hold",
  },
  {
    label: "Canceled",
    value: "canceled",
  },
];

const StatusFilter: MultiSelectFilter = {
  key: "statuses",
  label: "Status",
  type: "multi-select",
  options: StatusOptions,
  renderAs: "select",
};

const ContentRatingOptions = ["Safe", "Suggestive", "Mature", "Erotica"].map((item) => ({
  label: item,
  value: item.toLowerCase(),
}));

// oxlint-disable-next-line no-unused-vars
const ContentRatingFilter: MultiSelectFilter = {
  key: "filter_rating[]",
  label: "Content rating",
  type: "multi-select",
  options: ContentRatingOptions,
  renderAs: "select",
};

const GenreOptions = [
  "Action",
  "Adventure",
  "Comedy",
  "Drama",
  "Ecchi",
  "Fantasy",
  "Gourmet",
  "Harem",
  "Historical",
  "Isekai",
  "Josei",
  "Magic",
  "Martial Arts",
  "Mature",
  "Monsters",
  "Music",
  "Mystery",
  "Psychological",
  "Regression",
  "Romance",
  "School Life",
  "Sci-Fi",
  "Seinen",
  "Shoujo",
  "Shounen",
  "Slice of Life",
  "Supernatural",
  "Survival",
  "Tragedy",
  "Villainess",
  "War",
].map((item) => ({
  label: item,
  value: item.split(" ").join("-").toLowerCase(),
}));

const GenreFilter: MultiSelectFilter = {
  key: "genres",
  label: "Genre",
  type: "multi-select",
  options: GenreOptions,
  renderAs: "checkbox-group",
};

export const FILTERS = [SortFilter, OrderByFilter, TypeFilter, StatusFilter, GenreFilter];
