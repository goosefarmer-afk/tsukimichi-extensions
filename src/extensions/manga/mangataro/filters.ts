import type { SelectFilter, SortFilter as SortFilterType } from "@tsukimichi/common";

export const SortFilter: SortFilterType = {
  key: "sort",
  label: "Sort",
  type: "sort",
  options: [
    { label: "Latest Updates", value: "post" },
    { label: "Release Date", value: "release" },
    { label: "Title A-Z", value: "title" },
    { label: "Popular", value: "popular" },
  ],
  defaultValue: "post",
};

export const StatusFilter: SelectFilter = {
  key: "statuses",
  type: "select",
  label: "Status",
  options: [
    { label: "All", value: "all" },
    { label: "Completed", value: "completed" },
    { label: "Ongoing", value: "Ongoing" },
  ],
  defaultValue: "all",
};

export const TypeFilter: SelectFilter = {
  key: "types",
  label: "Type",
  options: [
    { label: "All", value: "all" },
    ...["Manga", "Manhwa", "Manhua"].map((item) => ({ label: item, value: item })),
  ],
  type: "select",
  defaultValue: "all",
};
