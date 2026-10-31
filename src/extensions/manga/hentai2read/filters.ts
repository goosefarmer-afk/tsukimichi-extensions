export const MANGA_NAME_SELECT_OPTIONS = [
  "Contains",
  "Starts With",
  "Ends With",
].map((v, i) => ({ label: v, value: i.toString() }));

export const ARTIST_NAME_SELECT_OPTIONS = [
  "Contains",
  "Starts With",
  "Ends With",
].map((v, i) => ({ label: v, value: i.toString() }));

export const CHARACTER_NAME_SELECT_OPTIONS = [
  "Contains",
  "Starts With",
  "Ends With",
].map((v, i) => ({ label: v, value: i.toString() }));

export const SORT_ORDER_OPTIONS = [
  {
    label: "Alphabetical",
    value: "name-az",
  },
  {
    label: "Most Popular",
    value: "most-popular",
  },
  {
    label: "Last Updated",
    value: "last-updated",
  },
];

export const CATEGORY_OPTIONS = [
  { label: "Adult", value: "34" },
  { label: "Anal", value: "7" },
  { label: "Big Breasts", value: "20" },
  { label: "Comedy", value: "43" },
  { label: "Compilation", value: "46" },
  { label: "Doujinshi", value: "42" },
  { label: "Ecchi", value: "40" },
  { label: "Futanari", value: "14" },
  { label: "Gender Bender", value: "26" },
  { label: "Harem", value: "31" },
  { label: "Incest", value: "15" },
  { label: "Lactation", value: "16" },
  { label: "Licensed", value: "50" },
  { label: "Lolicon", value: "17" },
  { label: "Masturbation", value: "18" },
  { label: "Oneshot", value: "33" },
  { label: "Rape", value: "23" },
  { label: "Robotics", value: "30" },
  { label: "Romance", value: "41" },
  { label: "School Life", value: "48" },
  { label: "Serialized", value: "32" },
  { label: "Shota", value: "44" },
  { label: "Tentacles", value: "24" },
  { label: "Tragedy", value: "49" },
  { label: "Un-censored", value: "47" },
  { label: "Yaoi", value: "27" },
  { label: "Yuri", value: "28" },
];
