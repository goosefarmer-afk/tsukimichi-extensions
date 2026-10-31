export interface SearchResponse {
  data: SearchData | null;
}

interface SearchData {
  items: MangaItem[];
  pagination: {
    has_next: boolean;
  } | null;
}

interface MangaItem {
  id: string;
  name: string;
  cover: string | null;
  url: string;
}

export interface NextJsPageProps {
  pageProps: PageProps | null;
}

interface PageProps {
  initialManga: InitialManga | null;
  initialChapter: InitialChapter | null;
}

interface InitialManga {
  id: string;
  name: string;
  authors: Entity[] | null;
  summary: string | null;
  genres: Entity[] | null;
  status: string | null;
  cover: string | null;
  url: string | null;
  altNames: Entity[] | null;
  rating: number | null;
  isAdult: boolean;
  updated_at: string | null;
}

interface Entity {
  name: string;
}

export interface ChapterListResponse {
  data: {
    chapters: ChapterItem[];
  } | null;
}

interface ChapterItem {
  name: string;
  url: string;
  updated_at: string | null;
  chapter_number: number | null;
}

interface InitialChapter {
  images: string[];
}
