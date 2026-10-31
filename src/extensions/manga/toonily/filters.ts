import type { FilterOption } from "@tsukimichi/common";

export const TOONILY_STATUS: Array<FilterOption> = [
  { value: "on-going", label: "Ongoing" },
  { value: "end", label: "Completed" },
  { value: "canceled", label: "Cancelled" },
  { value: "on-hold", label: "Hiatus" },
];

export const TOONILY_GENRES = [
  { value: "action", label: "Action" },
  { value: "adventure", label: "Adventure" },
  { value: "comedy", label: "Comedy" },
  { value: "crime", label: "Crime" },
  { value: "drama", label: "Drama" },
  { value: "fantasy", label: "Fantasy" },
  { value: "gossip", label: "Gossip" },
  { value: "historical", label: "Historical" },
  { value: "horror", label: "Horror" },
  { value: "josei", label: "Josei" },
  { value: "magic", label: "Magic" },
  { value: "mature", label: "Mature" },
  { value: "mystery", label: "Mystery" },
  { value: "psychological", label: "Psychological" },
  { value: "romance", label: "Romance" },
  { value: "school-life", label: "School Life" },
  { value: "scifi-webtoon", label: "Sci-Fi" },
  { value: "seinen", label: "Seinen" },
  { value: "shoujo", label: "Shoujo" },
  { value: "shounen", label: "Shounen" },
  { value: "slice-of-life", label: "Slice of Life" },
  { value: "sports", label: "Sports" },
  { value: "supernatural", label: "Supernatural" },
  { value: "thriller", label: "Thriller" },
  { value: "tragedy", label: "Tragedy" },
  { value: "yaoi", label: "Yaoi" },
  { value: "yuri", label: "Yuri" },
];

export const TOONILY_GENRES_CONDITION: Array<FilterOption> = [
  {
    value: "0",
    label: "OR (Any Selected Genres)",
  },
  {
    value: "1",
    label: "AND (All Selected Genres)",
  },
];

export const TOONILY_ADULT_CONTENT_FILTER = [
  {
    value: "all",
    label: "All",
  },
  {
    value: "0",
    label: "Mature Hidden",
  },
  {
    value: "1",
    label: "Mature Only",
  },
];

export const TOONILY_ORDER_BY_OPTIONS = [
  {
    label: "Relevance",
    vale: "relevance",
  },
  {
    label: "Latest",
    value: "latest",
  },
  {
    label: "Alphabetical(A-Z)",
    value: "alphabet",
  },
  {
    label: "Rating",
    value: "rating",
  },
  {
    label: "Trending",
    value: "trending",
  },
  {
    label: "Most Views",
    value: "views",
  },
  {
    label: "New Manga",
    value: "new-manga",
  },
];
