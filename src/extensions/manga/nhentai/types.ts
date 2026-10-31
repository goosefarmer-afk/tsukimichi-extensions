import type { Chapter } from "@tsukimichi/common";

export interface NHConfig {
  image_servers: string[];
  thumb_servers: string[];
}

export interface PaginatedSeriesResponse<T> {
  result: T[];
  per_page: number;
  num_pages: number | null;
  total: number | null;
}

export interface GalleryItem {
  id: number;
  thumbnail: string | null;
  english_title: string;
  japanese_title: string;
}

export interface Hentai {
  id: number;
  title: Title;
  thumbnail: Image;
  pages: Image[];
  tags: Tag[];
  upload_date: number;
  num_favorites: number;
  num_pages: number;
}

interface Title {
  english: string | null;
  japanese: string | null;
  pretty: string | null;
}

interface Image {
  path: string;
}

interface Tag {
  name: string;
  type: string;
}

export function toChapter(hentai: Hentai): Chapter {
  return {
    lastUpdated: new Date(hentai.upload_date * 1000).toISOString(),
    url: `/g/${hentai.id}`,
    languageKey: "multi",
    title: "Chapter",
    chapterNumber: null,
    volumeNumber: null,
  };
}
