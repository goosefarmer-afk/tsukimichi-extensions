// NOTE: 'Vaild' is not a typo
export const POPULAR_QUERY = `
    query (
        $type: VaildPopularTypeEnumType!
        $size: Int!
        $page: Int
        $dateRange: Int
        $allowAdult: Boolean
        $allowUnknown: Boolean
    ) {
        queryPopular(
            type: $type
            size: $size
            page: $page
            dateRange: $dateRange
            allowAdult: $allowAdult
            allowUnknown: $allowUnknown
        ) {
            recommendations {
                anyCard {
                    _id
                    name
                    thumbnail
                    englishName
                }
            }
        }
    }
`;

export const SEARCH_QUERY = `
    query (
        $search: SearchInput
        $size: Int
        $page: Int
        $translationType: VaildTranslationTypeMangaEnumType
        $countryOrigin: VaildCountryOriginEnumType
    ) {
        mangas(
            search: $search
            limit: $size
            page: $page
            translationType: $translationType
            countryOrigin: $countryOrigin
        ) {
            edges {
                _id
                name
                thumbnail
                englishName
            }
        }
    }
`;

export const DETAILS_QUERY = `
    query ($id: String!, $showId: String!) {
        manga (_id: $id) {
            _id
            name
            thumbnail
            description
            authors
            genres
            tags
            status
            altNames
            englishName
            malId
            aniListId
            availableChaptersDetail
        }
        episodeInfos (
            showId: $showId
            episodeNumStart: 0
            episodeNumEnd: 9999
        ) {
            episodeIdNum
            notes
            uploadDates
        }
    }
`;
