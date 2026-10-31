export const ANIME_KAI_THEME_STATUS_OPTIONS = [
  {
    label: "Not Yet Aired",
    value: "info",
  },
  {
    label: "Releasing",
    value: "releasing",
  },
  {
    label: "Completed",
    value: "completed",
  },
];

export const ANIME_KAI_THEME_SERIES_TYPE_OPTIONS = [
  {
    label: "Movie",
    value: "movie",
  },
  {
    label: "TV",
    value: "tv",
  },
  {
    label: "OVA",
    value: "ova",
  },
  {
    label: "ONA",
    value: "ona",
  },
  {
    label: "Special",
    value: "special",
  },
  {
    label: "Music",
    value: "music",
  },
];

export const ANIME_KAI_THEME_RATING_OPTIONS = [
  {
    label: "G - All Ages",
    value: "g",
  },
  {
    label: "PG - Children",
    value: "pg",
  },
  {
    label: "PG-13 - Teens 13 or older",
    value: "pg_13",
  },
  {
    label: "R - 17+, Violence & Profanity",
    value: "r",
  },
  {
    label: "R+ - Profanity & Mild Nudity",
    value: "r+",
  },
  {
    label: "Rx - Hentai",
    value: "rx",
  },
];

export const ANIME_KAI_THEME_SORT_OPTIONS = [
  { label: "Most relevant", value: "most_relevance" },
  { label: "Updated date", value: "updated_date" },
  { label: "Release date", value: "release_date" },
  { label: "End date", value: "end_date" },
  { label: "Added date", value: "added_date" },
  { label: "Trending", value: "trending" },
  { label: "Name A-Z", value: "title_az" },
  { label: "Average score", value: "avg_score" },
  { label: "MAL score", value: "mal_score" },
  { label: "Most viewed", value: "most_viewed" },
  { label: "Most followed", value: "most_followed" },
  { label: "Episode count", value: "episode_count" },
];

export const ANIME_KAI_THEME_COUNTRY_OPTIONS = [
  {
    label: "China",
    value: "2",
  },
  {
    label: "Japan",
    value: "11",
  },
];

export const ANIME_KAI_THEME_LANGUAGE_OPTIONS = [
  {
    label: "Hard Sub",
    value: "sub",
  },
  {
    label: "Soft Sub",
    value: "softsub",
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

export const ANIME_KAI_THEME_SEASON_OPTIONS = [
  {
    label: "Fall",
    value: "fall",
  },
  {
    label: "Summer",
    value: "summer",
  },
  {
    label: "Spring",
    value: "spring",
  },
  {
    label: "Winter",
    value: "winter",
  },
  {
    label: "Unknown",
    value: "unknown",
  },
];

export const ANIME_KAI_THEME_YEAR_OPTIONS = [
  // From 2027 - 2000
  ...Array.from({ length: 28 }, (_, i) => {
    const year = 2028 - i;
    return { label: year.toString(), value: year.toString() };
  }),
  // 1990 - 1900 skip 10 years each
  ...Array.from({ length: 10 }, (_, i) => {
    const year = 1990 - i * 10;
    return { label: year.toString(), value: year.toString() };
  }),
];

export const ANIME_KAI_THEME_GENRE_OPTIONS = [
  { label: "Action", value: "47" },
  { label: "Adventure", value: "1" },
  { label: "Avant Garde", value: "235" },
  { label: "Boys Love", value: "184" },
  { label: "Comedy", value: "7" },
  { label: "Demons", value: "127" },
  { label: "Drama", value: "66" },
  { label: "Ecchi", value: "8" },
  { label: "Fantasy", value: "34" },
  { label: "Girls Love", value: "926" },
  { label: "Gourmet", value: "436" },
  { label: "Harem", value: "196" },
  { label: "Horror", value: "421" },
  { label: "Isekai", value: "77" },
  { label: "Iyashikei", value: "225" },
  { label: "Josei", value: "555" },
  { label: "Kids", value: "35" },
  { label: "Magic", value: "78" },
  { label: "Mahou Shoujo", value: "857" },
  { label: "Martial Arts", value: "92" },
  { label: "Mecha", value: "219" },
  { label: "Military", value: "134" },
  { label: "Music", value: "27" },
  { label: "Mystery", value: "48" },
  { label: "Parody", value: "356" },
  { label: "Psychological", value: "240" },
  { label: "Reverse Harem", value: "798" },
  { label: "Romance", value: "145" },
  { label: "School", value: "9" },
  { label: "Sci-Fi", value: "36" },
  { label: "Seinen", value: "189" },
  { label: "Shoujo", value: "183" },
  { label: "Shounen", value: "37" },
  { label: "Slice of Life", value: "125" },
  { label: "Space", value: "220" },
  { label: "Sports", value: "10" },
  { label: "Super Power", value: "350" },
  { label: "Supernatural", value: "49" },
  { label: "Suspense", value: "322" },
  { label: "Thriller", value: "241" },
  { label: "Vampire", value: "126" },
];
