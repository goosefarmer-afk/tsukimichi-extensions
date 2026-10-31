export interface BrowseResponse {
  chapters: BrowseChapter[];
  current_page: number;
  total_pages: number;
}

interface BrowseChapter {
  title: string;
  series: string;
  permalink: string;
  tags: BrowseTag[];
}

export interface MangaResponse {
  name: string;
  type: string;
  permalink: string;
  tags: BrowseTag[] | null;
  cover: string | null;
  description: string | null;
  aliases: string[] | null;
  total_pages: number | null;
  taggings: MangaChapterHeader[] | DynastyScansChapter[];
}

interface MangaChapterHeader {
  header: string | null;
}

export interface DynastyScansChapter {
  title: string;
  permalink: string;
  released_on: string;
  tags: BrowseTag[];
}

export type ChapterItem = (MangaChapterHeader & {type: 'header'; header: string | null}) | (DynastyScansChapter & {type: string; })

export interface ChapterResponse extends DynastyScansChapter {
  pages: Page[];
}

interface Page {
  name: string;
  url: string;
}

interface BrowseTag {
  name: string;
  type: string;
  permalink: string;
}

export interface TagSuggest extends Omit<BrowseTag, "permalink"> {
  id: number;
}

export interface MangaEntry {
  title: string;
  url: string;
  cover: string;
}

export interface CoverMap {
  [directory: string]: {
    [permalink: string]: string;
  };
}

export function transformTaggings(taggings: (DynastyScansChapter| MangaChapterHeader)[]): ChapterItem[] {
  return taggings.map(item => {
    if('header' in item){
      return {
        ...item,
        header: item.header,
        type: 'header'
      }
    }

    return {
      ...item,
      type: 'chapter'
    }
  })
}