import type { SelectFilter } from "@tsukimichi/common";

const sortOptions = [
  {
    label: "Latest",
    value: "latest",
  },
  {
    label: "A-Z",
    value: "az",
  },
  {
    label: "Rating",
    value: "rating",
  },
  {
    label: "Most Views",
    value: "views",
  },
];

export const SortFilter: SelectFilter = {
  key: "sort",
  label: "Sort",
  type: "select",
  options: sortOptions,
  defaultValue: "latest",
};

// TODO: add genres
