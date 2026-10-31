import {
  ANTHOLOGY_TYPE,
  BEST_MATCH,
  CHAPTER_TYPE,
  DOUJIN_TYPE,
  ISSUE_TYPE,
  RELEASED_ON,
  SERIES_TYPE,
  SMART_SORT,
} from "./constants";

export const DYNASTY_SCANS_TYPE_OPTIONS = [
  SERIES_TYPE,
  CHAPTER_TYPE,
  ANTHOLOGY_TYPE,
  DOUJIN_TYPE,
  ISSUE_TYPE,
].map((t) => ({
  label: t,
  value: t,
}));

export const DYNASTY_SCANS_SORT_OPTIONS = [
  {
    label: "Smart",
    value: SMART_SORT,
  },
  {
    label: "Best Match",
    value: BEST_MATCH,
  },
  {
    label: "Alphabetical",
    value: "name",
  },
  {
    label: "Date Added",
    value: "created_at",
  },
  {
    label: "Released Date",
    value: RELEASED_ON,
  },
];
