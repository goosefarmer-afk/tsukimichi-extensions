export interface BrowseSeries {
  series_slug: string;
  title: string;
  alternative_names: string | null;
  thumbnail: string | null;
  status: string | null;
  created_at: string | null;
  update_chapter: string | null;
  total_views: number | null;
}

export interface SeriesDetails {
  id: number;
  title: string;
  description: string | null;
  author: string | null;
  studio: string | null;
  release_year: string | null;
  alternative_names: string | null;
  adult: boolean;
  series_slug: string;
  thumbnail: string | null;
  badge: string | null;
  total_views: number | null;
  status: string | null;
  tag_series:
    | {
        tag: Tag;
      }[]
    | null;
}

export interface ChapterList {
  Season: Season[];
}

interface Season {
  Chapter: ChapterItem[];
}

interface ChapterItem {
  index: string;
  chapter_name: string;
  chapter_title: string | null;
  chapter_slug: string;
  price: number;
  created_at: string;
}

interface Tag {
  name: string;
}

export interface PageList {
  pages: string[];
}
