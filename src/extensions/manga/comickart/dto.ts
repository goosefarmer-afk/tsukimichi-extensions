import type { Chapter } from "@tsukimichi/common";
import { getLanguageKey } from "@/utils/language";

export interface PopularResponse {
  data: BrowseComic[];
}

export interface BrowseComic {
  title: string;
  default_thumbnail: string | null;
  slug: string;
}

export interface SearchResponse {
  data: BrowseComic[];
  next_cursor?: string | null;
}

export interface ComickChapter {
  id: number;
  hid: string;
  chap: string;
  title: string;
  vol: string | null;
  lang: string;
  group_name: string[] | null;
  md_chapter_groups: MD_Groups[];
  updated_at: string | null;
}

interface MD_Groups {
  md_groups: ChapterGroup;
}

interface ChapterGroup {
  title: string;
  slug: string;
}

export interface ComickChapterListResponse {
  data: ComickChapter[];
  pagination: {
    current_page: number;
    last_page: number;
    per_page: number;
  };
}

interface Image {
  h: number;
  w: number;
  name: string;
  s: string | null;
  url: string;
  optimized: boolean | null;
}

export interface ComickChapterPagesResponse {
  chapter: { images: Image[] };
}

export function toChapter(options: {
  chapter: ComickChapter;
  seriesSlug: string;
  toNumberOrNull: (input: unknown, float?: boolean) => number | null;
  parseDate: (input: string | null) => string | null;
}): Chapter {
  const { chapter, seriesSlug, toNumberOrNull, parseDate } = options;

  return {
    title: `${chapter.vol ? `Vol. ${chapter.vol} - ` : ""}Chapter ${chapter.chap}`,
    url: `${seriesSlug}/${chapter.hid}-chapter-${chapter.chap}-${chapter.lang}`,
    languageKey: getLanguageKey(chapter.lang) || null,
    groupName: chapter.group_name?.join(", "),
    lastUpdated: parseDate(chapter.updated_at),
    chapterNumber: toNumberOrNull(chapter.chap, true),
    volumeNumber: toNumberOrNull(chapter.vol?.toString(), true),
  };
}
