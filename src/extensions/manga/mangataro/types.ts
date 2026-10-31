export interface BrowseManga {
  id: string;
  url: string;
  title: string;
  cover: string | null;
  type: string;
  description: string;
  status: string;
}

export interface MangaDetails {
  id: number;
  slug: string;
  title: Rendered;
  content: Rendered;
  type: string;
  status: string;
  _embedded?: {
    "wp:featuredmedia"?: {
      source_url: string;
    }[];
    "wp:term"?: Term[][];
  };
}

interface Rendered {
  rendered: string;
}

interface Term {
  name: string;
  taxonomy: string;
}

export interface ChapterList {
  chapters: Chapter[];
  has_more: boolean;
}

interface Chapter {
  url: string;
  chapter: string;
  title: string | null;
  date: string;
  group_name: string | null;
  language: string;
}

export interface PageListResponse {
  images: string[];
}
