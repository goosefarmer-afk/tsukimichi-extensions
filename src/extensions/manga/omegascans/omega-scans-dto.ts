export type OmegaScansChapterResponse = {
    paywall?: boolean;

    chapter: {
        id: number;
        series_id: number;
        chapter_name: string;
        chapter_data?: {
            images: string[];
        };
        chapter_slug: string;
        price?: number;
        created_at: string;
        updated_at: string;

        series: {
            id: number;
            series_slug: string;
        };
    };

    next_chapter?: {
        id: number;
        chapter_name: string;
        chapter_slug: string;
    };

    previous_chapter?: {
        id: number;
        chapter_name: string;
        chapter_slug: string;
    };
};
