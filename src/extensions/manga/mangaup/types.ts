export interface MangaTitle {
  id: number;
  name: string;
  thumbnail: string | null;
  bookmarks: number | null;
  lastUpdated: string | null;
}

export interface SeriesResponseData {
  titles: MangaTitle[] | null;
}

export interface MangaDetails {
  title: string;
  author: string | null;
  copyright: string | null;
  schedule: string | null;
  warning: string | null;
  description: string | null;
  tags: Genre[] | null;
  thumbnail: string | null;
  chapters: Chapter[];
}

interface Genre {
  name: string;
}

interface Chapter {
  id: number;
  name: string;
  subtitle: string | null;
  price: number | null;
  dateStr: string | null;
  isFinal?: boolean;
}

export interface ViewerResponse {
  pageBlocks: PageBlock[];
}

export interface PageBlock {
  chapterId: number | null;
  pages: MangaPage[];
}

export interface MangaPage {
  url: string;
  key?: string | null;
  iv?: string | null;
}
