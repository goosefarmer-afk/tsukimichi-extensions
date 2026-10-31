export interface SearchManga {
  id: string;
  name: string;
  slug: string;
  image: ImageDto;
  is18plus: boolean;
  status: string | null;
}

export interface SearchResponse {
  data: SearchManga[];
  pagination: {
    total_pages: number;
  };
}

export interface TitleResponse {
  data: {
    id: string;
    slug: string;
    name: string;
    image: ImageDto | null;
    description: string[] | null;
    alternateName: string[] | null;
    tags: Tag[] | null;
    author: Author[] | null;
    status: string | null;
    is18plus: boolean | null;
    updated_at: string | null;
  };
}

interface Tag {
  name: string;
}

interface Author {
  name: string;
}

export interface ImageDto {
  file: string | null;
  cdn_mangadex: string | null;
  cdn_mangaupdates: string | null;
  cdn_mangaupdate: string | null;
  cover: CoverDto | null;
}

interface CoverDto {
  path: string | null;
}

export interface ChapterListResponse {
  data: MangaBallChapter[];
}

interface MangaBallChapter {
  id: string;
  name: string | null;
  number: number | null;
  volume: number | null;
  lang: string;
  group: Group | null;
  created_at: string | null;
}

export interface ChapterDetailResponse {
  data: {
    chapter: {
      title_id: string | null;
      pages: string[] | null;
    } | null;
  };
}

interface Group {
  _id: string;
  name: string;
}
