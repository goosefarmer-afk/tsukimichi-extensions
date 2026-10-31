export interface ApiResponse<T> {
  items: T[];
  meta: ApiMeta | null;
}

interface ApiMeta {
  lastPage: number | null;
  hasNext: boolean;
}

export interface TagResponse {
  data: Tag[];
}

interface Tag {
  id: number;
  type: string;
}

interface Poster {
  small: string | null;
  medium: string | null;
  large: string | null;
}

export interface BrowseManga {
  hid: string;
  slug: string | null;
  title: string;
  poster: Poster | null;
}

export interface MangaDetailsResponse {
  data: MangaDetails;
}

export interface MangaDetails {
  hid: string;
  slug: string | null;
  title: string;
  type: string | null;
  poster: Poster | null;
  status: string | null;
  synopsisHtml: string | null;
  authors: Entity[] | null;
  genres: Entity[] | null;
  artists: Entity[] | null;
  themes: Entity[] | null;
  rating: number | null;
  altTitles: string[] | null;
  contentRating: string | null;
}

interface Entity {
  title: string;
}

export interface MangaFireVolume {
  id: number;
  number: number;
  name: string | null;
  language: string;
  chapterCount: number;
}

export interface MangaFireChapter {
  id: number;
  number: number;
  name: string | null;
  type: string | null;
  createdAt: number | null;
}

export interface PagesResponse {
  data: {
    pages: Page[];
  };
}

interface Page {
  url: string;
}
