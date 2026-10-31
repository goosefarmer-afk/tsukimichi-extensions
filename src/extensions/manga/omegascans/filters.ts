export const OMEGA_SCANS_ORDER_BY_OPTIONS = [
  {
    label: "Title",
    value: "title",
  },
  {
    label: "Views",
    value: "total_views",
  },
  {
    label: "Latest",
    value: "latest",
  },
  {
    label: "Oldest",
    value: "oldest",
  },
];

export const OMEGA_SCANS_ORDER_OPTIONS = [
  {
    label: "Ascending",
    value: "asc",
  },
  {
    label: "Descending",
    value: "desc",
  },
];

export const OMEGA_SCANS_STATUS_OPTIONS = [
  "All",
  "Ongoing",
  "Dropped",
  "Completed",
  "Canceled",
].map((s) => ({
  label: s,
  value: s,
}));
