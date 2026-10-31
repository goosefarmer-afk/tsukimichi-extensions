import { MKissaCrypto } from "./mkissa-crypto";

export const POPULAR_SERIES_QUERY = `
    query(
        $type: VaildPopularTypeEnumType!,
        $size: Int!,
        $page: Int,
        $dateRange: Int
    ) {
        queryPopular(
            type: $type,
            size: $size,
            page: $page,
            dateRange: $dateRange
        ) {
            total
            recommendations {
                anyCard {
                    _id
                    name
                    thumbnail
                    englishName
                    nativeName
                    slugTime
                }
            }
        }
    }
  `;

export const SEARCH_SERIES_QUERY = `
    query(
        $search: SearchInput!
        $limit: Int
        $page: Int
        $translationType: VaildTranslationTypeEnumType
        $countryOrigin: VaildCountryOriginEnumType
    ) {
        shows(
            search: $search
            limit: $limit
            page: $page
            translationType: $translationType
            countryOrigin: $countryOrigin
        ) {
            pageInfo {
                total
            }
            edges {
                _id
                name
                thumbnail
                englishName
                nativeName
                slugTime
            }
        }
    }
`;

export const ANIME_DETAILS_QUERY = `
    query ($_id: String!) {
        show(_id: $_id) {
          _id
          name
          englishName
          nativeName
          thumbnail
          isAdult
          description
          type
          season
          score
          genres
          status
          studios
          airedStart
          airedEnd
          rating
        }
    }
  `;

export const EPISODES_QUERY = `query ($_id: String!) {
        show(_id: $_id) {
            _id
            availableEpisodesDetail
        }
    }
`;

export const STREAM_QUERY = `
    query(
        $showId: String!
        $translationType: VaildTranslationTypeEnumType!
        $episodeString: String!
    ) {
        episode(
            showId: $showId
            translationType: $translationType
            episodeString: $episodeString
        ) {
            sourceUrls
            show {
                _id
            }
        }
    }
`;

export const STREAM_HASH = MKissaCrypto.sha256Hex(STREAM_QUERY);
