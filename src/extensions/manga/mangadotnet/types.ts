export interface Data<T> {
  data: T;
}

export interface ViewAllData {
  data: MangaList;
  allGenres: string[];
}

export interface MangaList {
  manga_list: BrowseManga[] | null;
  results: BrowseManga[] | null;
  pagination: {
    total_pages: number | null;
    current_page: number | null;
    next_cursor: string | null;
  } | null;
}

interface BrowseManga {
  id: number;
  title: string;
  photo: string | null;
  is_blurworthy: unknown;
}

export interface MangaData {
  mangaData: {
    manga: Manga;
  };
}

interface Manga {
  id: number;
  title: string;
  alt_titles: string[] | null;
  artists: string | null;
  authors: string | null;
  genres: string[] | null;
  tags: string[] | null;
  description: string | null;
  is_adult: boolean;
  photo: string | null;
  hiatus: string | null;
  status: string | null;
  source_url: string | null;
  country_of_origin: string | null;
  avg_rating: number | null;
  content_rating: string | null;
  year: number | null;
}

export interface ChapterItem {
  id: number;
  chapter_number: number | null;
  volume_number: number | null;
  chapter_title: string | null;
  language: string | null;
  source: string | null;
  group_id: number | null;
  group_name: string | null;
  scanlator_name: string | null;
  date_added: string | null;
  groups: Group[] | null;
}

interface Group {
  id: number;
  name: string;
}

export interface Volume {
  id: number;
  volume_number: number | null;
  group_name: string | null;
  scanlator_name: string | null;
  date_added: string | null;
  source: string | null;
  language: string | null;
}

export interface Images {
  manga: {
    id: number;
  };
  images: {
    url: string;
  }[];
}
