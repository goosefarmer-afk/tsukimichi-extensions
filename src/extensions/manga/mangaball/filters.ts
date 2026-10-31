import type {
  SelectFilter,
  SortFilter as SortFilterType,
  TriStateCheckboxFilter,
} from "@tsukimichi/common";

const SortOptions = [
  { label: "Relevance", value: "any" },
  { label: "Latest Updated", value: "lastupdate" },
  { label: "Most Viewed", value: "views" },
  { label: "Top Rated", value: "rating" },
  { label: "Recently Added", value: "created_at" },
  { label: "Title", value: "name" },
];

const SortFilter: SortFilterType = {
  key: "sort_by",
  label: "Sort By",
  options: SortOptions,
  type: "sort",
  defaultValue: SortOptions[0]!.value,
  defaultDirection: "descending",
};

const PublicationStatusOptions = [
  { label: "All", value: "any" },
  { label: "Ongoing", value: "ongoing" },
  { label: "Completed", value: "completed" },
  { label: "Cancelled", value: "cancelled" },
  { label: "Hiatus", value: "hiatus" },
];

const StatusFilter: SelectFilter = {
  key: "status",
  label: "Publication Status",
  options: PublicationStatusOptions,
  type: "select",
  defaultValue: PublicationStatusOptions[0]?.value,
};

const MagazineDemographicOptions = [
  { label: "All", value: "any" },
  { label: "Shounen", value: "shounen" },
  { label: "Shoujo", value: "shoujo" },
  { label: "Seinen", value: "seinen" },
  { label: "Josei", value: "josei" },
];

const DemographicFilter: SelectFilter = {
  key: "publicationDemographic",
  label: "Magazine Demographic",
  options: MagazineDemographicOptions,
  type: "select",
  defaultValue: MagazineDemographicOptions[0]?.value,
};

const ThemeOptions = [
  { label: "3D", value: "6a0026ba63a8d384c0a4be13" },
  { label: "Aliens", value: "6851490d15e8b86aae68e5d5" },
  { label: "Animals", value: "685148e715e8b86aae68e54b" },
  { label: "Comics", value: "68bf09ff8fdeab0b6a9bc2b7" },
  { label: "Cooking", value: "685148d215e8b86aae68e4f8" },
  { label: "Crossdressing", value: "685148df15e8b86aae68e534" },
  { label: "Delinquents", value: "685148d915e8b86aae68e519" },
  { label: "Demons", value: "685146c5f3ed681c80f257e4" },
  { label: "Genderswap", value: "685148d715e8b86aae68e505" },
  { label: "Ghosts", value: "685148d615e8b86aae68e501" },
  { label: "Gyaru", value: "685148d015e8b86aae68e4e8" },
  { label: "Harem", value: "685146c5f3ed681c80f257e8" },
  { label: "Hentai", value: "68bfceaf4dbc442a26519889" },
  { label: "Incest", value: "685148f215e8b86aae68e584" },
  { label: "Loli", value: "685148d715e8b86aae68e506" },
  { label: "Mafia", value: "685148d915e8b86aae68e518" },
  { label: "Magic", value: "685148d715e8b86aae68e509" },
  { label: "Manhwa 18+", value: "68f5f5ce5f29d3c1863dec3a" },
  { label: "Martial Arts", value: "6851490615e8b86aae68e5c2" },
  { label: "Military", value: "685148e215e8b86aae68e541" },
  { label: "Monster Girls", value: "685148db15e8b86aae68e52c" },
  { label: "Monsters", value: "685146c5f3ed681c80f257e2" },
  { label: "Music", value: "685148d015e8b86aae68e4e4" },
  { label: "Ninja", value: "685148d715e8b86aae68e508" },
  { label: "Office Workers", value: "685148d315e8b86aae68e4fd" },
  { label: "Police", value: "6851498815e8b86aae68e714" },
  { label: "Post-Apocalyptic", value: "685148e215e8b86aae68e540" },
  { label: "Reincarnation", value: "685146c5f3ed681c80f257e1" },
  { label: "Reverse Harem", value: "685148df15e8b86aae68e533" },
  { label: "Samurai", value: "6851490415e8b86aae68e5b9" },
  { label: "School Life", value: "685148d015e8b86aae68e4e7" },
  { label: "Seinen", value: "6a0025c263a8d384c0a4be07" },
  { label: "Shota", value: "685148d115e8b86aae68e4ed" },
  { label: "Supernatural", value: "685148db15e8b86aae68e528" },
  { label: "Survival", value: "685148cf15e8b86aae68e4dc" },
  { label: "Time Travel", value: "6851490c15e8b86aae68e5d1" },
  { label: "Traditional Games", value: "6851493515e8b86aae68e645" },
  { label: "Vampires", value: "685148f915e8b86aae68e597" },
  { label: "Video Games", value: "685148e115e8b86aae68e53c" },
  { label: "Villainess", value: "6851492115e8b86aae68e602" },
  { label: "Virtual Reality", value: "68514a1115e8b86aae68e83e" },
  { label: "Zombies", value: "6851490c15e8b86aae68e5d3" },
];

const ThemeFilter: TriStateCheckboxFilter = {
  key: "themes",
  options: ThemeOptions,
  label: "Theme",
  type: "tri-state-checkbox",
};

const ContentFilter: TriStateCheckboxFilter = {
  key: "contents",
  options: [
    { label: "Gore", value: "685148d115e8b86aae68e4f3" },
    { label: "Sexual Violence", value: "685146c5f3ed681c80f257e7" },
  ],
  label: "Content",
  type: "tri-state-checkbox",
};

const FormatOptions = [
  { label: "4-Koma", value: "685148d115e8b86aae68e4ec" },
  { label: "Adaptation", value: "685148cf15e8b86aae68e4de" },
  { label: "Anthology", value: "685148e915e8b86aae68e558" },
  { label: "Award Winning", value: "685148fe15e8b86aae68e5a7" },
  { label: "Doujinshi", value: "6851490e15e8b86aae68e5da" },
  { label: "Fan Colored", value: "6851498215e8b86aae68e704" },
  { label: "Full Color", value: "685148d615e8b86aae68e502" },
  { label: "Long Strip", value: "685148d915e8b86aae68e517" },
  { label: "Official Colored", value: "6851493515e8b86aae68e64a" },
  { label: "Oneshot", value: "685148eb15e8b86aae68e56c" },
  { label: "Self-Published", value: "6851492e15e8b86aae68e633" },
  { label: "Web Comic", value: "685148d715e8b86aae68e50d" },
];

const FormatFilter: TriStateCheckboxFilter = {
  key: "formats",
  options: FormatOptions,
  label: "Format",
  type: "tri-state-checkbox",
};

const GenreOptions = [
  { label: "Action", value: "685146c5f3ed681c80f257e3" },
  { label: "Adult", value: "689371f0a943baf927094f03" },
  { label: "Adventure", value: "685146c5f3ed681c80f257e6" },
  { label: "Boys' Love", value: "685148ef15e8b86aae68e573" },
  { label: "Comic", value: "68ecab8507ec62d87e62780f" },
  { label: "Comedy", value: "685146c5f3ed681c80f257e5" },
  { label: "Crime", value: "685148da15e8b86aae68e51f" },
  { label: "Drama", value: "685148cf15e8b86aae68e4dd" },
  { label: "Ecchi", value: "6892a73ba943baf927094e37" },
  { label: "Fantasy", value: "685146c5f3ed681c80f257ea" },
  { label: "Girls' Love", value: "685148da15e8b86aae68e524" },
  { label: "Historical", value: "685148db15e8b86aae68e527" },
  { label: "Horror", value: "685148da15e8b86aae68e520" },
  { label: "Isekai", value: "685146c5f3ed681c80f257e9" },
  { label: "Josei(W)", value: "694cc2d9f8014f5e0a63ac73" },
  { label: "Magical Girls", value: "6851490d15e8b86aae68e5d4" },
  { label: "Manga", value: "68ecab1e07ec62d87e627806" },
  { label: "Manhua", value: "68ecab4807ec62d87e62780b" },
  { label: "Manhwa", value: "68ecab3b07ec62d87e627809" },
  { label: "Mature", value: "68932d11a943baf927094e7b" },
  { label: "Mecha", value: "6851490c15e8b86aae68e5d2" },
  { label: "Medical", value: "6851494e15e8b86aae68e66e" },
  { label: "Mystery", value: "685148d215e8b86aae68e4f4" },
  { label: "Philosophical", value: "685148e215e8b86aae68e544" },
  { label: "Psychological", value: "685148d715e8b86aae68e507" },
  { label: "Revenge", value: "694cc2d9f8014f5e0a63ac75" },
  { label: "Romance", value: "685148cf15e8b86aae68e4db" },
  { label: "Sci-Fi", value: "685148cf15e8b86aae68e4da" },
  { label: "Shoujo(G)", value: "694cc2d9f8014f5e0a63ac74" },
  { label: "Shounen Ai", value: "689f0ab1f2e66744c6091524" },
  { label: "Slice of Life", value: "685148d015e8b86aae68e4e3" },
  { label: "Smut", value: "689371f2a943baf927094f04" },
  { label: "Sports", value: "685148f515e8b86aae68e588" },
  { label: "Superhero", value: "6851492915e8b86aae68e61c" },
  { label: "Thriller", value: "685148d915e8b86aae68e51e" },
  { label: "Tragedy", value: "685148db15e8b86aae68e529" },
  { label: "User Created", value: "68932c3ea943baf927094e77" },
  { label: "Wuxia", value: "6851490715e8b86aae68e5c3" },
  { label: "Yaoi", value: "68932f68a943baf927094eaa" },
  { label: "Yuri", value: "6896a885a943baf927094f66" },
];

const GenreFilter: TriStateCheckboxFilter = {
  key: "genres",
  options: GenreOptions,
  label: "Genre",
  type: "tri-state-checkbox",
};

const TypeOptions = [
  { label: "All", value: "any" },
  ...["Manga", "Manhwa", "Manhua", "Comics"].map((type) => ({
    label: type,
    value: type.charAt(0).toLowerCase() + type.slice(1),
  })),
];

const TypeFilter: SelectFilter = {
  key: "type",
  options: TypeOptions,
  label: "Type",
  type: "select",
  defaultValue: "any",
};

const TagModeFilter: SelectFilter = {
  key: "tag_mode",
  label: "Tag Mode",
  options: ["AND", "OR"].map((item) => ({ label: item, value: item })),
  type: "select",
  defaultValue: "AND",
};

export {
  SortFilter,
  TypeFilter,
  DemographicFilter,
  StatusFilter,
  TagModeFilter,
  ContentFilter,
  FormatFilter,
  GenreFilter,
  ThemeFilter,
};
