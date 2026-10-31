import type { SelectFilter } from "@tsukimichi/common";

export const GenreFilter: SelectFilter = {
  key: "genres",
  label: "Genre",
  type: "select",
  options: [
    { label: "Action", value: "Action" },
    { label: "Adventure", value: "Adventure" },
    { label: "Comedy", value: "Comedy" },
    { label: "Drama", value: "Drama" },
    { label: "Ecchi", value: "Ecchi" },
    { label: "Fantasy", value: "Fantasy" },
    { label: "Horror", value: "Horror" },
    { label: "Mahou Shojo", value: "Mahou Shojo" },
    { label: "Mecha", value: "Mecha" },
    { label: "Music", value: "Music" },
    { label: "Mystery", value: "Mystery" },
    { label: "Psychological", value: "Psychological" },
    { label: "Romance", value: "Romance" },
    { label: "Sci-Fi", value: "Sci-Fi" },
    { label: "Slice of Life", value: "Slice of Life" },
    { label: "Sports", value: "Sports" },
    { label: "Supernatural", value: "Supernatural" },
    { label: "Thriller", value: "Thriller" },
  ],
};

export const SortFilter: SelectFilter = {
  key: "sort",
  label: "Sort by",
  type: "select",
  options: [
    { label: "Popularity", value: "POPULARITY" },
    { label: "Release date", value: "RELEASE_DATE" },
    { label: "Post date", value: "POST_DATE" },
  ],
};
