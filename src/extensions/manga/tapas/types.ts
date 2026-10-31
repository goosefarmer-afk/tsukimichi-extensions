interface MangaDto {
  seriesId: number;
  title: string;
  description: string;
  assetProperty: Field;
  mature?: boolean;
}

interface Field {
  bookCoverImage: Record<string, string> | null;
}

export interface WrapperContent {
  items: MangaDto[];
}

interface Meta {
  pagination: Pagination;
}

interface Pagination {
  last: boolean;
  has_next: boolean;
  total?: number;
  limit?: number;
}

export interface DataWrapper<T> {
  data: T;
  meta: Meta | null;
}

export interface ChapterListResponse {
  pagination: Pagination | null;
  episodes: ChapterItem[];
}

interface ChapterItem {
  id: number;
  title: string;
  publish_date: string;
  unlocked: boolean;
  free: boolean;
  scene: number;
  scheduled: boolean;
}
