export const MANGA_FIRE_SERIES_TYPE = [
  {
    label: "Manga",
    value: "manga",
  },
  {
    label: "Manhwa",
    value: "manhwa",
  },
  {
    label: "Manhua",
    value: "manhua",
  },
  {
    label: "Other",
    value: "other",
  },
];

export const MANGA_FIRE_SORT_OPTIONS = [
  {
    label: "Latest update",
    value: "chapter_updated_at:desc",
  },
  {
    label: "Best match",
    value: "relevance:desc",
  },
  {
    label: "Recently added",
    value: "created_at:desc",
  },
  {
    label: "Title (A-Z)",
    value: "title:asc",
  },
  {
    label: "Title (Z-A)",
    value: "title:desc",
  },
  {
    label: "Year (newest)",
    value: "year:desc",
  },
  {
    label: "Year (oldest)",
    value: "year:asc",
  },
  {
    label: "Highest rated",
    value: "score:desc",
  },
  {
    label: "Most viewed (7 days)",
    value: "views_7d:desc",
  },
  {
    label: "Most viewed (30 days)",
    value: "views_30d:desc",
  },
  {
    label: "Month viewed (all time)",
    value: "views_total:desc",
  },
  {
    label: "Most followed",
    value: "follows_total:desc",
  },
];

export const MANGA_FIRE_STATUS_OPTIONS = [
  {
    label: "Releasing",
    value: "releasing",
  },
  {
    label: "Finished",
    value: "finished",
  },
  {
    label: "On hiatus",
    value: "on_hiatus",
  },
  {
    label: "Discontinued",
    value: "discontinued",
  },
  {
    label: "Not Yet Released",
    value: "not_yet_released",
  },
];

export const MANGA_FIRE_GENRE_OPTIONS = [
  { label: "Action", value: "1" },
  { label: "Adult", value: "268929" },
  { label: "Adventure", value: "78" },
  { label: "Avant Garde", value: "3" },
  { label: "Boys Love", value: "4" },
  { label: "Comedy", value: "5" },
  { label: "Crime", value: "268921" },
  { label: "Demons", value: "77" },
  { label: "Drama", value: "6" },
  { label: "Ecchi", value: "7" },
  { label: "Fantasy", value: "79" },
  { label: "Girls Love", value: "9" },
  { label: "Gourmet", value: "10" },
  { label: "Harem", value: "11" },
  { label: "Hentai", value: "268930" },
  { label: "Historical", value: "268922" },
  { label: "Horror", value: "530" },
  { label: "Isekai", value: "13" },
  { label: "Iyashikei", value: "531" },
  { label: "Josei", value: "15" },
  { label: "Kids", value: "532" },
  { label: "Magic", value: "539" },
  { label: "Mahou Shoujo", value: "533" },
  { label: "Martial Arts", value: "534" },
  { label: "Mecha", value: "19" },
  { label: "Medical", value: "268924" },
  { label: "Military", value: "535" },
  { label: "Music", value: "21" },
  { label: "Mystery", value: "22" },
  { label: "Parody", value: "23" },
  { label: "Philosophical", value: "268925" },
  { label: "Psychological", value: "536" },
  { label: "Reverse Harem", value: "25" },
  { label: "Romance", value: "26" },
  { label: "School", value: "73" },
  { label: "Sci-Fi", value: "28" },
  { label: "Seinen", value: "537" },
  { label: "Shoujo", value: "30" },
  { label: "Shounen", value: "31" },
  { label: "Slice of Life", value: "538" },
  { label: "Smut", value: "268932" },
  { label: "Space", value: "33" },
  { label: "Sports", value: "34" },
  { label: "Super Power", value: "75" },
  { label: "Supernatural", value: "76" },
  { label: "Suspense", value: "37" },
  { label: "Thriller", value: "38" },
  { label: "Vampire", value: "39" },
  { label: "Wuxia", value: "268928" },
];

export const MANGA_FIRE_CONTENT_RATING_OPTIONS = [
  "safe",
  "suggestive",
  "erotica",
  "pornographic",
].map((rating) => ({ label: rating.charAt(0).toUpperCase() + rating.slice(1), value: rating }));
