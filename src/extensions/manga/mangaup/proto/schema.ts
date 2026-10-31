import protobuf from "protobufjs";

const root = new protobuf.Root();

const MangaTitleSchema = new protobuf.Type("MangaTitle")
  .add(new protobuf.Field("id", 1, "int32"))
  .add(new protobuf.Field("name", 2, "string"))
  .add(new protobuf.Field("thumbnail", 3, "string"))
  .add(new protobuf.Field("bookmarks", 7, "int32"))
  .add(new protobuf.Field("lastUpdated", 9, "string"));

const TagSchema = new protobuf.Type("Tag").add(new protobuf.Field("name", 2, "string"));

const MangaChapterSchema = new protobuf.Type("MangaChapter")
  .add(new protobuf.Field("id", 1, "int32"))
  .add(new protobuf.Field("name", 2, "string"))
  .add(new protobuf.Field("subtitle", 3, "string"))
  .add(new protobuf.Field("price", 6, "int32"))
  .add(new protobuf.Field("dateStr", 9, "string"))
  .add(new protobuf.Field("isFinal", 12, "bool"));

const MangaPageSchema = new protobuf.Type("MangaPage")
  .add(new protobuf.Field("url", 1, "string"))
  .add(new protobuf.Field("key", 5, "string"))
  .add(new protobuf.Field("iv", 6, "string"));

const PageBlockSchema = new protobuf.Type("PageBlock")
  .add(new protobuf.Field("chapterId", 1, "int32"))
  .add(new protobuf.Field("pages", 3, "MangaPage", "repeated"));

const SeriesResponseSchema = new protobuf.Type("SeriesResponse").add(
  new protobuf.Field("titles", 2, "MangaTitle", "repeated"),
);

const SearchResponseSchema = new protobuf.Type("SearchResponse").add(
  new protobuf.Field("titles", 1, "MangaTitle", "repeated"),
);

const MangaDetailsResponseSchema = new protobuf.Type("MangaDetailsResponse")
  .add(new protobuf.Field("title", 3, "string"))
  .add(new protobuf.Field("author", 4, "string"))
  .add(new protobuf.Field("copyright", 5, "string"))
  .add(new protobuf.Field("schedule", 6, "string"))
  .add(new protobuf.Field("warning", 7, "string"))
  .add(new protobuf.Field("description", 8, "string"))
  .add(new protobuf.Field("tags", 10, "Tag", "repeated"))
  .add(new protobuf.Field("thumbnail", 11, "string"))
  .add(new protobuf.Field("chapters", 13, "MangaChapter", "repeated"));

const ViewerResponseSchema = new protobuf.Type("Viewer").add(
  new protobuf.Field("pageBlocks", 3, "PageBlock", "repeated"),
);

root.add(MangaTitleSchema);
root.add(TagSchema);
root.add(MangaChapterSchema);
root.add(MangaPageSchema);
root.add(PageBlockSchema);
root.add(SeriesResponseSchema);
root.add(SearchResponseSchema);
root.add(MangaDetailsResponseSchema);
root.add(ViewerResponseSchema);

root.resolveAll();

export {
  SeriesResponseSchema,
  SearchResponseSchema,
  MangaDetailsResponseSchema,
  ViewerResponseSchema,
};
